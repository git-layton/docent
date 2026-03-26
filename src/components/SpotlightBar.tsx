import React, { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { Brain, Globe, X, Send, ChevronDown, Square, Plus, Clock, Pencil, Check, RefreshCw, Cpu, Copy, Volume2, VolumeX } from 'lucide-react';
type Mode = 'text';
import { generateTextResponse } from '../services/llm';
import { db } from '../services/database';

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // Tab: keep last known value — don't clear on focus (focus race with browser)
  const [tab, setTab] = useState<{ title: string; url: string } | null>(null);
  const [tabFetching, setTabFetching] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
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

  const fetchTab = useCallback(async () => {
    setTabFetching(true);
    try {
      const r = await invoke<{ title: string; url: string; error?: string }>('get_active_tab');
      // Only update tab if we got a real URL — don't clear if empty (focus race)
      if (r.url) setTab({ title: r.title, url: r.url });
    } catch { /* keep existing tab */ } finally {
      setTabFetching(false);
    }
  }, []);

  const persistChats = useCallback(async (updatedChats: Chat[], updatedMessages: Record<string, Msg[]>) => {
    await db.set('chats', updatedChats);
    await db.set('messages', updatedMessages);
    emit('spotlight-chat-updated', null).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      await db.init();
      const [storedChats, storedMessages, storedAgents, storedModels, storedSettings, onboarded] = await Promise.all([
        db.get('chats', []),
        db.get('messages', {}),
        db.get('assistants', []),
        db.get('models', []),
        db.get('settings', {}),
        db.get('spotlightOnboarded', false),
      ]);
      if (!onboarded) setShowOnboarding(true);
      if (storedAgents.length) { setAgents(storedAgents); setSelectedAgentId(storedAgents[0].id); }
      if (storedModels.length) {
        setModels(storedModels);
        setSelectedModelId(storedSettings.selectedModelId || storedModels[0]?.id || '');
      }
      setChats(storedChats);
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

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!agentPickerRef.current?.contains(e.target as Node)) setShowAgentPicker(false);
      if (!modelPickerRef.current?.contains(e.target as Node)) setShowModelPicker(false);
      if (!historyRef.current?.contains(e.target as Node)) setShowHistory(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
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
    let folderId = selectedAgentId || 'f-default';
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
      try {
        const tabResult = await invoke<{ title: string; url: string; text: string; error?: string }>('get_active_tab');
        if (tabResult.url) {
          setTab({ title: tabResult.title, url: tabResult.url });
          if (useTab && tabResult.text) tabContext = `Active browser tab:\nTitle: ${tabResult.title}\nURL: ${tabResult.url}\n\n${tabResult.text}`;
          else if (useTab) tabContext = `Active browser tab URL: ${tabResult.url}`;
        } else if (useTab && tab) {
          tabContext = `User was previously viewing: ${tab.title} (${tab.url})`;
        }
      } catch { if (useTab && tab) tabContext = `User was previously viewing: ${tab.title} (${tab.url})`; }

      const modelConfig = selectedModel ?? models[0] ?? null;
      if (!modelConfig) throw new Error('No model configured — open Agent Forge settings first.');

      const basePrompt = selectedAgent?.prompt || 'You are a helpful AI assistant. Be concise and well-structured.';
      const systemPrompt = tabContext ? `${basePrompt}\n\n${tabContext}` : basePrompt;
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
        await invoke('write_memory', {
          path: `${kc.path}/memory/research/${filename}`,
          content: frontmatter + `**${command}**\n\n${finalContent}`,
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

  const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
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
                <span className="truncate">{activeChat?.name ?? 'Chats'}</span>
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
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">All chats</span>
                  <button onClick={startNewChat}
                    className="flex items-center gap-1 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded-lg hover:bg-indigo-900/20 transition-all">
                    <Plus className="w-3 h-3" /> New
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto custom-scrollbar">
                  {visibleChats.length === 0 && (
                    <p className="text-xs text-slate-600 text-center px-3 py-4">No chats yet</p>
                  )}
                  {visibleChats.map(chat => (
                    <button key={chat.id} onClick={() => switchChat(chat.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors border-b border-white/[0.03] last:border-0 ${chat.id === activeChatId ? 'bg-indigo-900/20' : 'hover:bg-white/5'}`}>
                      <div className="text-xs font-medium text-slate-200 truncate">{chat.name}</div>
                      <div className="text-[10px] text-slate-600 mt-0.5 flex gap-2">
                        <span>{(messages[chat.id] ?? []).length} msgs</span>
                        <span>·</span>
                        <span>{new Date(chat.updatedAt).toLocaleDateString()}</span>
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

          {/* New chat */}
          <button onClick={startNewChat}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/20 transition-all shrink-0">
            <Plus className="w-3 h-3" /> New chat
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

          <div className="flex-1 shrink-0" />

          {/* Think */}
          <button onClick={() => setIsDeepThinking(v => !v)}
            className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-all shrink-0 ${isDeepThinking ? 'text-violet-300 bg-violet-900/20 border-violet-700/30' : 'text-slate-600 border-transparent hover:text-slate-400 hover:bg-white/5'}`}>
            <Brain className="w-3 h-3" /> Think
          </button>
        </div>

        {/* ── First-time setup banner ── */}
        {showOnboarding && (
          <div className="mx-3 mt-2 mb-0 rounded-xl px-3 py-2.5 shrink-0 flex items-start gap-2.5"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
            <span className="text-lg leading-none mt-0.5">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-indigo-300 mb-0.5">Enable full page reading</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                In Chrome: <span className="text-slate-200 font-medium">View → Developer → Allow JavaScript from Apple Events</span>
                <br />This lets Forge read the live text of any page — including logins and Cloudflare-protected sites.
              </p>
            </div>
            <button
              onClick={() => { setShowOnboarding(false); db.set('spotlightOnboarded', true); }}
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
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words select-text ${
                msg.role === 'user'
                  ? 'bg-indigo-600/70 text-white rounded-br-sm'
                  : 'bg-white/[0.07] text-slate-200 rounded-bl-sm border border-white/[0.06]'
              }`}>
                {msg.role === 'assistant' && !msg.content
                  ? <span className="flex gap-1 items-center py-0.5">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay:'0ms'}} />
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
                    </span>
                  : <span className="whitespace-pre-wrap">{msg.content}</span>
                }
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
            <button onClick={() => setUseTab(v => !v)}
              className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-lg transition-all ${useTab ? 'text-sky-400/80 bg-sky-900/15' : 'text-slate-600 hover:text-slate-400'}`}>
              <Globe className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[260px]">{truncate(tab.title, 38)}</span>
              <span className="text-slate-600 shrink-0">· {domainOf(tab.url)}</span>
            </button>
          ) : (
            <span className="text-[10px] text-slate-700 px-2">No tab detected</span>
          )}
          <button onClick={fetchTab} title="Refresh tab"
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
    </div>
  );
}
