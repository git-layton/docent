import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Inbox, RotateCw, Mail, Settings as SettingsIcon, ArrowLeft, Reply, ReplyAll, Trash2, Send, Pencil, X, Wand2, Star, Plus, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { generateTextResponse } from '../services/llm';
import { db } from '../services/database';
import { invalidateUnreadCache } from '../lib/mailUnread';
import { useToolContextStore } from '../store/useToolContextStore';
import { normalizeVoiceProfile, relKeyForEmail } from '../services/voice';
import { usePanelResource } from '../lib/panelCache';
import {
  classifyAllHeuristic, buildTriagePrompt, parseTriageResponse,
  applyModelUpgrade, planSweep, type MailQueue,
} from '../services/mailTriage';
import { useReceiptStore } from '../services/receipts';
import { buildVoiceCard, buildEmailRelationshipVoiceCard, draftReply } from '../services/voiceRuntime';

interface MailHeader {
  uid: number;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string;
  seen: boolean;
  flagged: boolean;
}

/** A saved smart filter — natural-language description, persisted locally. */
interface SmartFilter {
  id: string;
  name: string;
  description: string;
}
interface MailRow extends MailHeader {
  account: string;
  provider: 'gmail' | 'icloud';
}
interface MailBodyData {
  fromName: string;
  fromEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  messageId: string;
  text: string;
  html: string;
}
interface ComposeState {
  mode: 'new' | 'reply' | 'replyAll';
  to: string;
  cc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  account: string;
  provider: 'gmail' | 'icloud';
  sourceText?: string;     // plain text of the message being replied to — context for "draft in my voice"
  recipientName?: string;  // who we're writing to, for the voice draft
}

type SortMode = 'newest' | 'oldest' | 'unread' | 'starred' | 'sender';

const rowKey = (r: { account: string; uid: number }) => `${r.account}-${r.uid}`;

const DOT: Record<'gmail' | 'icloud', string> = { gmail: '#D85A30', icloud: '#378ADD' };

function initials(name: string, email: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function formatDate(raw: string): string {
  const t = Date.parse(raw);
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// SEC-KEYCHAIN: the app-specific password is resolved inside Rust (mail.rs) and is never returned to
// the renderer. The UI only needs to know an account is connected (a credential exists) before
// attempting a mail op — a `mail:` keychain lookup now yields presence/username only, no secret.
async function hasSavedPassword(account: string): Promise<boolean> {
  const cred = await invoke<{ ok: boolean }>('keychain_get', { host: `mail:${account}` })
    .catch(() => ({ ok: false }));
  return !!cred?.ok;
}

function quoteBody(body: MailBodyData, sel: MailRow): string {
  const date = new Date(Date.parse(sel.date) || Date.now()).toLocaleString();
  const who = body.fromName || body.fromEmail || sel.fromEmail;
  const orig = (body.text || (body.html ? body.html.replace(/<[^>]+>/g, ' ') : '')).trim();
  const q = orig.split('\n').map(l => '> ' + l).join('\n');
  return `\n\n\nOn ${date}, ${who} wrote:\n${q}`;
}

export function MailInboxPanel() {
  const integrations = useSettingsStore(s => s.integrations);
  const accounts = ((integrations as any).mailAccounts ?? []) as Array<{ id: string; provider: 'gmail' | 'icloud'; email: string }>;
  const accountsKey = accounts.map(a => a.email).join(',');
  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);

  const [sort, setSort] = useState<SortMode>('newest');

  // ── Smart filters: natural-language, persisted, re-evaluated when mail reloads ──
  const [aiQuery, setAiQuery] = useState('');
  const [savedFilters, setSavedFilters] = useState<SmartFilter[]>([]);
  const [activeFilter, setActiveFilter] = useState<SmartFilter | null>(null); // saved OR ad-hoc (ad-hoc id = '')
  const [filterKeys, setFilterKeys] = useState<Set<string> | null>(null);     // matches for activeFilter
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const matchRunId = useRef(0);

  // Load + persist saved filters
  useEffect(() => { db.get('mailSmartFilters', []).then((f: SmartFilter[]) => setSavedFilters(Array.isArray(f) ? f : [])); }, []);
  const persistFilters = (next: SmartFilter[]) => { setSavedFilters(next); void db.set('mailSmartFilters', next); };

  const [selected, setSelected] = useState<MailRow | null>(null);
  const [body, setBody] = useState<MailBodyData | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false); // "write like me" drafting in progress

  const [activeQueue, setActiveQueue] = useState<MailQueue>('needs-reply');
  const [upgrades, setUpgrades] = useState<Map<number, MailQueue>>(new Map());
  const [isSweeping, setIsSweeping] = useState(false);

  // Inbox rows — state-alive across tab switches (instant reopen, silent revalidate). Keyed by
  // the account set so adding/removing an account can never paint another set's cached rows.
  const { data: rows = [], loading, error, refresh: load, mutate: mutateRows } = usePanelResource<MailRow[]>({
    key: `mail:rows:${accountsKey}`,
    fetch: async () => {
      if (accounts.length === 0) return [];
      const per = await Promise.all(
        accounts.map(async (acct): Promise<MailRow[]> => {
          if (!(await hasSavedPassword(acct.email))) return [];
          const headers = await invoke<MailHeader[]>('mail_fetch_recent', {
            provider: acct.provider, email: acct.email, limit: 30,
          }).catch(() => [] as MailHeader[]);
          return headers.map(h => ({ ...h, account: acct.email, provider: acct.provider }));
        }),
      );
      return per.flat();
    },
  });

  // Publish the inbox to the docked agent's context so it can read what's on screen (the list, plus
  // any open message). Cleared on unmount.
  useEffect(() => {
    const list = rows.slice(0, 40)
      .map(r => `${r.fromName || r.fromEmail} — ${r.subject || '(no subject)'}${r.seen ? '' : '  [unread]'}`)
      .join('\n');
    const open = selected && body
      ? `\n\nOPEN MESSAGE — "${selected.subject || '(no subject)'}" from ${body.fromName || body.fromEmail}:\n${(body.text || body.html.replace(/<[^>]+>/g, ' ')).slice(0, 2000)}`
      : '';
    useToolContextStore.getState().setToolContext({ label: 'Inbox', text: (list || '(no messages loaded)') + open, source: 'mail' });
    return () => useToolContextStore.getState().clearToolContext();
  }, [rows, selected, body]);

  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 6000);
    return () => clearTimeout(t);
  }, [actionError]);

  const classifiedRows = useMemo(() => {
    const base = classifyAllHeuristic(rows);
    return applyModelUpgrade(base as any, upgrades) as (MailRow & { queue: MailQueue; modelClassified?: boolean })[];
  }, [rows, upgrades]);

  const sortedRows = useMemo(() => {
    const r = [...classifiedRows];
    switch (sort) {
      case 'oldest': return r.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
      case 'unread': return r.sort((a, b) => Number(a.seen) - Number(b.seen) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      case 'starred': return r.sort((a, b) => Number(b.flagged) - Number(a.flagged) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      case 'sender': return r.sort((a, b) => (a.fromName || a.fromEmail).localeCompare(b.fromName || b.fromEmail));
      default: return r.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    }
  }, [classifiedRows, sort]);

  const displayRows = useMemo(() => {
    let r = sortedRows.filter(x => x.queue === activeQueue);
    if (starredOnly) r = r.filter(x => x.flagged);
    if (activeFilter && filterKeys) r = r.filter(x => filterKeys.has(rowKey(x)));
    return r;
  }, [sortedRows, activeQueue, starredOnly, activeFilter, filterKeys]);

  // Background LLM classification pass
  useEffect(() => {
    if (rows.length === 0 || models.length === 0) return;
    const modelConfig = (models as any[]).find(m => m.id === selectedModelId) ?? (models as any[])[0];
    if (!modelConfig) return;

    // Only classify ones we haven't upgraded yet
    const toClassify = rows.filter(r => !upgrades.has(r.uid)).slice(0, 20); // batch size 20
    if (toClassify.length === 0) return;

    const prompt = buildTriagePrompt(toClassify);
    generateTextResponse({
      messages: [{ id: `mailtriage-${Date.now()}`, role: 'user', content: prompt }],
      modelConfig,
      agent: { prompt: 'You output only strict JSON as requested.', tools: {}, trainingDocs: [] },
      profile: '', tasks: [], attachedDocs: [], agentPinnedMessages: [], mode: 'text',
      canvasContent: null, isDeepThinking: false, onChunk: null, signal: null,
      appSettings: {}, integrations: {}, models: [],
    }).then(resp => {
      const parsed = parseTriageResponse(resp, toClassify.map(r => r.uid));
      if (parsed) {
        setUpgrades(prev => {
          const next = new Map(prev);
          for (const [uid, q] of parsed.entries()) next.set(uid, q);
          return next;
        });
      }
    }).catch(console.error);
  }, [rows, models, selectedModelId, upgrades]);

  // Core matcher: ask the model which loaded messages fit a description. Includes date and
  // read/star state so filters like "unread newsletters from this week" actually work.
  const matchFilter = useCallback(async (description: string, list: MailRow[]): Promise<Set<string>> => {
    const modelConfig = (models as any[]).find(m => m.id === selectedModelId) ?? (models as any[])[0];
    if (!modelConfig) throw new Error('No model configured in Settings');
    if (list.length === 0) return new Set();
    const listing = list
      .map((r, i) => `${i + 1}. From: ${r.fromName || r.fromEmail} <${r.fromEmail}> | Subject: ${r.subject || '(no subject)'} | Date: ${r.date} | ${r.seen ? 'read' : 'UNREAD'}${r.flagged ? ' | STARRED' : ''}`)
      .join('\n');
    const prompt = `You are filtering an email inbox. Today is ${new Date().toDateString()}. Below is a numbered list of emails.\n\nReturn ONLY a JSON array of the numbers of the emails that match this request: "${description}". Match on intent and be reasonably inclusive. Output just the array, e.g. [1,4,5] — no other text. If nothing matches, output [].\n\n${listing}`;
    const resp: string = await generateTextResponse({
      messages: [{ id: `mailfilter-${Date.now()}`, role: 'user', content: prompt }],
      modelConfig,
      agent: { prompt: 'You output only a JSON array of integers, nothing else.', tools: {}, trainingDocs: [] },
      profile: '', tasks: [], attachedDocs: [], agentPinnedMessages: [], mode: 'text',
      canvasContent: null, isDeepThinking: false, onChunk: null, signal: null,
      appSettings: {}, integrations: {}, models: [],
    });
    const m = resp.match(/\[[\s\S]*?\]/);
    const idxs: number[] = m ? JSON.parse(m[0]) : [];
    return new Set(idxs.map(n => list[n - 1]).filter(Boolean).map(rowKey));
  }, [models, selectedModelId]);

  // Apply a filter (saved or ad-hoc) against the current rows.
  const applyFilter = useCallback(async (filter: SmartFilter, list: MailRow[]) => {
    const runId = ++matchRunId.current;
    setActiveFilter(filter);
    setAiLoading(true);
    setAiError(null);
    try {
      const keys = await matchFilter(filter.description, list);
      if (matchRunId.current === runId) setFilterKeys(keys);
    } catch (e) {
      if (matchRunId.current === runId) { setAiError(String(e)); setActiveFilter(null); setFilterKeys(null); }
    } finally {
      if (matchRunId.current === runId) setAiLoading(false);
    }
  }, [matchFilter]);

  // THE persistence fix: when mail reloads while a filter is active, re-evaluate it against the
  // fresh rows instead of filtering with a stale UID set (which silently showed nothing).
  const rowsSignature = useMemo(() => rows.map(rowKey).sort().join('|'), [rows]);
  const lastSignature = useRef(rowsSignature);
  useEffect(() => {
    if (rowsSignature === lastSignature.current) return;
    lastSignature.current = rowsSignature;
    if (activeFilter && rows.length > 0) void applyFilter(activeFilter, rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSignature]);

  const runAdhocFilter = () => {
    const q = aiQuery.trim();
    if (!q || sortedRows.length === 0) return;
    void applyFilter({ id: '', name: q, description: q }, sortedRows);
  };

  const saveActiveFilter = () => {
    if (!activeFilter || activeFilter.id) return;
    const name = activeFilter.description.length > 28 ? `${activeFilter.description.slice(0, 28)}…` : activeFilter.description;
    const saved: SmartFilter = { ...activeFilter, id: `flt-${Date.now()}`, name };
    persistFilters([...savedFilters, saved]);
    setActiveFilter(saved);
  };

  const toggleSavedFilter = (f: SmartFilter) => {
    if (activeFilter?.id === f.id) { clearAiFilter(); return; }
    setAiQuery('');
    void applyFilter(f, sortedRows);
  };

  const deleteSavedFilter = (f: SmartFilter) => {
    persistFilters(savedFilters.filter(x => x.id !== f.id));
    if (activeFilter?.id === f.id) clearAiFilter();
  };

  const clearAiFilter = () => { matchRunId.current++; setActiveFilter(null); setFilterKeys(null); setAiQuery(''); setAiError(null); setAiLoading(false); };

  const setSeenLocal = (row: MailRow, seen: boolean) =>
    mutateRows(prev => (prev ?? []).map(r => (r.account === row.account && r.uid === row.uid ? { ...r, seen } : r)));

  const setFlaggedLocal = (row: MailRow, flagged: boolean) =>
    mutateRows(prev => (prev ?? []).map(r => (r.account === row.account && r.uid === row.uid ? { ...r, flagged } : r)));

  // Star / unstar ON THE SERVER (IMAP \Flagged) — optimistic with revert, like read state.
  const toggleStar = async (row: MailRow) => {
    const flagged = !row.flagged;
    setFlaggedLocal(row, flagged);
    if (selected && selected.account === row.account && selected.uid === row.uid) setSelected({ ...selected, flagged });
    if (!(await hasSavedPassword(row.account))) { setFlaggedLocal(row, !flagged); setActionError('No saved password — re-add the account in Settings.'); return; }
    try {
      await invoke('mail_set_flagged', { provider: row.provider, email: row.account, uid: row.uid, flagged });
    } catch (e) {
      setFlaggedLocal(row, !flagged); // revert — server didn't change
      if (selected && selected.account === row.account && selected.uid === row.uid) setSelected({ ...selected, flagged: !flagged });
      setActionError(`Couldn't update star on the server: ${String(e)}`);
    }
  };

  // Flip read state ON THE SERVER (optimistic, with revert + surfaced error) so the UI matches Gmail.
  const setSeen = async (row: MailRow, seen: boolean) => {
    setSeenLocal(row, seen);
    if (!(await hasSavedPassword(row.account))) { setSeenLocal(row, !seen); setActionError('No saved password — re-add the account in Settings.'); return; }
    try {
      await invoke('mail_set_seen', { provider: row.provider, email: row.account, uid: row.uid, seen });
      invalidateUnreadCache(); // Home badge refetches next time it's shown
    } catch (e) {
      setSeenLocal(row, !seen); // revert — server didn't change
      setActionError(`Couldn't update read state on the server: ${String(e)}`);
    }
  };

  const openMessage = useCallback(async (row: MailRow) => {
    setSelected(row);
    setBody(null);
    setBodyError(null);
    setBodyLoading(true);
    if (!row.seen) void setSeen(row, true); // auto mark-read, persisted to the server
    try {
      if (!(await hasSavedPassword(row.account))) throw new Error('No saved password for this account');
      const b = await invoke<MailBodyData>('mail_fetch_body', { provider: row.provider, email: row.account, uid: row.uid });
      setBody(b);
    } catch (e) {
      setBodyError(String(e));
    } finally {
      setBodyLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markUnread = async (row: MailRow) => {
    setSelected(null);
    setBody(null);
    await setSeen(row, false);
  };

  const deleteMessage = async (row: MailRow) => {
    mutateRows(prev => (prev ?? []).filter(r => !(r.account === row.account && r.uid === row.uid)));
    if (selected && selected.account === row.account && selected.uid === row.uid) { setSelected(null); setBody(null); }
    if (!(await hasSavedPassword(row.account))) {
      mutateRows(prev => [...(prev ?? []), row]); // revert (sort happens in the view)
      setActionError('No saved password — re-add the account in Settings.');
      return;
    }
    try {
      await invoke('mail_delete', { provider: row.provider, email: row.account, uid: row.uid });
    } catch (e) {
      mutateRows(prev => [...(prev ?? []), row]); // revert — message still on the server
      setActionError(`Delete failed on the server: ${String(e)}`);
    }
  };

  const startReply = (all: boolean) => {
    if (!selected || !body) return;
    const self = selected.account.toLowerCase();
    const dedupe = (arr: string[]) => [...new Set(arr.map(s => s.trim()).filter(Boolean))].filter(e => e.toLowerCase() !== self);
    let to: string[];
    let cc: string[] = [];
    if (all) {
      to = dedupe([body.fromEmail, ...(body.to || [])]);
      cc = dedupe(body.cc || []).filter(e => !to.map(t => t.toLowerCase()).includes(e.toLowerCase()));
    } else {
      to = [body.fromEmail].filter(Boolean);
    }
    const subject = /^re:/i.test(selected.subject || '') ? selected.subject : `Re: ${selected.subject || ''}`;
    const sourceText = (body.text || (body.html ? body.html.replace(/<[^>]+>/g, ' ') : '')).trim();
    setCompose({ mode: all ? 'replyAll' : 'reply', to: to.join(', '), cc: cc.join(', '), subject, body: quoteBody(body, selected), inReplyTo: body.messageId || '', account: selected.account, provider: selected.provider, sourceText, recipientName: body.fromName || body.fromEmail });
    setSendError(null);
  };

  const startCompose = () => {
    const acct = accounts[0];
    if (!acct) return;
    setCompose({ mode: 'new', to: '', cc: '', subject: '', body: '', inReplyTo: '', account: acct.email, provider: acct.provider });
    setSendError(null);
  };

  const sendCompose = async () => {
    if (!compose) return;
    const to = compose.to.split(',').map(s => s.trim()).filter(Boolean);
    const cc = compose.cc.split(',').map(s => s.trim()).filter(Boolean);
    if (to.length === 0) { setSendError('Add at least one recipient'); return; }
    setSending(true);
    setSendError(null);
    try {
      if (!(await hasSavedPassword(compose.account))) throw new Error(`No saved password for ${compose.account}`);
      await invoke('mail_send', {
        provider: compose.provider, email: compose.account,
        to, cc, subject: compose.subject, body: compose.body, inReplyTo: compose.inReplyTo || null,
      });
      setCompose(null);
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSending(false);
    }
  };

  // Draft this email in the user's own voice (learns their style on first use). Places the draft
  // above any quoted original so the reply chain is preserved.
  const draftEmailInVoice = async () => {
    if (!compose || voiceBusy) return;
    if (models.length === 0) { useUIStore.getState().showToast('Connect a model first to draft in your voice.'); return; }
    setVoiceBusy(true);
    try {
      const existing = normalizeVoiceProfile(useSettingsStore.getState().appSettings?.voiceProfile);
      if (!existing.card.trim()) {
        useUIStore.getState().showToast('✍️ Learning your writing style…');
        const { card, sampleCounts } = await buildVoiceCard();
        useSettingsStore.getState().setAppSettings((prev: any) => ({
          ...prev,
          voiceProfile: { ...normalizeVoiceProfile(prev?.voiceProfile), enabled: true, card, sampleCounts, lastBuiltAt: Date.now() },
        }));
        await useSettingsStore.getState().persist();
      }
      const recipient = compose.recipientName || compose.to.split(',')[0]?.trim() || undefined;
      const incoming = compose.sourceText || (compose.subject ? `Subject: ${compose.subject}` : '');
      // Use this recipient's own voice card if one is opted-in; otherwise the global card.
      const relKey = relKeyForEmail(compose.to);
      const [draft] = await draftReply({ surface: 'email', incoming, recipient, count: 1, relKey });
      if (draft) {
        setCompose(c => {
          if (!c) return c;
          const idx = c.body.indexOf('\n\n\nOn '); // start of the quoted original, if any
          const quote = idx >= 0 ? c.body.slice(idx) : '';
          return { ...c, body: draft + quote };
        });
      }
    } catch (e: any) {
      useUIStore.getState().showToast(e?.message ?? 'Could not draft the email.');
    } finally {
      setVoiceBusy(false);
    }
  };

  // Learn a separate voice for THIS recipient, from the emails the user has sent to them, and opt
  // them in so future email drafts to them use it (falling back to the global voice otherwise).
  const learnEmailRecipientVoice = async () => {
    if (!compose || voiceBusy) return;
    if (models.length === 0) { useUIStore.getState().showToast('Connect a model first to learn a voice.'); return; }
    const relKey = relKeyForEmail(compose.to);
    if (!relKey) { useUIStore.getState().showToast('Add a recipient address first.'); return; }
    const addr = relKey.slice('mail:'.length);
    setVoiceBusy(true);
    try {
      useUIStore.getState().showToast(`✍️ Learning how you write to ${addr}…`);
      const { card, sampleCounts } = await buildEmailRelationshipVoiceCard(addr);
      useSettingsStore.getState().setAppSettings((prev: any) => {
        const cur = normalizeVoiceProfile(prev?.voiceProfile);
        return { ...prev, voiceProfile: { ...cur, enabled: true, byRecipient: { ...(cur.byRecipient ?? {}), [relKey]: { card, optedIn: true, recipientName: compose.recipientName || addr, source: 'auto', lastBuiltAt: Date.now(), sampleCounts } } } };
      });
      await useSettingsStore.getState().persist();
      useUIStore.getState().showToast(`✓ Saved a voice for ${addr} — emails to them now use it.`);
    } catch (e: any) {
      useUIStore.getState().showToast(e?.message ?? 'Could not learn that voice.');
    } finally {
      setVoiceBusy(false);
    }
  };

  const openMailSettings = () => {
    const s = useSettingsStore.getState();
    s.setProfileSettingsTab('integrations');
    s.setShowProfileSettings(true);
  };

  const onIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    // No scripts run inside (sandbox=allow-same-origin only), but the parent can wire links to
    // open in the real browser instead of navigating the iframe.
    const doc = e.currentTarget.contentDocument;
    if (!doc) return;
    doc.querySelectorAll('a[href]').forEach(a => {
      a.addEventListener('click', ev => {
        const href = (a as HTMLAnchorElement).getAttribute('href') || '';
        if (/^https?:/i.test(href)) { ev.preventDefault(); openUrl(href).catch(() => {}); }
      });
    });
  };

  // ── Compose / reply view ──
  if (compose) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
        <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
          <button onClick={() => setCompose(null)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Discard">
            <X className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-ink">
            {compose.mode === 'new' ? 'New message' : compose.mode === 'replyAll' ? 'Reply all' : 'Reply'}
          </span>
          <span className="text-xs text-ink-3">from {compose.account}</span>
          <div className="flex-1" />
          {compose.to.trim() && (
            <button
              onClick={learnEmailRecipientVoice}
              disabled={voiceBusy || sending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-ink-3 hover:text-accent transition-colors disabled:opacity-40"
              title={`Learn how you write to ${compose.recipientName || 'this recipient'} and use it for emails to them`}
            >
              learn their voice
            </button>
          )}
          <button
            onClick={draftEmailInVoice}
            disabled={voiceBusy || sending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-accent hover:bg-accent-soft transition-colors disabled:opacity-40"
            title="Draft this email in my voice"
          >
            <Wand2 className={clsx('w-3.5 h-3.5', voiceBusy && 'animate-spin')} /> {voiceBusy ? 'Drafting…' : 'Draft in my voice'}
          </button>
          <button onClick={sendCompose} disabled={sending} className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity disabled:opacity-40">
            {sending ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
          </button>
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto">
          {([['To', 'to'], ['Cc', 'cc'], ['Subject', 'subject']] as const).map(([label, field]) => (
            <div key={field} className="flex items-center gap-3 px-4 py-2.5 border-b border-edge">
              <label className="text-xs font-medium text-ink-3 w-12 shrink-0">{label}</label>
              <input
                value={(compose as any)[field]}
                onChange={ev => setCompose(c => (c ? { ...c, [field]: ev.target.value } : c))}
                placeholder={field === 'cc' ? 'optional, comma-separated' : field === 'to' ? 'comma-separated' : ''}
                className="flex-1 bg-transparent text-sm text-ink outline-none"
              />
            </div>
          ))}
          <textarea
            value={compose.body}
            onChange={ev => setCompose(c => (c ? { ...c, body: ev.target.value } : c))}
            placeholder="Write your message…"
            className="flex-1 min-h-[240px] resize-none bg-transparent px-4 py-3 text-sm text-ink outline-none leading-relaxed font-sans"
          />
          {sendError && <div className="px-4 py-2 text-xs font-medium text-danger break-words">✗ {sendError}</div>}
        </div>
      </div>
    );
  }

  // ── Reading view ──
  if (selected) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
        <div className="h-12 flex items-center gap-1 px-3 border-b border-edge shrink-0">
          <button onClick={() => { setSelected(null); setBody(null); }} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <button onClick={() => toggleStar(selected)} className={clsx('p-1.5 rounded-lg transition-colors', selected.flagged ? 'text-warning bg-warning-soft' : 'text-ink-3 hover:bg-warning-soft hover:text-warning')} title={selected.flagged ? 'Unstar' : 'Star'}>
            <Star className={clsx('w-4 h-4', selected.flagged && 'fill-current')} />
          </button>
          <button onClick={() => startReply(false)} disabled={!body} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Reply">
            <Reply className="w-4 h-4" />
          </button>
          <button onClick={() => startReply(true)} disabled={!body} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Reply all">
            <ReplyAll className="w-4 h-4" />
          </button>
          <button onClick={() => markUnread(selected)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Mark as unread">
            <Mail className="w-4 h-4" />
          </button>
          <button onClick={() => deleteMessage(selected)} className="p-1.5 rounded-lg text-ink-3 hover:bg-danger-soft hover:text-danger transition-colors" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-4 border-b border-edge shrink-0">
          <h1 className="text-lg font-semibold text-ink">{selected.subject || '(no subject)'}</h1>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="font-medium text-ink">{selected.fromName || selected.fromEmail}</span>
            {selected.fromName && <span className="text-ink-3">&lt;{selected.fromEmail}&gt;</span>}
            <span className="w-2 h-2 rounded-full" style={{ background: DOT[selected.provider] }} title={selected.account} />
            <div className="flex-1" />
            <span className="text-xs text-ink-3">{new Date(Date.parse(selected.date) || Date.now()).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {bodyLoading ? (
            <div className="h-full flex items-center justify-center gap-2 text-ink-3"><RotateCw className="w-5 h-5 animate-spin" /> <span className="text-sm">Loading message…</span></div>
          ) : bodyError ? (
            <div className="p-6 text-sm text-danger">Couldn't load message: {bodyError}</div>
          ) : body?.html ? (
            <iframe title="email" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={body.html} onLoad={onIframeLoad} className="w-full h-full border-0 bg-white" />
          ) : (
            <pre className="px-6 py-4 whitespace-pre-wrap break-words font-sans text-sm text-ink-2 leading-relaxed">{body?.text || '(empty message)'}</pre>
          )}
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <Inbox className="w-4 h-4 text-ink-3" />
        <span className="text-sm font-semibold text-ink">Inbox</span>
        {accounts.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            {accounts.map(a => <span key={a.id} className="w-2 h-2 rounded-full" style={{ background: DOT[a.provider] }} title={a.email} />)}
            <span className="ml-1">{rows.length}</span>
          </span>
        )}
        <div className="flex-1" />
        {accounts.length > 0 && (
          <>
            <button
              onClick={async () => {
                setIsSweeping(true);
                const plan = planSweep(classifiedRows as any);
                if (plan.archive.length === 0 && plan.flag.length === 0 && plan.draft.length === 0) {
                  useUIStore.getState().showToast("Inbox already clean!");
                  setIsSweeping(false);
                  return;
                }
                useUIStore.getState().showToast(plan.summary);
                for (const h of plan.archive) {
                  await invoke('mail_archive', { provider: (h as any).provider, email: h.account, uid: h.uid }).catch(console.error);
                }
                for (const h of plan.flag) {
                  await invoke('mail_set_flagged', { provider: (h as any).provider, email: h.account, uid: h.uid, flagged: true }).catch(console.error);
                }
                // RECEIPTS NEVER LIE: no undo handler is registered because un-archive isn't
                // implemented (IMAP MOVE back shifts UIDs — see invertSweepPlan's inverse for
                // when it is). A fake handler would render a working-looking Undo button that
                // reverses nothing. The receipt records where the mail went instead.
                useReceiptStore.getState().record({
                  surface: 'mail',
                  action: 'Swept Inbox',
                  summary: `${plan.summary} Archived mail is in your Archive folder.`,
                });
                load();
                setIsSweeping(false);
              }}
              disabled={isSweeping || loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent-soft text-accent hover:bg-accent hover:text-on-accent transition-colors disabled:opacity-40"
              title="Sweep Inbox"
            >
              <Sparkles className={clsx("w-3.5 h-3.5", isSweeping && "animate-spin")} /> Sweep
            </button>
            <button onClick={startCompose} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity" title="Compose">
              <Pencil className="w-3.5 h-3.5" /> Compose
            </button>
            <button
              onClick={() => setStarredOnly(v => !v)}
              className={clsx('p-1.5 rounded-lg transition-colors', starredOnly ? 'text-warning bg-warning-soft' : 'text-ink-3 hover:bg-wash hover:text-warning')}
              title={starredOnly ? 'Show all' : 'Show starred only'}
            >
              <Star className={clsx('w-3.5 h-3.5', starredOnly && 'fill-current')} />
            </button>
            <select value={sort} onChange={e => setSort(e.target.value as SortMode)} className="text-xs bg-transparent border border-edge-2 rounded-lg px-2 py-1 text-ink-2 outline-none" title="Sort">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="unread">Unread first</option>
              <option value="starred">Starred first</option>
              <option value="sender">Sender A–Z</option>
            </select>
          </>
        )}
        <button onClick={load} disabled={loading || accounts.length === 0} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Refresh">
          <RotateCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {accounts.length > 0 && (
        <div className="flex px-2 pt-2 border-b border-edge shrink-0 gap-1 overflow-x-auto">
          {(['needs-reply', 'newsletter', 'receipt', 'other'] as MailQueue[]).map(q => (
            <button
              key={q}
              onClick={() => setActiveQueue(q)}
              className={clsx(
                "px-3 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2",
                activeQueue === q 
                  ? "border-accent text-accent bg-accent-soft/30" 
                  : "border-transparent text-ink-3 hover:text-ink hover:bg-wash"
              )}
            >
              {q === 'needs-reply' ? 'Needs Reply' : q === 'newsletter' ? 'Newsletters' : q === 'receipt' ? 'Receipts' : 'Everything Else'}
            </button>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <div className="border-b border-edge shrink-0">
          <div className="flex items-center gap-2 px-4 py-2">
            <Wand2 className="w-3.5 h-3.5 text-accent shrink-0" />
            <input
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runAdhocFilter(); }}
              placeholder="Describe a smart filter — e.g. “invoices & receipts”, “needs a reply”"
              className="flex-1 bg-transparent text-xs text-ink-2 outline-none placeholder:text-ink-3"
            />
            {aiLoading && <RotateCw className="w-3.5 h-3.5 animate-spin text-ink-3" />}
            {activeFilter && !aiLoading ? (
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-ink-3">{displayRows.length} match{displayRows.length === 1 ? '' : 'es'}</span>
                {!activeFilter.id && (
                  <button onClick={saveActiveFilter} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline" title="Save as a reusable smart filter">
                    <Plus className="w-3 h-3" /> Save filter
                  </button>
                )}
                <button onClick={clearAiFilter} className="flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-ink" title="Clear filter">
                  clear <X className="w-3 h-3" />
                </button>
              </span>
            ) : !aiLoading && (
              <button onClick={runAdhocFilter} disabled={!aiQuery.trim()} className="text-[11px] font-semibold text-accent disabled:opacity-40 shrink-0">Filter</button>
            )}
          </div>
          {savedFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
              {savedFilters.map(f => (
                <span key={f.id} className="group/chip relative inline-flex">
                  <button
                    onClick={() => toggleSavedFilter(f)}
                    disabled={aiLoading}
                    title={f.description}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 pr-6 text-[11px] font-medium transition-all',
                      activeFilter?.id === f.id
                        ? 'border-accent bg-accent-soft text-accent-soft-ink'
                        : 'border-edge-2 text-ink-2 hover:border-accent hover:text-accent',
                    )}
                  >
                    <Wand2 className="w-3 h-3" aria-hidden="true" />
                    {f.name}
                  </button>
                  <button
                    onClick={() => deleteSavedFilter(f)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-3 opacity-0 transition-opacity group-hover/chip:opacity-100 hover:text-danger"
                    title={`Delete “${f.name}”`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {aiError && <div className="px-4 py-1.5 text-[11px] text-danger border-b border-edge shrink-0">✗ {aiError}</div>}
      {actionError && (
        <div className="px-4 py-1.5 text-[11px] text-danger border-b border-edge shrink-0 flex items-center gap-2">
          <span className="flex-1">✗ {actionError}</span>
          <button onClick={() => setActionError(null)}><X className="w-3 h-3" /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {accounts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
            <Mail className="w-8 h-8 text-ink-3" />
            <p className="text-sm text-ink-2 max-w-xs">No mail accounts connected yet. Add Gmail or iCloud with an app password to bring your inbox in.</p>
            <button onClick={openMailSettings} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity">
              <SettingsIcon className="w-3.5 h-3.5" /> Connect an account
            </button>
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-danger">Couldn't load mail: {error}</div>
        ) : loading && rows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-3"><RotateCw className="w-5 h-5 animate-spin" /><span className="text-sm">Loading your inbox…</span></div>
        ) : displayRows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-ink-3">{activeFilter ? 'No matches for that filter.' : starredOnly ? 'No starred messages.' : 'No messages.'}</div>
        ) : (
          displayRows.map(r => (
            <div key={`${r.account}-${r.uid}`} className="group relative flex items-start gap-3 px-4 py-3 border-b border-edge hover:bg-wash transition-colors">
              <button onClick={() => openMessage(r)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-inset flex items-center justify-center text-xs font-semibold text-ink-2">{initials(r.fromName, r.fromEmail)}</div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-panel" style={{ background: DOT[r.provider] }} title={r.account} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-sm truncate', !r.seen ? 'font-bold text-ink' : 'text-ink-2')}>{r.fromName || r.fromEmail || '(unknown sender)'}</span>
                    {!r.seen && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    {r.flagged && <Star className="w-3 h-3 text-warning fill-current shrink-0 group-hover:opacity-0 transition-opacity" />}
                    <div className="flex-1" />
                    <span className="text-xs text-ink-3 shrink-0 group-hover:opacity-0 transition-opacity">{formatDate(r.date)}</span>
                  </div>
                  <div className={clsx('text-sm truncate', !r.seen ? 'font-medium text-ink' : 'text-ink-2')}>{r.subject || '(no subject)'}</div>
                  <div className="text-xs text-ink-3 truncate">{r.fromEmail}</div>
                </div>
              </button>
              <div className="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                <button
                  onClick={() => toggleStar(r)}
                  className={clsx('p-1.5 rounded-lg transition-colors', r.flagged ? 'text-warning' : 'text-ink-3 hover:text-warning hover:bg-warning-soft')}
                  title={r.flagged ? 'Unstar' : 'Star'}
                >
                  <Star className={clsx('w-4 h-4', r.flagged && 'fill-current')} />
                </button>
                <button
                  onClick={() => deleteMessage(r)}
                  className="p-1.5 rounded-lg text-ink-3 hover:bg-danger-soft hover:text-danger transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
