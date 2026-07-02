import React, { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { writeMemory } from '../lib/ipc';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { Brain, Globe, X, Send, ChevronDown, Square, Plus, Clock, Pencil, Check, RefreshCw, Cpu, Copy, Volume2, VolumeX, Monitor, ExternalLink, RotateCw } from 'lucide-react';
import { relaunch } from '@tauri-apps/plugin-process';
type Mode = 'text';
import { generateTextResponse } from '../services/llm';
import { db } from '../services/database';
import { speak, cancelSpeech, resolveVoicePrefs, loadVoices } from '../lib/voice';
import { FormattedText } from './ui/FormattedText';
import { AgentIcon } from './ui/AgentIcon';

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
        style={{ background: 'var(--af-inset)', border: '1px solid var(--af-edge)' }}>
        {m[1] && <span className="absolute top-2 right-2 text-[9px] font-bold text-ink-3 uppercase">{m[1]}</span>}
        <pre className="overflow-x-auto px-4 py-3 text-[11px] text-ink-2 leading-relaxed"><code>{code}</code></pre>
      </div>
    );
    last = fence.lastIndex;
  }
  if (last < text.length) parts.push(<FormattedText key={key++} text={text.slice(last)} />);
  return <>{parts}</>;
}

interface Msg { id: string; role: 'user' | 'assistant'; content: string; timestamp: number; }
interface Chat { id: string; folderId: string; name: string; updatedAt: number; }

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
  const [pageCards, setPageCards] = useState<Record<string, { title: string; url: string; text: string; kind?: 'screen' }>>({});
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // Tab: keep last known value — cleared on focus, repopulated from Rust pre-fetch
  const [tab, setTab] = useState<{ title: string; url: string; browser?: string; hasText?: boolean } | null>(null);
  const [showPageReadingHelp, setShowPageReadingHelp] = useState(false);
  const [screenAccessNeeded, setScreenAccessNeeded] = useState(false);
  const [screenMode, setScreenMode] = useState(true);
  // Ref mirror so long-lived listeners (mount/focus effects) see the current mode without resubscribing.
  const screenModeRef = useRef(screenMode);
  useEffect(() => { screenModeRef.current = screenMode; }, [screenMode]);
  const showPageReadingHelpRef = useRef(false);
  const [helpBtnRect, setHelpBtnRect] = useState<DOMRect | null>(null);
  const pageReadingHelpRef = useRef<HTMLDivElement>(null);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const [tabFetching, setTabFetching] = useState(false);
  const [preferredBrowser, setPreferredBrowser] = useState<'chrome' | 'safari'>('chrome');
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  // App-wide TTS defaults (per-agent voice overrides these). Read from the shared store.
  const [voiceDefaults, setVoiceDefaults] = useState<{ voiceURI?: string; rate?: number; pitch?: number }>({});
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isDeepThinking, setIsDeepThinking] = useState(false);
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

  // The Spotlight window lives for the whole app session, so anything loaded only at mount goes
  // stale the moment the user edits it in the MAIN window (adds an API key, creates an agent,
  // switches the default model). Re-pull the config slice every time the overlay is summoned.
  // Chats/messages are deliberately NOT touched here — they stream live and merge via persistChats.
  const refreshFromStore = useCallback(async () => {
    try {
      const [storedAgents, storedModels, storedSettings, spotAgentId, spotModelId] = await Promise.all([
        db.get('assistants', []),
        db.get('models', []),
        db.get('settings', {}),
        db.get('spotlightAgentId', ''),
        db.get('spotlightModelId', ''),
      ]);
      if (storedAgents.length) {
        setAgents(storedAgents);
        setSelectedAgentId(prev => {
          const valid = (id: string) => storedAgents.some((a: any) => a.id === id);
          return valid(prev) ? prev : valid(spotAgentId) ? spotAgentId : storedAgents[0].id;
        });
      }
      if (storedModels.length) {
        setModels(storedModels);
        setSelectedModelId(prev => {
          const valid = (id: string) => storedModels.some((m: any) => m.id === id);
          return valid(prev) ? prev : valid(spotModelId) ? spotModelId : (storedSettings.selectedModelId || storedModels[0]?.id || '');
        });
      }
    } catch { /* keep the last known config */ }
  }, []);

  const persistChats = useCallback(async (updatedChats: Chat[], updatedMessages: Record<string, Msg[]>) => {
    const [storedChats, storedMessages] = await Promise.all([
      db.get('chats', []),
      db.get('messages', {}),
    ]);
    const byId = new Map<string, Chat>();
    for (const chat of storedChats) byId.set(chat.id, chat);
    for (const chat of updatedChats) byId.set(chat.id, chat);
    const mergedChats = Array.from(byId.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    await db.set('chats', mergedChats);
    await db.set('messages', { ...storedMessages, ...updatedMessages });
    emit('spotlight-chat-updated', null).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      await db.init();
      const [storedChats, storedMessages, storedAgents, storedModels, storedSettings, storedAppSettings, onboarded, hotkeyOnboarded, storedBrowser, spotAgentId, spotModelId, spotSource] = await Promise.all([
        db.get('chats', []),
        db.get('messages', {}),
        db.get('assistants', []),
        db.get('models', []),
        db.get('settings', {}),
        db.get('appSettings', {}),
        db.get('spotlightOnboarded', false),
        db.get('spotlightHotkeyOnboarded', false),
        db.get('preferredBrowser', 'chrome'),
        // Spotlight's OWN last selections — the overlay must remember what the user picked here,
        // independent of the main window's defaults (which used to clobber it on every launch).
        db.get('spotlightAgentId', ''),
        db.get('spotlightModelId', ''),
        db.get('spotlightSource', 'screen'),
      ]);
      setVoiceDefaults({ voiceURI: storedAppSettings.ttsVoiceURI, rate: storedAppSettings.ttsRate, pitch: storedAppSettings.ttsPitch });
      void loadVoices();
      if (!onboarded) setShowOnboarding(true);
      if (!hotkeyOnboarded) setShowHotkeyOnboarding(true);
      if (storedBrowser === 'chrome' || storedBrowser === 'safari') setPreferredBrowser(storedBrowser);
      if (spotSource === 'chrome' || spotSource === 'safari') { setScreenMode(false); setPreferredBrowser(spotSource); }
      else setScreenMode(true);
      if (storedAgents.length) {
        setAgents(storedAgents);
        setSelectedAgentId(storedAgents.some((a: any) => a.id === spotAgentId) ? spotAgentId : storedAgents[0].id);
      }
      if (storedModels.length) {
        setModels(storedModels);
        setSelectedModelId(
          storedModels.some((m: any) => m.id === spotModelId) ? spotModelId : (storedSettings.selectedModelId || storedModels[0]?.id || '')
        );
      }
      setChats(storedChats);
      setMessages(storedMessages);
      if (storedChats.length) setActiveChatId(storedChats[0].id); // most recent first
    })();
    // Slight delay before first tab fetch — gives time for prev app state to settle.
    // Skipped in Screen mode: no point firing AppleScript at Chrome for a path we're not using
    // (it can even trigger an Automation permission prompt).
    setTimeout(() => { if (!screenModeRef.current) void fetchTab(); }, 200);
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
        // Pick up any config the user changed in the main window since the overlay last showed
        // (API keys, agents, model selection) — see refreshFromStore.
        void refreshFromStore();
        // Clear stale tab first — then populate from Rust cache (pre-fetched before show).
        // Skipped in Screen mode (also avoids churn when we re-show after a screen capture).
        if (!screenModeRef.current) {
          setTab(null);
          fetchTab();
        }
      }
    });
    return () => { unsub.then(f => f()); };
  }, [fetchTab, refreshFromStore]);

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

  const startNewChat = useCallback(() => {
    const chatId = newId();
    const folderId = selectedAgentId || selectedAgent?.id || 'f-default';
    const chat: Chat = { id: chatId, folderId, name: 'New chat', updatedAt: Date.now() };
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
    // Create new chat if none active
    let chatId = activeChatId;
    let currentChats = chats;
    const folderId = selectedAgentId || 'f-default';
    if (!chatId) {
      chatId = newId();
      const chat: Chat = { id: chatId, folderId, name: truncate(command, 32), updatedAt: Date.now() };
      currentChats = [chat, ...chats];
      setChats(currentChats);
      setActiveChatId(chatId);
    }

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: command, timestamp: Date.now() };
    const assistantId = `a-${Date.now() + 1}`;
    const assistantMsg: Msg = { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() + 1 };

    // Auto-name on first message
    const isFirst = (messages[chatId] ?? []).length === 0;
    const updatedMsgs = { ...messages, [chatId]: [...(messages[chatId] ?? []), userMsg, assistantMsg] };
    const updatedChats = currentChats.map(c =>
      c.id === chatId ? { ...c, name: isFirst ? truncate(command, 32) : c.name, updatedAt: Date.now() } : c
    );
    setMessages(updatedMsgs);
    setChats(updatedChats);
    setIsStreaming(true);
    abortRef.current = new AbortController();

    try {
      // Re-fetch tab with latest info
      let tabContext = '';
      let tabForCard: { title: string; url: string; text: string } | null = null;
      if (!screenMode) {
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
      }

      const modelConfig = selectedModel ?? models[0] ?? null;
      if (!modelConfig) throw new Error('No model configured — open Agent Forge settings first.');

      // Screen eyes: read whatever app is in front (Slack, Messages, Mail, anything) with on-device
      // OCR — no cloud, no API key, no vision model, works with any chat model incl. a local one.
      let screenContext = '';
      if (screenMode) {
        try {
          // Gate on the Screen Recording grant. If it's missing, surface the guided card (and fire
          // the one-time system prompt) instead of silently reading a blank/desktop-only frame.
          const authorized = await invoke<boolean>('screen_capture_authorized').catch(() => true);
          if (!authorized) {
            setScreenAccessNeeded(true);
            invoke('request_screen_capture_access').catch(() => {});
          } else {
            setScreenAccessNeeded(false);
            // Hide the overlay so the capture shows the app underneath — NOT our own chat (otherwise
            // the model reads its own conversation as "screen context" and the target app is
            // occluded). Rust emits `screen-ocr:captured` the moment the frame is grabbed, so we
            // re-show immediately while the slower OCR pass continues.
            const win = getCurrentWindow();
            // show() WITHOUT setFocus(): focusing would activate the whole Agent Forge app and yank
            // the user out of whatever they were reading. The overlay floats back in quietly; the
            // hotkey re-focuses it if they want to type again.
            const reappear = () => { void win.show(); };
            const unlistenCaptured = await listen('screen-ocr:captured', reappear);
            let seen = '';
            try {
              await win.hide();
              seen = await invoke<string>('capture_screen_text');
            } finally {
              unlistenCaptured();
              reappear(); // idempotent safety net — also covers the error path
            }
            if (seen && seen.trim().length > 20) {
              screenContext = [
                `=== SCREEN CONTEXT ===`,
                `The user pressed the hotkey while looking at their screen. Below is the text currently on their screen (read on-device). Use it to answer, summarise, or draft what they ask — refer only to what's relevant.`,
                seen.trim(),
                `=== END SCREEN CONTEXT ===`,
              ].join('\n');
              // Show WHAT was read as an expandable card on the message — same transparency the
              // web-page path gets via tabForCard. Screen reads should never be invisible.
              setPageCards(prev => ({
                ...prev,
                [userMsg.id]: { title: 'Read your screen', url: 'on-device OCR', text: seen.trim(), kind: 'screen' },
              }));
            } else {
              // Empty/near-empty text almost always means Screen Recording isn't effective yet — not
              // granted for THIS build, or granted without a relaunch — so macOS hands back only the
              // desktop and there's nothing to read. Guide the user instead of failing silently.
              setScreenAccessNeeded(true);
            }
          }
        } catch (e) { console.warn('[spotlight] screen read failed:', e); setScreenAccessNeeded(true); }
      }

      const basePrompt = selectedAgent?.prompt || 'You are a helpful AI assistant. Be concise and well-structured.';
      const extraContext = tabContext || screenContext;
      const systemPrompt = extraContext
        ? `${basePrompt}\n\n${extraContext}`
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
        const frontmatter = `---\ntitle: "${(tab?.title || command).replace(/"/g, "'")}"\nsource: "${tab?.url || ''}"\nagent: "${selectedAgent?.name || 'default'}"\ndate: "${now.toISOString()}"\n---\n\n`;
        await writeMemory({
          path: `${kc.path}/memory/research/${filename}`,
          content: frontmatter + `**${command}**\n\n${finalContent}`,
          commitMessage: `spotlight: ${command.slice(0, 60)}`,
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

  const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const visibleChats = showAll ? sortedChats : sortedChats.slice(0, RECENT_COUNT);

  return (
    <div className="w-screen h-screen flex flex-col bg-transparent select-none overflow-hidden">
      <div className="flex flex-col flex-1 rounded-2xl overflow-hidden min-h-0 bg-panel/95 backdrop-blur-[40px] border border-edge-2"
        style={{
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
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
                  className="w-36 bg-inset border border-edge-2 rounded-lg px-2 py-0.5 text-xs text-ink outline-none"
                />
                <button onClick={commitName} className="p-1 text-success"><Check className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setShowHistory(v => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-ink-2 hover:text-ink px-1.5 py-1 rounded-lg hover:bg-wash transition-all max-w-[200px]">
                <Clock className="w-3 h-3 text-ink-3 shrink-0" />
                <span className="truncate">{activeChat?.name ?? 'Chats'}</span>
                <ChevronDown className="w-3 h-3 text-ink-3 shrink-0" />
              </button>
            )}
            {!editingName && activeChat && (
              <button onClick={() => { setNameInput(activeChat.name); setEditingName(true); }}
                className="p-1 text-ink-3 hover:text-ink-2 transition-colors shrink-0">
                <Pencil className="w-3 h-3" />
              </button>
            )}

            {showHistory && (
              <div className="absolute left-0 top-full mt-1 w-64 rounded-xl overflow-hidden z-50 shadow-2xl bg-panel-2 border border-edge-2">
                <div className="flex items-center justify-between px-3 py-2 border-b border-edge">
                  <span className="text-[10px] font-bold text-ink-3 uppercase tracking-wider">All chats</span>
                  <button onClick={startNewChat}
                    className="flex items-center gap-1 text-[10px] font-bold text-accent hover:text-accent-strong px-2 py-0.5 rounded-lg hover:bg-wash transition-all">
                    <Plus className="w-3 h-3" /> New
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto custom-scrollbar">
                  {visibleChats.length === 0 && (
                    <p className="text-xs text-ink-3 text-center px-3 py-4">No chats yet</p>
                  )}
                  {visibleChats.map(chat => (
                    <button key={chat.id} onClick={() => switchChat(chat.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors border-b border-edge last:border-0 ${chat.id === activeChatId ? 'bg-accent-soft/40' : 'hover:bg-wash'}`}>
                      <div className="text-xs font-medium text-ink truncate">{chat.name}</div>
                      <div className="text-[10px] text-ink-3 mt-0.5 flex gap-2">
                        <span>{(messages[chat.id] ?? []).length} msgs</span>
                        <span>·</span>
                        <span>{new Date(chat.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </button>
                  ))}
                </div>
                {sortedChats.length > RECENT_COUNT && (
                  <button onClick={() => setShowAll(v => !v)}
                    className="w-full text-center text-[10px] font-bold text-ink-3 hover:text-ink-2 py-2 border-t border-edge hover:bg-wash transition-all">
                    {showAll ? 'Show less' : `+${sortedChats.length - RECENT_COUNT} more`}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1" data-tauri-drag-region />

          {/* New chat */}
          <button onClick={startNewChat}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-accent/40 text-accent hover:bg-accent-soft/40 transition-all shrink-0">
            <Plus className="w-3 h-3" /> New chat
          </button>

          {/* Close */}
          <button onClick={() => getCurrentWindow().hide()}
            className="p-1.5 rounded-lg text-ink-3 hover:text-danger hover:bg-danger-soft transition-all">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Row 2: Controls toolbar ── */}
        <div className="flex items-center gap-1 px-3 pb-2 shrink-0 border-b border-edge overflow-x-auto">

          {/* Agent picker */}
          <div className="relative shrink-0" ref={agentPickerRef}>
            <button onClick={e => { e.stopPropagation(); setShowAgentPicker(v => !v); setShowModelPicker(false); }}
              className="flex items-center gap-1 text-[10px] font-medium text-ink-3 hover:text-ink px-2 py-1 rounded-lg hover:bg-wash transition-all whitespace-nowrap">
              {truncate(selectedAgent?.name ?? 'Agent', 12)}
              <ChevronDown className="w-3 h-3 opacity-50" />
            </button>
            {showAgentPicker && (
              <div className="absolute left-0 top-full mt-1 w-52 rounded-xl overflow-hidden z-50 shadow-2xl bg-panel-2 border border-edge-2">
                {agents.map(agent => (
                  <button key={agent.id} onClick={() => { setSelectedAgentId(agent.id); db.set('spotlightAgentId', agent.id); setShowAgentPicker(false); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${agent.id === selectedAgentId ? 'text-accent bg-accent-soft/50' : 'text-ink-2 hover:bg-wash'}`}>
                    {agent.name}
                    {agent.description && <span className="block text-[10px] text-ink-3 truncate">{agent.description}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-ink-3 select-none shrink-0">·</span>

          {/* Model picker */}
          <div className="relative shrink-0" ref={modelPickerRef}>
            <button onClick={e => { e.stopPropagation(); setShowModelPicker(v => !v); setShowAgentPicker(false); }}
              className="flex items-center gap-1 text-[10px] font-medium text-ink-3 hover:text-ink px-2 py-1 rounded-lg hover:bg-wash transition-all whitespace-nowrap">
              <Cpu className="w-3 h-3 opacity-50" />
              {truncate(selectedModel?.name ?? selectedModel?.id ?? 'Model', 14)}
              <ChevronDown className="w-3 h-3 opacity-50" />
            </button>
            {showModelPicker && (
              <div className="absolute left-0 top-full mt-1 w-56 rounded-xl overflow-hidden z-50 shadow-2xl bg-panel-2 border border-edge-2">
                {models.map(model => (
                  <button key={model.id} onClick={() => { setSelectedModelId(model.id); db.set('spotlightModelId', model.id); setShowModelPicker(false); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${model.id === selectedModelId ? 'text-accent bg-accent-soft/50' : 'text-ink-2 hover:bg-wash'}`}>
                    {model.name ?? model.id}
                    {model.provider && <span className="block text-[10px] text-ink-3">{model.provider}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Source toggle — Chrome / Safari / Screen */}
          <div className="flex shrink-0 rounded-lg overflow-hidden border border-edge-2">
            {(['chrome', 'safari'] as const).map(b => (
              <button key={b} onClick={() => {
                setScreenMode(false);
                setPreferredBrowser(b);
                db.set('preferredBrowser', b);
                db.set('spotlightSource', b);
                fetchTab(b);
              }}
                className={`text-[10px] font-bold px-2 py-0.5 capitalize transition-all ${
                  !screenMode && preferredBrowser === b ? 'bg-accent text-on-accent' : 'text-ink-3 hover:text-ink-2 hover:bg-wash'
                }`}
              >{b}</button>
            ))}
            <button onClick={() => { setScreenMode(true); db.set('spotlightSource', 'screen'); }}
              className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 transition-all ${
                screenMode ? 'bg-accent text-on-accent' : 'text-ink-3 hover:text-ink-2 hover:bg-wash'
              }`}
            ><Monitor className="w-3 h-3" /> Screen</button>
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
                  ? 'bg-accent-soft text-accent-soft-ink'
                  : tab && tab.hasText === false
                    ? 'text-warning hover:bg-warning-soft'
                    : 'text-ink-3 hover:text-ink-2 hover:bg-wash'
              }`}
              title="Page reading setup"
            >?</button>
          </div>

          <div className="flex-1 shrink-0" />

          {/* Think */}
          <button onClick={() => setIsDeepThinking(v => !v)}
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-all shrink-0 ${isDeepThinking ? 'text-accent-soft-ink bg-accent-soft border-accent/30' : 'text-ink-3 border-transparent hover:text-ink-2 hover:bg-wash'}`}>
            <Brain className="w-3 h-3" /> Think
          </button>
        </div>

        {/* ── First-time setup banner ── */}
        {showOnboarding && (
          <div className="mx-3 mt-2 rounded-xl px-3 py-2.5 shrink-0 flex items-start gap-2.5 bg-accent-soft/30 border border-edge">
            <span className="text-lg leading-none mt-0.5">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-accent mb-1">Enable full page reading</p>
              <div className="flex flex-col gap-1">
                <p className="text-[11px] text-ink-2 leading-relaxed">
                  <span className="text-ink font-semibold">Chrome:</span> View → Developer → <span className="text-ink">Allow JavaScript from Apple Events</span>
                </p>
                <p className="text-[11px] text-ink-2 leading-relaxed">
                  <span className="text-ink font-semibold">Safari:</span> Develop → <span className="text-ink">Allow Remote Automation</span>
                  <span className="text-ink-3"> (no Develop menu? Safari Settings → Advanced → Show features for web developers)</span>
                </p>
              </div>
            </div>
            <button
              onClick={() => { setShowOnboarding(false); db.set('spotlightOnboarded', true); }}
              className="shrink-0 text-[10px] font-bold text-accent hover:text-accent-strong px-2 py-1 rounded-lg hover:bg-wash transition-all mt-0.5">
              Got it
            </button>
          </div>
        )}

        {/* ── Hotkey onboarding banner ── */}
        {showHotkeyOnboarding && (
          <div className="mx-3 mt-2 rounded-xl px-3 py-2.5 shrink-0 flex items-start gap-2.5 bg-accent-soft/30 border border-edge">
            <span className="text-lg leading-none mt-0.5">⌘</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-accent mb-1">Your agent travels with you</p>
              <p className="text-[11px] text-ink-2 leading-relaxed">
                Press <span className="text-ink font-semibold">⌘⇧F</span> from any Chrome or Safari tab to open Agent Forge with that page's context automatically attached.
              </p>
            </div>
            <button
              onClick={() => { setShowHotkeyOnboarding(false); db.set('spotlightHotkeyOnboarded', true); }}
              className="shrink-0 text-[10px] font-bold text-accent hover:text-accent-strong px-2 py-1 rounded-lg hover:bg-wash transition-all mt-0.5">
              Got it
            </button>
          </div>
        )}

        {/* ── Messages ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 custom-scrollbar">
          {activeMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center pointer-events-none">
              <p className="text-sm text-ink-3 font-medium">{selectedAgent?.name ?? 'Agent'}</p>
              <p className="text-xs text-ink-3 max-w-xs">{selectedAgent?.description || 'Ask anything — tab context auto-attaches when available.'}</p>
            </div>
          )}
          {activeMessages.map(msg => (
            <div key={msg.id} className={`group flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.role !== 'user' && (
                <div className="flex items-center gap-1.5 px-0.5">
                  <AgentIcon agent={selectedAgent} sizeClass="w-2.5 h-2.5" containerClass="p-1 rounded-md" />
                  <span className="text-[10px] font-semibold text-ink-3">{selectedAgent?.name ?? 'Assistant'}</span>
                </div>
              )}
              <div className={`max-w-[85%] text-sm leading-relaxed break-words select-text ${
                msg.role === 'user'
                  ? 'rounded-2xl rounded-br-sm overflow-hidden bg-accent text-on-accent'
                  : 'rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-panel-2 text-ink border border-edge'
              }`}>
                {msg.role === 'user' && pageCards[msg.id] && (() => {
                  const card = pageCards[msg.id];
                  const expanded = expandedCards.has(msg.id);
                  return (
                    <div className="text-[10px] border-b border-on-accent/20">
                      <button
                        onClick={() => setExpandedCards(prev => {
                          const next = new Set(prev);
                          expanded ? next.delete(msg.id) : next.add(msg.id);
                          return next;
                        })}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-on-accent/10 transition-colors">
                        {card.kind === 'screen'
                          ? <Monitor className="w-3 h-3 text-on-accent/70 shrink-0" />
                          : <Globe className="w-3 h-3 text-on-accent/70 shrink-0" />}
                        <span className="flex-1 truncate text-on-accent/80 font-medium">{card.title}</span>
                        <span className="text-on-accent/60 shrink-0">{card.kind === 'screen' ? 'private' : domainOf(card.url)}</span>
                        <ChevronDown className={`w-3 h-3 text-on-accent/60 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                      {expanded && (
                        <div className="px-3 pb-2 border-t border-on-accent/20">
                          <p className="text-on-accent/60 mt-1.5 mb-1">{card.url}</p>
                          {card.text
                            ? <p className="text-on-accent/70 line-clamp-6 whitespace-pre-wrap">{card.text.slice(0, 600)}{card.text.length > 600 ? '…' : ''}</p>
                            : <p className="text-on-accent/50 italic">Page text not available</p>
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
                  <span className="flex gap-1.5 items-center py-0.5">
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
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
                    className="flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink-2 px-1.5 py-0.5 rounded-md hover:bg-wash transition-all"
                  >
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                    {copiedId === msg.id ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => {
                      if (speakingId === msg.id) {
                        cancelSpeech();
                        setSpeakingId(null);
                      } else {
                        setSpeakingId(msg.id);
                        speak(msg.content, resolveVoicePrefs(selectedAgent, voiceDefaults), {
                          onEnd: () => setSpeakingId(null),
                          onError: () => setSpeakingId(null),
                        });
                      }
                    }}
                    className="flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink-2 px-1.5 py-0.5 rounded-md hover:bg-wash transition-all"
                  >
                    {speakingId === msg.id ? <VolumeX className="w-3 h-3 text-accent" /> : <Volume2 className="w-3 h-3" />}
                    {speakingId === msg.id ? 'Stop' : 'Read'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Source pill ── */}
        <div className="px-3 pb-1 shrink-0 flex items-center gap-1">
          {screenMode ? (
            <span className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg text-accent bg-accent-soft/40">
              <Monitor className="w-3 h-3 shrink-0" /> Reading your screen
            </span>
          ) : tab ? (
            <>
              <button onClick={() => setUseTab(v => !v)}
                className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg transition-all ${useTab ? 'text-accent bg-accent-soft/40' : 'text-ink-3 hover:text-ink-2'}`}>
                <Globe className="w-3 h-3 shrink-0" />
                {tab.browser && tab.browser !== 'curl' && (
                  <span className="text-ink-3 shrink-0 capitalize">{tab.browser} ·</span>
                )}
                <span className="truncate max-w-[220px]">{truncate(tab.title, 34)}</span>
                <span className="text-ink-3 shrink-0">· {domainOf(tab.url)}</span>
              </button>
              {tab.hasText === false && useTab && (
                <button
                  onClick={() => setShowPageReadingHelp(true)}
                  className="text-[10px] font-bold text-warning hover:text-warning px-2 py-0.5 rounded-lg hover:bg-warning-soft transition-all shrink-0"
                  title="Page text unavailable — click to see setup instructions"
                >{tab.browser === 'chrome' ? 'Chrome setup needed · Fix?' : tab.browser === 'safari' ? 'Safari setup needed · Fix?' : 'No page text · Fix?'}</button>
              )}
            </>
          ) : (
            <span className="text-[10px] text-ink-3 px-2">No tab detected</span>
          )}
          <button onClick={() => fetchTab()} title="Refresh tab"
            className={`p-1 rounded-lg text-ink-3 hover:text-ink-2 transition-all ${tabFetching ? 'animate-spin' : ''}`}>
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {/* ── Screen access grant ── */}
        {screenAccessNeeded && (
          <div className="mx-3 mb-2 p-3 rounded-xl bg-inset border border-edge text-xs leading-relaxed">
            <div className="flex items-center gap-2 mb-1.5 font-bold text-ink">
              <Monitor className="w-4 h-4 text-accent shrink-0" /> Let Agent Forge see your screen
            </div>
            <p className="text-ink-2 mb-2">
              To read what's on screen (Slack, Mail, Messages), turn on <span className="font-semibold text-ink">Screen Recording</span> for Agent Forge, then relaunch.
            </p>
            <ol className="text-ink-2 mb-2.5 ml-4 list-decimal space-y-0.5">
              <li>Click <span className="font-semibold text-ink">Open Screen Recording</span> below.</li>
              <li>Flip the switch next to <span className="font-semibold text-ink">Agent Forge</span> on.</li>
              <li>Click <span className="font-semibold text-ink">Relaunch</span>.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => invoke('open_screen_recording_settings').catch(() => {})}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-accent text-on-accent hover:bg-accent-strong transition-all">
                <ExternalLink className="w-3 h-3" /> Open Screen Recording
              </button>
              <button onClick={() => { void relaunch(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-edge-2 text-ink-2 hover:bg-wash transition-all">
                <RotateCw className="w-3 h-3" /> Relaunch
              </button>
              <button onClick={() => setScreenAccessNeeded(false)}
                className="text-[11px] text-ink-3 hover:text-ink-2 px-2 py-1 transition-colors">Dismiss</button>
            </div>
          </div>
        )}

        {/* ── Input ── */}
        <div className="flex items-end gap-2 px-3 pb-3 pt-1 shrink-0 border-t border-edge">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-inset border border-edge-2 rounded-xl px-3 py-2 text-sm text-ink placeholder:text-ink-3 outline-none resize-none focus:border-accent/50 transition-colors min-h-[36px] max-h-[120px] overflow-auto"
            onInput={e => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={isStreaming ? stop : () => input.trim() && send(input.trim())}
            className={`shrink-0 p-2 rounded-xl transition-all ${isStreaming ? 'bg-danger hover:opacity-90 text-danger-soft' : input.trim() ? 'bg-accent hover:bg-accent-strong text-on-accent' : 'bg-wash text-ink-3 cursor-default'}`}>
            {isStreaming ? <Square className="w-4 h-4 fill-current" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Page reading help popover — fixed so it escapes overflow:hidden containers */}
      {showPageReadingHelp && helpBtnRect && (
        <div ref={pageReadingHelpRef} className="fixed w-72 rounded-xl z-[200] shadow-2xl p-3 space-y-2 bg-panel-2 border border-edge-2"
          style={{
            left: helpBtnRect.left,
            top: helpBtnRect.bottom + 6,
          }}>
          <p className="text-[10px] font-black uppercase tracking-widest text-ink-3">Enable Page Reading</p>
          {tab?.browser !== 'safari' && (
            <div className="space-y-0.5">
              <p className="text-[11px] font-bold text-ink">Chrome</p>
              <p className="text-[11px] text-ink-2 leading-relaxed">View → Developer → <span className="text-ink font-semibold">Allow JavaScript from Apple Events</span></p>
            </div>
          )}
          {tab?.browser !== 'safari' && tab?.browser !== 'chrome' && <div className="border-t border-edge" />}
          {tab?.browser !== 'chrome' && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-ink">Safari</p>
              <p className="text-[11px] text-ink-2 leading-relaxed"><span className="text-ink font-semibold">Step 1:</span> Settings → Advanced → enable <span className="text-ink font-semibold">Show features for web developers</span></p>
              <p className="text-[11px] text-ink-2 leading-relaxed"><span className="text-ink font-semibold">Step 2:</span> Develop → <span className="text-ink font-semibold">Allow Remote Automation</span></p>
            </div>
          )}
          <div className="border-t border-edge" />
          <p className="text-[10px] text-ink-3 leading-relaxed">After enabling, press ⌘⇧F again to refresh.</p>
        </div>
      )}
    </div>
  );
}
