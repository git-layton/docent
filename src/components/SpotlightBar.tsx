import React, { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { Brain, Globe, X, Send, ChevronDown, Square, Plus, Clock, Pencil, Check, RefreshCw, Cpu, Copy, Volume2, VolumeX } from 'lucide-react';
type Mode = 'text';
import { generateTextResponse } from '../services/llm';
import { db } from '../services/database';
import { FormattedText } from './ui/FormattedText';
import { buildGroundedMarkdown } from '../services/grounding';
import { normalizeChatRecord } from '../services/channels';
import { DEFAULT_ASSISTANT } from '../store/useAgentStore';

/** Renders assistant markdown: code fences get a styled block, everything else goes to FormattedText. */
function SpotlightMd({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const fence = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null;
  let key = 0;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) parts.push(<FormattedText key={key++} text={text.slice(last, m.index)} />);
    const code = m[2].trimEnd();
    parts.push(
      <div key={key++} className="relative my-2 rounded-xl overflow-hidden"
        style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {m[1] && <span className="absolute top-2 right-2 text-[9px] font-bold text-slate-500 uppercase">{m[1]}</span>}
        <pre className="overflow-x-auto px-4 py-3 text-[11px] text-slate-300 leading-relaxed"><code>{code}</code></pre>
      </div>
    );
    last = fence.lastIndex;
  }
  if (last < text.length) parts.push(<FormattedText key={key++} text={text.slice(last)} />);
  return <>{parts}</>;
}

interface Msg { id: string; role: 'user' | 'assistant'; content: string; timestamp: number; }
interface Chat {
  id: string;
  folderId?: string;
  name: string;
  updatedAt?: number;
  kind?: 'dm' | 'channel' | 'local';
  primaryAgentId?: string;
  participantAgentIds?: string[];
  createdAt?: number;
  goal?: string;
}

const RECENT_COUNT = 5;

function domainOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}
function newId() { return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

export default function SpotlightBar() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Record<string, Msg[]>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showHotkeyOnboarding, setShowHotkeyOnboarding] = useState(false);
  const [pageCards, setPageCards] = useState<Record<string, { title: string; url: string; text: string }>>({});
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // Tab: keep last known value — cleared on focus, repopulated from Rust pre-fetch
  const [tab, setTab] = useState<{ title: string; url: string; browser?: string; hasText?: boolean } | null>(null);
  const [showPageReadingHelp, setShowPageReadingHelp] = useState(false);
  const showPageReadingHelpRef = useRef(false);
  const [helpBtnRect, setHelpBtnRect] = useState<DOMRect | null>(null);
  const pageReadingHelpRef = useRef<HTMLDivElement>(null);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const [tabFetching, setTabFetching] = useState(false);
  const [preferredBrowser, setPreferredBrowser] = useState<'chrome' | 'safari'>('chrome');
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isDeepThinking, setIsDeepThinking] = useState(true);
  const [useTab, setUseTab] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find(c => c.id === activeChatId) ?? null;
  const activeMessages = activeChatId ? (messages[activeChatId] ?? []) : [];
  const selectedAgent = agents.find(a => a.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedModel = models.find(m => m.id === selectedModelId) ?? models[0] ?? null;

  const fetchTab = useCallback(async (pref?: 'auto' | 'chrome' | 'safari') => {
    setTabFetching(true);
    try {
      const r = await invoke<{ title: string; url: string; text?: string; browser?: string; error?: string }>(
        'get_active_tab',
        { preferred: pref ?? preferredBrowser }
      );
      if (r.url) setTab({ title: r.title, url: r.url, browser: r.browser, hasText: !!r.text && r.text.length > 0 });
    } catch { /* keep existing tab */ } finally {
      setTabFetching(false);
    }
  }, [preferredBrowser]);

  const persistChats = useCallback(async (updatedChats: Chat[], updatedMessages: Record<string, Msg[]>) => {
    await db.set('chats', updatedChats);
    await db.set('messages', updatedMessages);
    emit('spotlight-chat-updated', null).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      await db.init();
      const [storedChats, storedMessages, storedAgents, storedModels, storedSettings, onboarded, hotkeyOnboarded, storedBrowser] = await Promise.all([
        db.get('chats', []),
        db.get('messages', {}),
        db.get('assistants', []),
        db.get('models', []),
        db.get('settings', {}),
        db.get('spotlightOnboarded', false),
        db.get('spotlightHotkeyOnboarded', false),
        db.get('preferredBrowser', 'chrome'),
      ]);
      if (!onboarded) setShowOnboarding(true);
      if (!hotkeyOnboarded) setShowHotkeyOnboarding(true);
      if (storedBrowser === 'chrome' || storedBrowser === 'safari') setPreferredBrowser(storedBrowser);
      const availableAgents = (storedAgents.length ? storedAgents : [DEFAULT_ASSISTANT]).filter((agent: any) => agent.id !== 'forge-guide');
      const finalAgents = availableAgents.length ? availableAgents : [DEFAULT_ASSISTANT];
      setAgents(finalAgents);
      setSelectedAgentId(finalAgents[0]?.id ?? DEFAULT_ASSISTANT.id);
      if (storedModels.length) {
        setModels(storedModels);
        setSelectedModelId(storedSettings.selectedModelId || storedModels[0]?.id || '');
      }
      setChats(storedChats.map((chat: any) => normalizeChatRecord(chat)));
      setMessages(storedMessages);
      if (storedChats.length) setActiveChatId(storedChats[0].id); // most recent first
    })();
    // Slight delay before first tab fetch — gives time for prev app state to settle
    setTimeout(fetchTab, 200);
  }, [fetchTab]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeMessages]);

  useEffect(() => {
    inputRef.current?.focus();
    const win = getCurrentWindow();
    const unsub = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        inputRef.current?.focus();
        // Clear stale tab first — then populate from Rust cache (pre-fetched before show)
        setTab(null);
        fetchTab();
      }
    });
    return () => { unsub.then(f => f()); };
  }, [fetchTab]);

  useEffect(() => { showPageReadingHelpRef.current = showPageReadingHelp; }, [showPageReadingHelp]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!agentPickerRef.current?.contains(e.target as Node)) setShowAgentPicker(false);
      if (!modelPickerRef.current?.contains(e.target as Node)) setShowModelPicker(false);
      if (!historyRef.current?.contains(e.target as Node)) setShowHistory(false);
      if (!pageReadingHelpRef.current?.contains(e.target as Node) && !helpBtnRef.current?.contains(e.target as Node)) setShowPageReadingHelp(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPageReadingHelpRef.current) { setShowPageReadingHelp(false); }
        else { getCurrentWindow().hide(); }
      }
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', onKey); };
  }, []);

  const startAgentDirect = useCallback(() => {
    const chatId = newId();
    const folderId = selectedAgentId || selectedAgent?.id || 'f-default';
    const chat: Chat = normalizeChatRecord({
      id: chatId,
      folderId,
      primaryAgentId: folderId,
      participantAgentIds: [folderId],
      kind: 'dm',
      name: `${selectedAgent?.name ?? 'Agent'} Direct`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, folderId);
    setChats(prev => {
      const updated = [chat, ...prev];
      persistChats(updated, messages);
      return updated;
    });
    setActiveChatId(chatId);
    setShowHistory(false);
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [selectedAgentId, selectedAgent, messages, persistChats]);

  const switchChat = (id: string) => {
    setActiveChatId(id);
    setShowHistory(false);
    setShowAll(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitName = () => {
    const name = nameInput.trim() || activeChat?.name || 'Chat';
    setChats(prev => {
      const updated = prev.map(c => c.id === activeChatId ? { ...c, name } : c);
      persistChats(updated, messages);
      return updated;
    });
    setEditingName(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') getCurrentWindow().hide();
    if (e.key === 'Enter' && !e.shiftKey && input.trim() && !isStreaming) {
      e.preventDefault();
      send(input.trim());
    }
  };

  const stop = () => abortRef.current?.abort();

  const send = async (command: string) => {
    setInput('');
    // Reuse or create the selected agent's persistent Direct when nothing is active.
    let chatId = activeChatId;
    let currentChats = chats;
    let folderId = selectedAgentId || 'f-default';
    if (!chatId) {
      const existingDirect = chats
        .map((chat: any) => normalizeChatRecord(chat, folderId))
        .find((chat: any) => chat.kind === 'dm' && (chat.primaryAgentId === folderId || chat.folderId === folderId));
      if (existingDirect) {
        chatId = existingDirect.id;
        setActiveChatId(chatId);
      } else {
        chatId = newId();
        const chat: Chat = normalizeChatRecord({
          id: chatId,
          folderId,
          primaryAgentId: folderId,
          participantAgentIds: [folderId],
          kind: 'dm',
          name: `${selectedAgent?.name ?? 'Agent'} Direct`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, folderId);
        currentChats = [chat, ...chats];
        setChats(currentChats);
        setActiveChatId(chatId);
      }
    }

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: command, timestamp: Date.now() };
    const assistantId = `a-${Date.now() + 1}`;
    const assistantMsg: Msg = { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() + 1 };

    const updatedMsgs = { ...messages, [chatId]: [...(messages[chatId] ?? []), userMsg, assistantMsg] };
    const updatedChats = currentChats.map(c =>
      c.id === chatId ? { ...c, updatedAt: Date.now() } : c
    );
    setMessages(updatedMsgs);
    setChats(updatedChats);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      // Re-fetch tab with latest info
      let tabContext = '';
      let tabForCard: { title: string; url: string; text: string } | null = null;
      try {
        const tabResult = await invoke<{ title: string; url: string; text: string; browser?: string; error?: string }>('get_active_tab', { preferred: preferredBrowser });
        if (tabResult.url) {
          setTab({ title: tabResult.title, url: tabResult.url, hasText: !!tabResult.text && tabResult.text.length > 0 });
          if (useTab) {
            tabForCard = { title: tabResult.title, url: tabResult.url, text: tabResult.text || '' };
            tabContext = [
              `=== WEB PAGE CONTEXT ===`,
              `The user is currently viewing the following web page. Use this content to answer their question, summarise, extract information, or perform any task they request on it.`,
              `Title: ${tabResult.title}`,
              `URL: ${tabResult.url}`,
              tabResult.text ? `\nPage content:\n${tabResult.text}` : `(Page text not available — content may be protected or require login.)`,
              `=== END WEB PAGE CONTEXT ===`,
            ].join('\n');
          }
        } else if (useTab && tab) {
          tabContext = `The user was previously viewing: ${tab.title} (${tab.url}) — current page content unavailable.`;
        }
      } catch { if (useTab && tab) tabContext = `The user was previously viewing: ${tab.title} (${tab.url}) — current page content unavailable.`; }

      const modelConfig = selectedModel ?? models[0] ?? null;
      if (!modelConfig) throw new Error('No model configured — open Agent Forge settings first.');

      const basePrompt = selectedAgent?.prompt || 'You are a helpful AI assistant. Be concise and well-structured.';
      const systemPrompt = tabContext
        ? `${basePrompt}\n\n${tabContext}`
        : basePrompt;

      // Attach page context card to the user message so it's visible in the chat
      if (tabForCard) {
        setPageCards(prev => ({ ...prev, [userMsg.id]: tabForCard! }));
      }
      const historyMsgs = (messages[chatId] ?? []).filter(m => m.content).map(m => ({ id: m.id, role: m.role, content: m.content }));
      historyMsgs.push({ id: userMsg.id, role: 'user' as const, content: command });

      let accumulated = '';
      const result = await generateTextResponse({
        messages: historyMsgs,
        modelConfig,
        profile: '',
        attachedDocs: [],
        agent: { prompt: systemPrompt, tools: {}, trainingDocs: [] },
        tasks: [],
        mode: 'text' as Mode,
        canvasContent: null,
        isDeepThinking,
        agentPinnedMessages: [],
        onChunk: (chunk: string) => {
          accumulated += chunk;
          setMessages(prev => ({
            ...prev,
            [chatId!]: (prev[chatId!] ?? []).map(m => m.id === assistantId ? { ...m, content: accumulated } : m),
          }));
        },
        signal: abortRef.current.signal,
        appSettings: {},
        integrations: {},
        models,
      });

      const finalContent = accumulated || (typeof result === 'string' ? result : '') || '(no response)';
      const finalMsgs = {
        ...updatedMsgs,
        [chatId]: (updatedMsgs[chatId] ?? []).map(m => m.id === assistantId ? { ...m, content: finalContent } : m),
      };
      setMessages(finalMsgs);
      await persistChats(updatedChats, finalMsgs);

      // Save to research (best-effort)
      try {
        const kc = await invoke<{ initialized: boolean; path: string }>('init_knowledge_core');
        const now = new Date();
        const slug = slugify(tab?.title || command);
        const filename = `${now.toISOString().slice(0, 10)}-${slug}-${now.getTime()}.md`;
        await invoke('write_memory', {
          path: `${kc.path}/memory/research/${filename}`,
          content: buildGroundedMarkdown(
            {
              title: tab?.title || command,
              type: 'spotlight-capture',
              scope: 'global',
              createdAt: now.toISOString(),
              agentId: selectedAgent?.id,
              agentName: selectedAgent?.name || 'default',
              sourceKind: 'browser_spotlight',
              sourceLabel: tab?.title || 'Browser tab',
              sourceUrl: tab?.url || '',
              evidenceState: tab?.url ? 'source_backed' : 'mixed',
              verification: tab?.url ? 'partially_verified' : 'needs_verification',
              confidence: 'medium',
              processor: 'spotlight',
              tags: ['spotlight', 'research'],
            },
            `## Command
${command}

## Response
${finalContent}`
          ),
          commit_message: `spotlight: ${command.slice(0, 60)}`,
          agent_id: null, context_tokens: null, ram_state: null,
        });
      } catch { /* best-effort */ }

    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      const msg = isAbort ? '_(stopped)_' : `⚠️ ${err?.message ?? (typeof err === 'string' ? err : JSON.stringify(err)) ?? 'Unknown error'}`;
      if (!isAbort) emit('spotlight-log', { level: 'error', msg: `[Spotlight] ${msg}` }).catch(() => {});
      const errMsgs = {
        ...updatedMsgs,
        [chatId!]: (updatedMsgs[chatId!] ?? []).map(m => m.id === assistantId ? { ...m, content: msg } : m),
      };
      setMessages(errMsgs);
      await persistChats(updatedChats, errMsgs);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  const sortedChats = [...chats].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const visibleChats = showAll ? sortedChats : sortedChats.slice(0, RECENT_COUNT);

  return (
    <div className="w-screen h-screen flex flex-col bg-transparent select-none overflow-hidden">
      <div className="flex flex-col flex-1 rounded-2xl overflow-hidden min-h-0"
        style={{
          background: 'rgba(12, 15, 26, 0.95)',
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
          border: '1.5px solid rgba(99, 102, 241, 0.3)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        }}
      >
        {/* ── Row 1: Title bar ── */}
        <div data-tauri-drag-region className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 cursor-grab active:cursor-grabbing shrink-0">

          {/* Chat name + history */}
          <div className="relative flex items-center gap-1 min-w-0" ref={historyRef}>
            {editingName ? (
              <div className="flex items-center gap-1">
                <input ref={e => e?.focus()} value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
                  className="w-36 bg-white/5 border border-indigo-500/40 rounded-lg px-2 py-0.5 text-xs text-white outline-none"
                />
                <button onClick={commitName} className="p-1 text-emerald-400"><Check className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setShowHistory(v => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white px-1.5 py-1 rounded-lg hover:bg-white/5 transition-all max-w-[200px]">
                <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{activeChat?.name ?? 'Directs'}</span>
                <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
              </button>
            )}
            {!editingName && activeChat && (
              <button onClick={() => { setNameInput(activeChat.name); setEditingName(true); }}
                className="p-1 text-slate-600 hover:text-slate-400 transition-colors shrink-0">
                <Pencil className="w-3 h-3" />
              </button>
            )}

            {showHistory && (
              <div className="absolute left-0 top-full mt-1 w-64 rounded-xl overflow-hidden z-50 shadow-2xl"
                style={{ background: 'rgba(15,18,30,0.98)', border: '1px solid rgba(99,102,241,0.3)' }}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recent Directs</span>
                  <button onClick={startAgentDirect}
                    className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded-lg hover:bg-indigo-900/20 transition-all">
                    <Plus className="w-3 h-3" /> New
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto custom-scrollbar">
                  {visibleChats.length === 0 && (
                    <p className="text-xs text-slate-600 text-center px-3 py-4">No directs yet</p>
                  )}
                  {visibleChats.map(chat => (
                    <button key={chat.id} onClick={() => switchChat(chat.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors border-b border-white/[0.03] last:border-0 ${chat.id === activeChatId ? 'bg-indigo-900/20' : 'hover:bg-white/5'}`}>
                      <div className="text-xs font-medium text-slate-200 truncate">{chat.name}</div>
                      <div className="text-[10px] text-slate-600 mt-0.5 flex gap-2">
                        <span>{(messages[chat.id] ?? []).length} msgs</span>
                        <span>·</span>
                        <span>{new Date(chat.updatedAt ?? chat.createdAt ?? Date.now()).toLocaleDateString()}</span>
                      </div>
                    </button>
                  ))}
                </div>
                {sortedChats.length > RECENT_COUNT && (
                  <button onClick={() => setShowAll(v => !v)}
                    className="w-full text-center text-[10px] font-bold text-slate-500 hover:text-slate-300 py-2 border-t border-white/[0.06] hover:bg-white/5 transition-all">
                    {showAll ? 'Show less' : `+${sortedChats.length - RECENT_COUNT} more`}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1" data-tauri-drag-region />

          {/* Agent direct */}
          <button onClick={startAgentDirect}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/20 transition-all shrink-0">
            <Plus className="w-3 h-3" /> Direct
          </button>

          {/* Close */}
          <button onClick={() => getCurrentWindow().hide()}
            className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition-all">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Row 2: Controls toolbar ── */}
        <div className="flex items-center gap-1 px-3 pb-2 shrink-0 border-b border-white/[0.06] overflow-x-auto">

          {/* Agent picker */}
          <div className="relative shrink-0" ref={agentPickerRef}>
            <button onClick={e => { e.stopPropagation(); setShowAgentPicker(v => !v); setShowModelPicker(false); }}
              className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-200 px-2 py-1 rounded-lg hover:bg-white/5 transition-all whitespace-nowrap">
              {truncate(selectedAgent?.name ?? 'Agent', 12)}
              <ChevronDown className="w-3 h-3 opacity-50" />
            </button>
            {showAgentPicker && (
              <div className="absolute left-0 top-full mt-1 w-52 rounded-xl overflow-hidden z-50 shadow-2xl"
                style={{ background: 'rgba(15,18,30,0.98)', border: '1px solid rgba(99,102,241,0.35)' }}>
                {agents.map(agent => (
                  <button key={agent.id} onClick={() => { setSelectedAgentId(agent.id); setShowAgentPicker(false); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${agent.id === selectedAgentId ? 'text-indigo-300 bg-indigo-900/30' : 'text-slate-300 hover:bg-white/5'}`}>
                    {agent.name}
                    {agent.description && <span className="block text-[10px] text-slate-500 truncate">{agent.description}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-slate-700 select-none shrink-0">·</span>

          {/* Model picker */}
          <div className="relative shrink-0" ref={modelPickerRef}>
            <button onClick={e => { e.stopPropagation(); setShowModelPicker(v => !v); setShowAgentPicker(false); }}
              className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-200 px-2 py-1 rounded-lg hover:bg-white/5 transition-all whitespace-nowrap">
              <Cpu className="w-3 h-3 opacity-50" />
              {truncate(selectedModel?.name ?? selectedModel?.id ?? 'Model', 14)}
              <ChevronDown className="w-3 h-3 opacity-50" />
            </button>
            {showModelPicker && (
              <div className="absolute left-0 top-full mt-1 w-56 rounded-xl overflow-hidden z-50 shadow-2xl"
                style={{ background: 'rgba(15,18,30,0.98)', border: '1px solid rgba(99,102,241,0.35)' }}>
                {models.map(model => (
                  <button key={model.id} onClick={() => { setSelectedModelId(model.id); setShowModelPicker(false); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${model.id === selectedModelId ? 'text-indigo-300 bg-indigo-900/30' : 'text-slate-300 hover:bg-white/5'}`}>
                    {model.name ?? model.id}
                    {model.provider && <span className="block text-[10px] text-slate-500">{model.provider}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Browser toggle — persisted */}
          <div className="flex shrink-0 rounded-lg overflow-hidden border border-white/[0.07]">
            {(['chrome', 'safari'] as const).map(b => (
              <button key={b} onClick={() => {
                setPreferredBrowser(b);
                db.set('preferredBrowser', b);
                fetchTab(b);
              }}
                className={`text-[10px] font-bold px-2 py-0.5 capitalize transition-all ${
                  preferredBrowser === b ? 'bg-indigo-600/60 text-indigo-200' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >{b}</button>
            ))}
          </div>

          {/* Page reading help */}
          <div className="shrink-0">
            <button
              ref={helpBtnRef}
              onClick={() => {
                if (!showPageReadingHelp && helpBtnRef.current) setHelpBtnRect(helpBtnRef.current.getBoundingClientRect());
                setShowPageReadingHelp(v => !v);
              }}
              className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                showPageReadingHelp
                  ? 'bg-indigo-600/50 text-indigo-200'
                  : tab && tab.hasText === false
                    ? 'text-amber-400 hover:bg-amber-900/20'
                    : 'text-slate-600 hover:text-slate-400 hover:bg-white/5'
              }`}
              title="Page reading setup"
            >?</button>
          </div>

          <div className="flex-1 shrink-0" />

          {/* Think */}
          <button onClick={() => setIsDeepThinking(v => !v)}
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-all shrink-0 ${isDeepThinking ? 'text-violet-300 bg-violet-900/20 border-violet-700/30' : 'text-slate-600 border-transparent hover:text-slate-400 hover:bg-white/5'}`}>
            <Brain className="w-3 h-3" /> Think
          </button>
        </div>

        {/* ── First-time setup banner ── */}
        {showOnboarding && (
          <div className="mx-3 mt-2 rounded-xl px-3 py-2.5 shrink-0 flex items-start gap-2.5"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
            <span className="text-lg leading-none mt-0.5">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-indigo-300 mb-1">Enable full page reading</p>
              <div className="flex flex-col gap-1">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <span className="text-slate-300 font-semibold">Chrome:</span> View → Developer → <span className="text-slate-200">Allow JavaScript from Apple Events</span>
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <span className="text-slate-300 font-semibold">Safari:</span> Develop → <span className="text-slate-200">Allow Remote Automation</span>
                  <span className="text-slate-600"> (no Develop menu? Safari Settings → Advanced → Show features for web developers)</span>
                </p>
              </div>
            </div>
            <button
              onClick={() => { setShowOnboarding(false); db.set('spotlightOnboarded', true); }}
              className="shrink-0 text-[10px] font-bold text-indigo-400 hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-900/20 transition-all mt-0.5">
              Got it
            </button>
          </div>
        )}

        {/* ── Hotkey onboarding banner ── */}
        {showHotkeyOnboarding && (
          <div className="mx-3 mt-2 rounded-xl px-3 py-2.5 shrink-0 flex items-start gap-2.5"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
            <span className="text-lg leading-none mt-0.5">⌘</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-indigo-300 mb-1">Your agent travels with you</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Press <span className="text-slate-200 font-semibold">⌘⇧F</span> from any Chrome or Safari tab to open Agent Forge with that page's context automatically attached.
              </p>
            </div>
            <button
              onClick={() => { setShowHotkeyOnboarding(false); db.set('spotlightHotkeyOnboarded', true); }}
              className="shrink-0 text-[10px] font-bold text-indigo-400 hover:text-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-900/20 transition-all mt-0.5">
              Got it
            </button>
          </div>
        )}

        {/* ── Messages ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 custom-scrollbar">
          {activeMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center pointer-events-none">
              <p className="text-sm text-slate-500 font-medium">{selectedAgent?.name ?? 'Agent'}</p>
              <p className="text-xs text-slate-600 max-w-xs">{selectedAgent?.description || 'Ask anything — tab context auto-attaches when available.'}</p>
            </div>
          )}
          {activeMessages.map(msg => (
            <div key={msg.id} className={`group flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] text-sm leading-relaxed break-words select-text ${
                msg.role === 'user'
                  ? 'rounded-2xl rounded-br-sm overflow-hidden bg-indigo-600/70 text-white'
                  : 'rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-white/[0.07] text-slate-200 border border-white/[0.06]'
              }`}>
                {msg.role === 'user' && pageCards[msg.id] && (() => {
                  const card = pageCards[msg.id];
                  const expanded = expandedCards.has(msg.id);
                  return (
                    <div className="text-[10px] border-b border-white/10">
                      <button
                        onClick={() => setExpandedCards(prev => {
                          const next = new Set(prev);
                          expanded ? next.delete(msg.id) : next.add(msg.id);
                          return next;
                        })}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10 transition-colors">
                        <Globe className="w-3 h-3 text-white/70 shrink-0" />
                        <span className="flex-1 truncate text-white/80 font-medium">{card.title}</span>
                        <span className="text-white/50 shrink-0">{domainOf(card.url)}</span>
                        <ChevronDown className={`w-3 h-3 text-white/50 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                      {expanded && (
                        <div className="px-3 pb-2 border-t border-white/10">
                          <p className="text-white/50 mt-1.5 mb-1">{card.url}</p>
                          {card.text
                            ? <p className="text-white/60 line-clamp-6 whitespace-pre-wrap">{card.text.slice(0, 600)}{card.text.length > 600 ? '…' : ''}</p>
                            : <p className="text-white/40 italic">Page text not available</p>
                          }
                        </div>
                      )}
                    </div>
                  );
                })()}
                {msg.role === 'user' ? (
                  <div className="px-3.5 py-2.5">
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  </div>
                ) : !msg.content ? (
                  <span className="flex gap-1 items-center py-0.5">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
                  </span>
                ) : (
                  <SpotlightMd text={msg.content} />
                )}
              </div>
              {/* Action buttons — appear on hover, only when there's content */}
              {msg.content && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content);
                      setCopiedId(msg.id);
                      setTimeout(() => setCopiedId(null), 1500);
                    }}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded-md hover:bg-white/5 transition-all"
                  >
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedId === msg.id ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => {
                      if (speakingId === msg.id) {
                        window.speechSynthesis.cancel();
                        setSpeakingId(null);
                      } else {
                        window.speechSynthesis.cancel();
                        const utt = new SpeechSynthesisUtterance(msg.content);
                        utt.onend = () => setSpeakingId(null);
                        window.speechSynthesis.speak(utt);
                        setSpeakingId(msg.id);
                      }
                    }}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded-md hover:bg-white/5 transition-all"
                  >
                    {speakingId === msg.id ? <VolumeX className="w-3 h-3 text-sky-400" /> : <Volume2 className="w-3 h-3" />}
                    {speakingId === msg.id ? 'Stop' : 'Read'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Tab pill ── */}
        <div className="px-3 pb-1 shrink-0 flex items-center gap-1">
          {tab ? (
            <>
              <button onClick={() => setUseTab(v => !v)}
                className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg transition-all ${useTab ? 'text-sky-400/80 bg-sky-900/15' : 'text-slate-600 hover:text-slate-400'}`}>
                <Globe className="w-3 h-3 shrink-0" />
                {tab.browser && tab.browser !== 'curl' && (
                  <span className="text-slate-500 shrink-0 capitalize">{tab.browser} ·</span>
                )}
                <span className="truncate max-w-[220px]">{truncate(tab.title, 34)}</span>
                <span className="text-slate-600 shrink-0">· {domainOf(tab.url)}</span>
              </button>
              {tab.hasText === false && useTab && (
                <button
                  onClick={() => setShowPageReadingHelp(true)}
                  className="text-[10px] font-bold text-amber-400/80 hover:text-amber-300 px-2 py-0.5 rounded-lg hover:bg-amber-900/20 transition-all shrink-0"
                  title="Page text unavailable — click to see setup instructions"
                >{tab.browser === 'chrome' ? 'Chrome setup needed · Fix?' : tab.browser === 'safari' ? 'Safari setup needed · Fix?' : 'No page text · Fix?'}</button>
              )}
            </>
          ) : (
            <span className="text-[10px] text-slate-700 px-2">No tab detected</span>
          )}
          <button onClick={() => fetchTab()} title="Refresh tab"
            className={`p-1 rounded-lg text-slate-700 hover:text-slate-400 transition-all ${tabFetching ? 'animate-spin' : ''}`}>
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {/* ── Input ── */}
        <div className="flex items-end gap-2 px-3 pb-3 pt-1 shrink-0 border-t border-white/[0.05]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 outline-none resize-none focus:border-indigo-500/50 transition-colors min-h-[36px] max-h-[120px] overflow-auto"
            onInput={e => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={isStreaming ? stop : () => input.trim() && send(input.trim())}
            className={`shrink-0 p-2 rounded-xl transition-all ${isStreaming ? 'bg-red-600/80 hover:bg-red-600 text-white' : input.trim() ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-white/5 text-slate-600 cursor-default'}`}>
            {isStreaming ? <Square className="w-4 h-4 fill-current" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Page reading help popover — fixed so it escapes overflow:hidden containers */}
      {showPageReadingHelp && helpBtnRect && (
        <div ref={pageReadingHelpRef} className="fixed w-72 rounded-xl z-[200] shadow-2xl p-3 space-y-2"
          style={{
            background: 'rgba(15,18,30,0.98)',
            border: '1px solid rgba(99,102,241,0.35)',
            left: helpBtnRect.left,
            top: helpBtnRect.bottom + 6,
          }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Enable Page Reading</p>
          {tab?.browser !== 'safari' && (
            <div className="space-y-0.5">
              <p className="text-[11px] font-bold text-slate-300">Chrome</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">View → Developer → <span className="text-slate-200 font-semibold">Allow JavaScript from Apple Events</span></p>
            </div>
          )}
          {tab?.browser !== 'safari' && tab?.browser !== 'chrome' && <div className="border-t border-white/[0.06]" />}
          {tab?.browser !== 'chrome' && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-slate-300">Safari</p>
              <p className="text-[11px] text-slate-400 leading-relaxed"><span className="text-slate-200 font-semibold">Step 1:</span> Settings → Advanced → enable <span className="text-slate-200 font-semibold">Show features for web developers</span></p>
              <p className="text-[11px] text-slate-400 leading-relaxed"><span className="text-slate-200 font-semibold">Step 2:</span> Develop → <span className="text-slate-200 font-semibold">Allow Remote Automation</span></p>
            </div>
          )}
          <div className="border-t border-white/[0.06]" />
          <p className="text-[10px] text-slate-600 leading-relaxed">After enabling, press ⌘⇧F again to refresh.</p>
        </div>
      )}
    </div>
  );
}
