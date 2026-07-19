import { useState, useEffect, useRef, useMemo } from 'react';
import { MessageCircle, RotateCw, ArrowLeft, Send, Search, X, ShieldAlert, Users, Paperclip, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { MessagesSetupWizard } from './MessagesSetupWizard';
import { useToolContextStore } from '../store/useToolContextStore';
import { normalizeVoiceProfile, relKeyForImessage } from '../services/voice';
import { usePanelResource } from '../lib/panelCache';
import { buildVoiceCard, buildRelationshipVoiceCard, draftReply } from '../services/voiceRuntime';
import { generateTextResponse } from '../services/llm';

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
  unread: number; // unread incoming messages — mirrors Messages.app read state
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
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ImessageChat | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // "Write like me" — on-demand reply suggestions in the user's own voice.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const hasModel = useSettingsStore(s => s.models.length > 0);

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
    // The chats resource below is gated on setupComplete, so it starts once this flips true.
  };

  // Conversation list — state-alive across tab switches: hydrates instantly from the panel
  // cache on remount, revalidates silently, and polls so previews stay fresh. Gated behind
  // setup so we don't probe (and error) behind the wizard.
  const { data: chats = [], loading, error, refresh: refreshChats } = usePanelResource<ImessageChat[]>({
    key: 'imessage:chats',
    fetch: () => invoke<ImessageChat[]>('imessage_list_chats', { limit: 40 }),
    enabled: setupComplete,
    pollMs: 8000,
  });

  // Open thread — keyed per chat, so switching threads can never cross-paint and a previously
  // read thread reopens instantly from cache while the poll reconciles in the background.
  const {
    data: messages = [],
    loading: msgLoading,
    error: msgError,
    refresh: refreshMessages,
    mutate: mutateMessages,
  } = usePanelResource<ImessageMessage[]>({
    key: selected ? `imessage:msgs:${selected.chatId}` : 'imessage:msgs:none',
    fetch: () => invoke<ImessageMessage[]>('imessage_fetch_messages', { chatId: selectedRef.current!.chatId, limit: 80 }),
    enabled: !!selected,
    pollMs: 3000,
  });

  // Stale suggestions belong to the previous thread.
  useEffect(() => { setSuggestions([]); }, [selected]);

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

  // Extract the unread incoming messages accurately by scanning backwards.
  const unreadMessages = useMemo(() => {
    if (!selected || selected.unread <= 0 || messages.length === 0) return [];
    const unread = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messages[i].fromMe) {
        unread.push(messages[i]);
        if (unread.length >= selected.unread) break;
      }
    }
    return unread.reverse();
  }, [selected, messages]);

  const firstUnreadId = unreadMessages.length > 0 ? unreadMessages[0].id : null;

  // Background summary for threads with 3+ unread messages.
  const { data: catchMeUpSummary, loading: catchingUp } = usePanelResource<string | null>({
    key: (selected && unreadMessages.length >= 3) ? `imessage:catchmeup:${selected.chatId}:${unreadMessages[unreadMessages.length - 1].id}` : 'imessage:catchmeup:none',
    fetch: async () => {
      const models = useSettingsStore.getState().models;
      if (models.length === 0 || !selected) return null;
      const modelConfig = (models as any[])[0]; // grab first connected model
      if (!modelConfig) return null;

      const transcript = unreadMessages.map(m => `${m.senderName || selected.name}: ${m.text}`).join('\n');
      const prompt = `Summarize these missed messages briefly (1-3 short sentences):\n\n${transcript}`;
      
      const resp = await generateTextResponse({
        messages: [{ id: '1', role: 'user', content: prompt }],
        modelConfig,
        agent: { prompt: 'You are a helpful assistant summarizing missed messages concisely in the third person. Keep it very short.', tools: {}, trainingDocs: [] },
        profile: '', tasks: [], attachedDocs: [], agentPinnedMessages: [], mode: 'text',
        canvasContent: null, isDeepThinking: false, onChunk: null, signal: null,
        appSettings: {}, integrations: {}, models: [],
      });
      return resp.trim();
    },
    enabled: !!selected && unreadMessages.length >= 3,
  });

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
    mutateMessages(prev => [...(prev ?? []), optimistic]);
    setDraft('');
    try {
      await invoke('imessage_send', { chatGuid: chat.guid, text });
      // Give Messages a beat to write to chat.db, then reconcile from the source of truth.
      setTimeout(() => { const s = selectedRef.current; if (s?.chatId === chat.chatId) refreshMessages(); }, 800);
    } catch (e) {
      // Revert — it never sent. Only if this thread is still open; mutate writes to the current key.
      if (selectedRef.current?.chatId === chat.chatId) {
        mutateMessages(prev => (prev ?? []).filter(m => m.id !== optimistic.id));
      }
      setDraft(text); // restore so the user doesn't lose their text
      setSendError(String(e));
    } finally {
      setSending(false);
    }
  };

  // Draft a few short replies in the user's voice. Learns their style on first use (auto-distills
  // from their own sent texts/email), then suggests options to tap into the box.
  const suggestReplies = async () => {
    const chat = selected;
    if (!chat || voiceBusy) return;
    if (!hasModel) { useUIStore.getState().showToast('Connect a model first to draft replies.'); return; }
    setVoiceBusy(true);
    setSuggestions([]);
    try {
      const existing = normalizeVoiceProfile(useSettingsStore.getState().appSettings?.voiceProfile);
      if (!existing.card.trim()) {
        // First use kicks off a one-time analysis — be explicit about what it reads (sent texts/emails,
        // not voicemails) so it doesn't feel like a mystery. Manageable later in Settings → Write Like Me.
        useUIStore.getState().showToast('✍️ One-time setup: analyzing messages & emails you’ve sent to learn how you write…');
        const { card, sampleCounts } = await buildVoiceCard();
        useSettingsStore.getState().setAppSettings((prev: any) => ({
          ...prev,
          voiceProfile: { ...normalizeVoiceProfile(prev?.voiceProfile), enabled: true, card, sampleCounts, lastBuiltAt: Date.now() },
        }));
        await useSettingsStore.getState().persist();
      }
      const transcript = messages.slice(-14)
        .map(m => `${m.fromMe ? 'Me' : (m.senderName || chat.name)}: ${m.text}`)
        .filter(Boolean)
        .join('\n');
      // 1:1 chats use this person's own learned voice if opted-in; groups fall back to the global card.
      const relKey = chat.isGroup ? null : relKeyForImessage(chat.chatId);
      const drafts = await draftReply({ surface: 'imessage', incoming: transcript, recipient: chat.name, count: 3, relKey });
      setSuggestions(drafts);
    } catch (e: any) {
      useUIStore.getState().showToast(e?.message ?? 'Could not draft a reply.');
    } finally {
      setVoiceBusy(false);
    }
  };

  // Learn (or refresh) a voice card from ONLY the messages the user has sent to THIS 1:1 contact, and
  // opt that recipient in so replies to them draft in the voice the user uses with them specifically.
  const learnRecipientVoice = async () => {
    const chat = selected;
    if (!chat || chat.isGroup || voiceBusy) return;
    if (!hasModel) { useUIStore.getState().showToast('Connect a model first to learn a voice.'); return; }
    const relKey = relKeyForImessage(chat.chatId);
    if (!relKey) return;
    setVoiceBusy(true);
    try {
      useUIStore.getState().showToast(`✍️ Learning how you write to ${chat.name}…`);
      const { card, sampleCounts } = await buildRelationshipVoiceCard(chat.chatId, chat.name);
      useSettingsStore.getState().setAppSettings((prev: any) => {
        const cur = normalizeVoiceProfile(prev?.voiceProfile);
        return {
          ...prev,
          voiceProfile: {
            ...cur,
            enabled: true,
            byRecipient: {
              ...(cur.byRecipient ?? {}),
              [relKey]: { card, optedIn: true, recipientName: chat.name, source: 'auto', lastBuiltAt: Date.now(), sampleCounts },
            },
          },
        };
      });
      await useSettingsStore.getState().persist();
      useUIStore.getState().showToast(`✓ Saved a voice for ${chat.name} — replies to them now use it.`);
    } catch (e: any) {
      useUIStore.getState().showToast(e?.message ?? 'Could not learn that voice.');
    } finally {
      setVoiceBusy(false);
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
          <button onClick={() => { setSelected(null); setSendError(null); }} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Back">
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
          <button onClick={() => refreshMessages()} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Refresh">
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
              const isFirstUnread = m.id === firstUnreadId && unreadMessages.length >= 3;
              return (
                <div key={m.id} className="flex flex-col w-full">
                  {isFirstUnread && (
                    <div className="w-full my-4 px-4 py-3 bg-accent-soft text-accent rounded-xl border border-accent/20 shadow-sm self-center max-w-[85%]">
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkles className="w-4 h-4" />
                        <span className="text-xs font-semibold uppercase tracking-wider">Since you last read</span>
                        {catchingUp && <RotateCw className="w-3 h-3 animate-spin ml-1 opacity-50" />}
                      </div>
                      <p className="text-sm leading-relaxed">{catchMeUpSummary || (catchingUp ? 'Summarizing missed messages…' : 'No summary available.')}</p>
                    </div>
                  )}
                  <div className={clsx('flex flex-col max-w-[78%]', m.fromMe ? 'self-end items-end' : 'self-start items-start')}>
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
          {(suggestions.length > 0 || voiceBusy) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {voiceBusy && suggestions.length === 0 && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3 px-1">
                  <Sparkles className="w-3 h-3 animate-pulse" /> Drafting in your voice…
                </span>
              )}
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setDraft(s); setSuggestions([]); }}
                  title={s}
                  className="max-w-[16rem] truncate text-left text-xs px-3 py-1.5 rounded-full bg-inset border border-edge-2 text-ink-2 hover:border-accent hover:text-ink transition-colors"
                >
                  {s}
                </button>
              ))}
              {suggestions.length > 0 && (
                <button onClick={() => setSuggestions([])} className="p-1 text-ink-3 hover:text-ink" title="Dismiss suggestions"><X className="w-3 h-3" /></button>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            {!selected.isGroup && (() => {
              const rk = relKeyForImessage(selected.chatId);
              const vp = normalizeVoiceProfile(useSettingsStore.getState().appSettings?.voiceProfile);
              const active = !!(rk && vp.byRecipient?.[rk]?.optedIn && vp.byRecipient[rk].card.trim());
              return (
                <button
                  onClick={learnRecipientVoice}
                  disabled={voiceBusy || !hasModel}
                  title={active
                    ? `Using a voice learned for ${selected.name} — click to refresh it`
                    : `Learn how you write to ${selected.name}, and use it for replies to them`}
                  className={clsx('px-2.5 py-2 rounded-full shrink-0 text-[11px] font-medium border transition-colors disabled:opacity-40',
                    active ? 'border-accent text-accent' : 'border-edge-2 text-ink-3 hover:text-accent hover:border-accent')}
                >
                  {active ? '✓ their voice' : 'learn voice'}
                </button>
              );
            })()}
            <button
              onClick={suggestReplies}
              disabled={voiceBusy || !hasModel}
              className={clsx('p-2.5 rounded-full shrink-0 transition-colors disabled:opacity-40', voiceBusy ? 'text-accent' : 'text-ink-3 hover:bg-wash hover:text-accent')}
              title="Suggest replies in my voice"
            >
              <Sparkles className={clsx('w-4 h-4', voiceBusy && 'animate-pulse')} />
            </button>
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
        <button onClick={() => refreshChats()} disabled={loading} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Refresh">
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
              To read your iMessage & SMS history, grant <span className="font-semibold">Docent</span> Full Disk Access, then come back and refresh.
            </p>
            <button onClick={openSettings} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity">
              Open Privacy settings
            </button>
            <button onClick={() => refreshChats()} className="text-[11px] font-medium text-ink-3 hover:text-ink">I've granted it — refresh</button>
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
              onClick={() => { setSelected(c); setDraft(''); setSendError(null); }}
              className="w-full flex items-start gap-2.5 px-4 py-3 border-b border-edge hover:bg-wash transition-colors text-left"
            >
              {/* Reserved unread slot keeps avatars aligned whether or not the dot is shown. */}
              <span className="w-2 shrink-0 self-center flex justify-center" title={c.unread > 0 ? `${c.unread} unread` : undefined}>
                {c.unread > 0 && <span className="w-2 h-2 rounded-full bg-accent" />}
              </span>
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-full bg-inset flex items-center justify-center text-xs font-semibold text-ink-2">
                  {c.isGroup ? <Users className="w-4 h-4" /> : initials(c.name)}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-panel" style={{ background: serviceColor(c.service) }} title={/sms/i.test(c.service) ? 'SMS' : 'iMessage'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={clsx('text-sm truncate', c.unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink')}>{c.name || c.identifier}</span>
                  <div className="flex-1" />
                  <span className={clsx('text-xs shrink-0', c.unread > 0 ? 'text-accent font-semibold' : 'text-ink-3')}>{formatListDate(c.lastDate)}</span>
                </div>
                <div className={clsx('text-sm truncate', c.unread > 0 ? 'text-ink font-medium' : 'text-ink-2')}>
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
