// Relay bridge — connects the desktop app to the local forge-relay so paired
// mobile devices can chat with agents remotely. The app is the source of truth:
// chat history lives in the Tauri store and models run in this webview, so the
// bridge answers history/agent queries from the zustand stores and runs the
// LLM pipeline for incoming mobile messages, streaming tokens back through the
// relay. If the app is closed the relay queues mobile messages as inbox
// captures instead — this bridge only handles the live path.
import { invoke } from '@tauri-apps/api/core';
import { generateTextResponse } from './llm';
import { generateId } from '../lib/id';
import { useChatStore } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { filterMobileAgents } from './mobileAgentFilter';

const RELAY_WS_URL = 'ws://127.0.0.1:8765/v1/ws';
const STATUS_RETRY_MS = 30_000;
const MAX_RECONNECT_MS = 30_000;

let started = false;
let ws: WebSocket | null = null;
let reconnectMs = 1000;
const activeRuns = new Map<string, AbortController>();

export function startRelayBridge() {
  if (started) return;
  if (!(window as any).__TAURI_INTERNALS__ && !(window as any).__TAURI__) return;
  started = true;
  connectLoop();
}

async function connectLoop() {
  let adminToken = '';
  try {
    const status = await invoke<any>('get_relay_status');
    if (status?.running && status?.adminToken) adminToken = status.adminToken;
  } catch {
    // Relay status unavailable — retry below.
  }
  if (!adminToken) {
    setTimeout(connectLoop, STATUS_RETRY_MS);
    return;
  }

  const socket = new WebSocket(`${RELAY_WS_URL}?role=app&token=${encodeURIComponent(adminToken)}`);
  ws = socket;

  socket.onopen = () => {
    reconnectMs = 1000;
    console.log('[relay-bridge] connected to forge-relay');
  };
  socket.onmessage = event => {
    let frame: any;
    try { frame = JSON.parse(event.data); } catch { return; }
    handleFrame(frame).catch(e => console.warn('[relay-bridge] frame error:', e));
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    setTimeout(connectLoop, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
  };
  socket.onerror = () => socket.close();
}

function reply(deviceId: string, frame: Record<string, any>) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...frame, deviceId }));
}

function mobileVisibleAgents(): any[] {
  return filterMobileAgents(useAgentStore.getState().assistants);
}

async function handleFrame(frame: any) {
  const { type, deviceId, reqId } = frame ?? {};
  switch (type) {
    case 'welcome':
    case 'presence':
      return;
    case 'device.connected':
      console.log(`[relay-bridge] mobile device connected: ${frame.deviceName ?? frame.deviceId}`);
      return;
    case 'device.disconnected':
      return;
    case 'agents.list':
      return reply(deviceId, {
        type: 'agents.list.result',
        reqId,
        agents: mobileVisibleAgents().map((a: any) => ({
          id: a.id,
          name: a.name,
          description: a.description ?? '',
          role: a.role ?? '',
        })),
      });
    case 'history.list': {
      const { chats, messages } = useChatStore.getState();
      const visibleIds = new Set(mobileVisibleAgents().map((a: any) => a.id));
      const summaries = [...chats]
        .filter((chat: any) => visibleIds.has(chat.primaryAgentId ?? chat.folderId))
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .map((chat: any) => {
          const msgs = messages[chat.id] ?? [];
          const last = msgs[msgs.length - 1];
          return {
            id: chat.id,
            name: chat.name,
            agentId: chat.primaryAgentId ?? chat.folderId,
            updatedAt: chat.updatedAt ?? chat.createdAt ?? 0,
            messageCount: msgs.length,
            lastMessage: typeof last?.content === 'string' ? last.content.slice(0, 140) : '',
          };
        });
      return reply(deviceId, { type: 'history.list.result', reqId, chats: summaries });
    }
    case 'history.get': {
      const msgs = useChatStore.getState().messages[frame.chatId] ?? [];
      return reply(deviceId, {
        type: 'history.get.result',
        reqId,
        chatId: frame.chatId,
        messages: msgs.slice(-200).map((m: any) => ({
          id: m.id,
          role: m.role === 'bot' ? 'assistant' : (m.role ?? 'user'),
          content: typeof m.content === 'string' ? m.content : '',
          agentId: m.agentId ?? null,
          timestamp: m.timestamp ?? m.createdAt ?? null,
        })),
      });
    }
    case 'chat.send':
      return handleChatSend(frame);
    case 'chat.cancel':
      activeRuns.get(reqId)?.abort();
      return;
    default:
      if (deviceId) reply(deviceId, { type: 'error', reqId, error: 'unknown_type' });
  }
}

async function handleChatSend(frame: any) {
  const { deviceId, reqId } = frame;
  const text = String(frame.text ?? '').trim();
  if (!text) return reply(deviceId, { type: 'error', reqId, error: 'empty_message' });

  const chatStore = useChatStore.getState();
  const assistants = mobileVisibleAgents();
  const { models, selectedModelId, appSettings, integrations, userProfile, userName } = useSettingsStore.getState();

  const modelConfig = models.find((m: any) => m.id === selectedModelId) ?? models[0] ?? null;
  if (!modelConfig) return reply(deviceId, { type: 'error', reqId, error: 'no_model_configured' });

  const existingChat = frame.chatId ? chatStore.chats.find((c: any) => c.id === frame.chatId) : null;
  const agent =
    assistants.find((a: any) => a.id === frame.agentId) ??
    assistants.find((a: any) => a.id === (existingChat?.primaryAgentId ?? existingChat?.folderId)) ??
    assistants[0];
  if (!agent) return reply(deviceId, { type: 'error', reqId, error: 'no_agent_available' });

  const now = Date.now();
  const chatId = existingChat?.id ?? generateId('chat');
  if (!existingChat) {
    useChatStore.getState().setChats((prev: any[]) => [
      { id: chatId, folderId: agent.id, primaryAgentId: agent.id, participantAgentIds: [agent.id], kind: 'dm', name: text.slice(0, 30) || 'Mobile Session', goal: '', createdAt: now, updatedAt: now },
      ...prev,
    ]);
  }

  const userMsg = { id: generateId('msg'), role: 'user', content: text, attachedFiles: [], isPinned: false, timestamp: now, source: 'mobile' };
  const botMsgId = generateId('msg');
  useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
    ...prev,
    [chatId]: [
      ...(prev[chatId] ?? []),
      userMsg,
      { id: botMsgId, role: 'bot', content: '', agentId: agent.id, agentName: agent.name, isPinned: false, isStreaming: true, timestamp: now },
    ],
  }));
  reply(deviceId, { type: 'chat.accepted', reqId, chatId });

  const history = (useChatStore.getState().messages[chatId] ?? []).filter((m: any) => m.id !== botMsgId);
  const agentPins = useMemoryStore.getState().globalPins
    .filter((p: any) => p.agentId === agent.id)
    .map((p: any) => p.content);

  const controller = new AbortController();
  activeRuns.set(reqId, controller);

  let streamed = '';
  const finalize = (content: string) => {
    useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
      ...prev,
      [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === botMsgId ? { ...m, content, isStreaming: false } : m),
    }));
    useChatStore.getState().setChats((prev: any[]) => prev.map((c: any) => c.id === chatId ? { ...c, updatedAt: Date.now() } : c));
    useChatStore.getState().persist().catch(() => {});
  };

  try {
    const response = await generateTextResponse({
      messages: history,
      modelConfig,
      profile: userProfile,
      userName,
      attachedDocs: [],
      agent,
      tasks: [],
      recurringEvents: [],
      mode: 'text',
      canvasContent: null,
      isDeepThinking: false,
      agentPinnedMessages: agentPins,
      onChunk: (chunk: string) => {
        streamed += chunk;
        useChatStore.getState().setMessages((prev: Record<string, any[]>) => ({
          ...prev,
          [chatId]: (prev[chatId] ?? []).map((m: any) => m.id === botMsgId ? { ...m, content: streamed } : m),
        }));
        reply(deviceId, { type: 'chat.token', reqId, chatId, token: chunk });
      },
      signal: controller.signal,
      appSettings,
      integrations,
      models,
      runIntegrationTools: null,
    });
    finalize(response);
    reply(deviceId, {
      type: 'chat.done',
      reqId,
      chatId,
      message: { id: botMsgId, role: 'assistant', content: response, agentId: agent.id, agentName: agent.name, timestamp: Date.now() },
    });
  } catch (e: any) {
    finalize(streamed);
    if (e?.name === 'AbortError') {
      reply(deviceId, { type: 'chat.cancelled', reqId, chatId });
    } else {
      reply(deviceId, { type: 'error', reqId, chatId, error: e?.message ?? String(e) });
    }
  } finally {
    activeRuns.delete(reqId);
  }
}
