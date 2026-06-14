import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MessageCircle, RotateCw, ArrowLeft, Send, Search, X, ShieldAlert, Users, Paperclip } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../store/useSettingsStore';
import { MessagesSetupWizard } from './MessagesSetupWizard';
import { useToolContextStore } from '../store/useToolContextStore';

// Mirrors the Rust ImessageChat / ImessageMessage structs (serde camelCase).
interface ImessageChat {
  chatId: number;
  guid: string;
  name: string;
  identifier: string;
  isGroup: boolean;
  service: string;
  lastText: string;
  lastDate: number; // unix ms
  lastFromMe: boolean;
}
interface ImessageMessage {
  id: number;
  text: string;
  fromMe: boolean;
  handle: string;
  senderName: string; // resolved contact name, or '' if not in Contacts
  date: number; // unix ms
  service: string;
}

// Apple's bubble palette: iMessage blue, SMS green.
function serviceColor(service: string): string {
  return /sms/i.test(service) ? '#34C759' : '#0B84FE';
}

function initials(name: string): string {
  const src = (name || '?').trim();
  // A handle like "+15551234567" or "a@b.com" has no nice initials — use a glyph instead.
  if (/^[+\d(]/.test(src) || src.includes('@')) return '#';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function formatListDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatBubbleTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Short label for a group sender (first name or the bare handle).
function senderLabel(handle: string): string {
  if (!handle) return '';
  if (handle.includes('@') || /^[+\d]/.test(handle)) return handle;
  return handle.split(/\s+/)[0];
}

function looksLikeNoAccess(err: string): boolean {
  return /Full Disk Access|could not open|Privacy/i.test(err);
}

export function MessagesPanel() {
  const [chats, setChats] = useState<ImessageChat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<ImessageChat | null>(null);
  const [messages, setMessages] = useState<ImessageMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const selectedRef = useRef<ImessageChat | null>(null);
  selectedRef.current = selected;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // First open shows a guided setup; once done (or skipped) we never auto-show it again.
  const setupComplete: boolean = useSettingsStore(s => (s.integrations as any).imessage?.setupComplete) ?? false;
  const completeSetup = (accessOk: boolean) => {
    useSettingsStore.getState().setIntegrations((prev: any) => ({
      ...prev,
      imessage: { ...(prev.imessage ?? {}), enabled: accessOk, setupComplete: true },
    }));
    useSettingsStore.getState().persist();
    // The gated load effect (below) fires once setupComplete flips true.
  };

  const loadChats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const list = await invoke<ImessageChat[]>('imessage_list_chats', { limit: 40 });
      setChats(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (chat: ImessageChat, silent = false) => {
    if (!silent) { setMsgLoading(true); setMsgError(null); }
    try {
      const list = await invoke<ImessageMessage[]>('imessage_fetch_messages', { chatId: chat.chatId, limit: 80 });
      // Ignore a late response if the user switched threads meanwhile.
      if (selectedRef.current?.chatId !== chat.chatId) return;
      setMessages(list);
    } catch (e) {
      if (selectedRef.current?.chatId === chat.chatId) setMsgError(String(e));
    } finally {
      if (!silent) setMsgLoading(false);
    }
  }, []);

  // Initial load + light polling so previews stay fresh (iMessage is real-time-ish).
  // Held off until setup is done so we don't probe (and error) behind the wizard.
  useEffect(() => {
    if (!setupComplete) return;
    loadChats();
    const t = setInterval(() => loadChats(true), 8000);
    return () => clearInterval(t);
  }, [loadChats, setupComplete]);

  // When a thread is open, load it and poll for new messages.
  useEffect(() => {
    if (!selected) return;
    loadMessages(selected);
    const t = setInterval(() => { const s = selectedRef.current; if (s) loadMessages(s, true); }, 3000);
    return () => clearInterval(t);
  }, [selected, loadMessages]);

  // Keep the thread pinned to the latest message as it grows.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, selected]);

  // Publish the messages view to the docked agent's context (open thread, or the conversation list).
  useEffect(() => {
    const text = selected
      ? `Conversation with ${selected.name}:\n` + messages.slice(-30).map(m => `${m.fromMe ? 'You' : (m.senderName || selected.name)}: ${m.text}`).join('\n')
      : (chats.slice(0, 30).map(c => `${c.name}${c.lastText ? ` — ${c.lastText}` : ''}`).join('\n') || '(no conversations)');
    useToolContextStore.getState().setToolContext({ label: selected ? `Messages: ${selected.name}` : 'Messages', text, source: 'messages' });
    return () => useToolContextStore.getState().clearToolContext();
  }, [selected, messages, chats]);

  const filteredChats = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(c => c.name.toLowerCase().includes(q) || c.lastText.toLowerCase().includes(q) || c.identifier.toLowerCase().includes(q));
  }, [chats, search]);

  const openSettings = () => { invoke('imessage_open_fda_settings').catch(() => {}); };

  const send = async () => {
    const chat = selected;
    const text = draft.trim();
    if (!chat || !text) return;
    setSending(true);
    setSendError(null);
    // Optimistic echo for instant feedback; the next poll replaces it with the real row.
    const optimistic: ImessageMessage = { id: -Date.now(), text, fromMe: true, handle: '', senderName: '', date: Date.now(), service: chat.service };
    setMessages(prev => [...prev, optimistic]);
    setDraft('');
    try {
      await invoke('imessage_send', { chatGuid: chat.guid, text });
      // Give Messages a beat to write to chat.db, then reconcile from the source of truth.
      setTimeout(() => { const s = selectedRef.current; if (s?.chatId === chat.chatId) loadMessages(s, true); }, 800);
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id)); // revert — it never sent
      setDraft(text); // restore so the user doesn't lose their text
      setSendError(String(e));
    } finally {
      setSending(false);
    }
  };

  const noAccess = !!error && looksLikeNoAccess(error) && chats.length === 0;

  // ── First-open setup wizard ──
  if (!setupComplete) {
    return <MessagesSetupWizard onComplete={completeSetup} />;
  }

  // ── Thread view ──
  if (selected) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
        <div className="h-12 flex items-center gap-3 px-3 border-b border-edge shrink-0">
          <button onClick={() => { setSelected(null); setMessages([]); setSendError(null); }} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-7 h-7 rounded-full bg-inset flex items-center justify-center text-[11px] font-semibold text-ink-2 shrink-0">
            {selected.isGroup ? <Users className="w-3.5 h-3.5" /> : initials(selected.name)}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-ink truncate">{selected.name}</span>
            <span className="text-[11px] text-ink-3 truncate flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: serviceColor(selected.service) }} />
              {/sms/i.test(selected.service) ? 'SMS' : 'iMessage'}{selected.isGroup ? ' · Group' : ''}
            </span>
          </div>
          <div className="flex-1" />
          <button onClick={() => loadMessages(selected)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Refresh">
            <RotateCw className={clsx('w-3.5 h-3.5', msgLoading && 'animate-spin')} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-1.5">
          {msgLoading && messages.length === 0 ? (
            <div className="h-full flex items-center justify-center gap-2 text-ink-3"><RotateCw className="w-5 h-5 animate-spin" /><span className="text-sm">Loading conversation…</span></div>
          ) : msgError ? (
            <div className="p-4 text-sm text-danger">Couldn't load messages: {msgError}</div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-ink-3">No messages yet.</div>
          ) : (
            messages.map((m, i) => {
              const showSender = selected.isGroup && !m.fromMe && m.handle && m.handle !== messages[i - 1]?.handle;
              return (
                <div key={m.id} className={clsx('flex flex-col max-w-[78%]', m.fromMe ? 'self-end items-end' : 'self-start items-start')}>
                  {showSender && <span className="text-[11px] text-ink-3 px-1 mb-0.5">{m.senderName || senderLabel(m.handle)}</span>}
                  <div
                    className={clsx(
                      'rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words',
                      m.fromMe ? 'bg-accent text-on-accent rounded-br-md' : 'bg-inset text-ink rounded-bl-md',
                    )}
                    title={formatBubbleTime(m.date)}
                  >
                    {m.text || <span className="italic opacity-70 inline-flex items-center gap-1"><Paperclip className="w-3 h-3" /> Attachment</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="shrink-0 border-t border-edge p-3">
          {sendError && (
            <div className="mb-2 px-3 py-1.5 text-[11px] text-danger bg-danger-soft/40 rounded-lg flex items-center gap-2">
              <span className="flex-1 break-words">✗ {sendError}</span>
              <button onClick={() => setSendError(null)}><X className="w-3 h-3" /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={`Message ${selected.name}…`}
              rows={1}
              className="flex-1 resize-none max-h-32 bg-inset border border-edge-2 rounded-2xl px-4 py-2.5 text-sm text-ink outline-none focus:border-accent transition-colors leading-snug"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              className="p-2.5 rounded-full bg-accent text-on-accent hover:bg-accent-strong transition-opacity disabled:opacity-40 shrink-0"
              title="Send"
            >
              {sending ? <RotateCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Conversation list ──
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <MessageCircle className="w-4 h-4 text-ink-3" />
        <span className="text-sm font-semibold text-ink">Messages</span>
        {chats.length > 0 && <span className="text-xs text-ink-3">{chats.length}</span>}
        <div className="flex-1" />
        <button onClick={() => loadChats()} disabled={loading} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Refresh">
          <RotateCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {chats.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-edge shrink-0">
          <Search className="w-3.5 h-3.5 text-ink-3 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations"
            className="flex-1 bg-transparent text-xs text-ink-2 outline-none placeholder:text-ink-3"
          />
          {search && <button onClick={() => setSearch('')}><X className="w-3.5 h-3.5 text-ink-3" /></button>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {noAccess ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
            <ShieldAlert className="w-8 h-8 text-ink-3" />
            <p className="text-sm font-semibold text-ink">Full Disk Access needed</p>
            <p className="text-xs text-ink-2 max-w-xs leading-relaxed">
              To read your iMessage & SMS history, grant <span className="font-semibold">Agent Forge</span> Full Disk Access, then come back and refresh.
            </p>
            <button onClick={openSettings} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity">
              Open Privacy settings
            </button>
            <button onClick={() => loadChats()} className="text-[11px] font-medium text-ink-3 hover:text-ink">I've granted it — refresh</button>
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-danger">Couldn't load Messages: {error}</div>
        ) : loading && chats.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-3"><RotateCw className="w-5 h-5 animate-spin" /><span className="text-sm">Loading your conversations…</span></div>
        ) : filteredChats.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-ink-3">{search ? 'No matching conversations.' : 'No conversations yet.'}</div>
        ) : (
          filteredChats.map(c => (
            <button
              key={c.chatId}
              onClick={() => { setSelected(c); setMessages([]); setDraft(''); setSendError(null); }}
              className="w-full flex items-start gap-3 px-4 py-3 border-b border-edge hover:bg-wash transition-colors text-left"
            >
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-full bg-inset flex items-center justify-center text-xs font-semibold text-ink-2">
                  {c.isGroup ? <Users className="w-4 h-4" /> : initials(c.name)}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-panel" style={{ background: serviceColor(c.service) }} title={/sms/i.test(c.service) ? 'SMS' : 'iMessage'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink truncate">{c.name || c.identifier}</span>
                  <div className="flex-1" />
                  <span className="text-xs text-ink-3 shrink-0">{formatListDate(c.lastDate)}</span>
                </div>
                <div className="text-sm text-ink-2 truncate">
                  {c.lastFromMe && <span className="text-ink-3">You: </span>}
                  {c.lastText || <span className="italic text-ink-3">Attachment</span>}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
