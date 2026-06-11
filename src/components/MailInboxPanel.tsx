import { useState, useEffect, useCallback, useMemo } from 'react';
import { Inbox, RotateCw, Mail, Settings as SettingsIcon, ArrowLeft, Reply, ReplyAll, Trash2, Send, Pencil, X, Wand2 } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useSettingsStore } from '../store/useSettingsStore';
import { generateTextResponse } from '../services/llm';

interface MailHeader {
  uid: number;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string;
  seen: boolean;
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
}

type SortMode = 'newest' | 'oldest' | 'unread' | 'sender';

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

async function getPassword(account: string): Promise<string | null> {
  const cred = await invoke<{ ok: boolean; password?: string }>('keychain_get', { host: `mail:${account}` })
    .catch(() => ({ ok: false }) as { ok: boolean; password?: string });
  return cred?.ok && cred.password ? cred.password : null;
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

  const [rows, setRows] = useState<MailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('newest');

  // AI "describe what to show" filter
  const [aiQuery, setAiQuery] = useState('');
  const [aiFilter, setAiFilter] = useState<{ description: string; keys: Set<string> } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [selected, setSelected] = useState<MailRow | null>(null);
  const [body, setBody] = useState<MailBodyData | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);

  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (accounts.length === 0) { setRows([]); return; }
    setLoading(true);
    setError(null);
    try {
      const per = await Promise.all(
        accounts.map(async (acct): Promise<MailRow[]> => {
          const pw = await getPassword(acct.email);
          if (!pw) return [];
          const headers = await invoke<MailHeader[]>('mail_fetch_recent', {
            provider: acct.provider, email: acct.email, password: pw, limit: 30,
          }).catch(() => [] as MailHeader[]);
          return headers.map(h => ({ ...h, account: acct.email, provider: acct.provider }));
        }),
      );
      setRows(per.flat());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsKey]);

  useEffect(() => { load(); }, [load]);

  const sortedRows = useMemo(() => {
    const r = [...rows];
    switch (sort) {
      case 'oldest': return r.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
      case 'unread': return r.sort((a, b) => Number(a.seen) - Number(b.seen) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      case 'sender': return r.sort((a, b) => (a.fromName || a.fromEmail).localeCompare(b.fromName || b.fromEmail));
      default: return r.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    }
  }, [rows, sort]);

  const displayRows = useMemo(
    () => (aiFilter ? sortedRows.filter(r => aiFilter.keys.has(`${r.account}-${r.uid}`)) : sortedRows),
    [sortedRows, aiFilter],
  );

  // AI filter: ask the model which of the loaded messages match the user's description, then
  // narrow the list to those. Indexed by position for a stable, easy-to-parse mapping.
  const runAiFilter = async () => {
    const q = aiQuery.trim();
    if (!q || sortedRows.length === 0) return;
    const modelConfig = (models as any[]).find(m => m.id === selectedModelId) ?? (models as any[])[0];
    if (!modelConfig) { setAiError('No model configured in Settings'); return; }
    setAiLoading(true);
    setAiError(null);
    const list = sortedRows;
    const listing = list
      .map((r, i) => `${i + 1}. From: ${r.fromName || r.fromEmail} | Subject: ${r.subject || '(no subject)'}`)
      .join('\n');
    const prompt = `You are filtering an email inbox. Below is a numbered list of emails.\n\nReturn ONLY a JSON array of the numbers of the emails that match this request: "${q}". Match on intent and be reasonably inclusive. Output just the array, e.g. [1,4,5] — no other text.\n\n${listing}`;
    try {
      const resp: string = await generateTextResponse({
        messages: [{ id: `mailfilter-${list.length}`, role: 'user', content: prompt }],
        modelConfig,
        agent: { prompt: 'You output only a JSON array of integers, nothing else.', tools: {}, trainingDocs: [] },
        profile: '', tasks: [], attachedDocs: [], agentPinnedMessages: [], mode: 'text',
        canvasContent: null, isDeepThinking: false, onChunk: null, signal: null,
        appSettings: {}, integrations: {}, models: [],
      });
      const m = resp.match(/\[[\s\S]*?\]/);
      const idxs: number[] = m ? JSON.parse(m[0]) : [];
      const keys = new Set(
        idxs.map(n => list[n - 1]).filter(Boolean).map(r => `${r.account}-${r.uid}`),
      );
      setAiFilter({ description: q, keys });
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  };

  const clearAiFilter = () => { setAiFilter(null); setAiQuery(''); setAiError(null); };

  const setSeenLocal = (row: MailRow, seen: boolean) =>
    setRows(prev => prev.map(r => (r.account === row.account && r.uid === row.uid ? { ...r, seen } : r)));

  const openMessage = useCallback(async (row: MailRow) => {
    setSelected(row);
    setBody(null);
    setBodyError(null);
    setBodyLoading(true);
    // Auto mark-read (optimistic + backend), like Gmail.
    if (!row.seen) {
      setSeenLocal(row, true);
      getPassword(row.account).then(pw => {
        if (pw) invoke('mail_set_seen', { provider: row.provider, email: row.account, password: pw, uid: row.uid, seen: true }).catch(() => {});
      });
    }
    try {
      const pw = await getPassword(row.account);
      if (!pw) throw new Error('No saved password for this account');
      const b = await invoke<MailBodyData>('mail_fetch_body', { provider: row.provider, email: row.account, password: pw, uid: row.uid });
      setBody(b);
    } catch (e) {
      setBodyError(String(e));
    } finally {
      setBodyLoading(false);
    }
  }, []);

  const markUnread = async (row: MailRow) => {
    setSeenLocal(row, false);
    const pw = await getPassword(row.account);
    if (pw) invoke('mail_set_seen', { provider: row.provider, email: row.account, password: pw, uid: row.uid, seen: false }).catch(() => {});
    setSelected(null);
    setBody(null);
  };

  const deleteMessage = async (row: MailRow) => {
    setRows(prev => prev.filter(r => !(r.account === row.account && r.uid === row.uid)));
    if (selected && selected.account === row.account && selected.uid === row.uid) { setSelected(null); setBody(null); }
    const pw = await getPassword(row.account);
    if (pw) invoke('mail_delete', { provider: row.provider, email: row.account, password: pw, uid: row.uid }).catch(() => {});
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
    setCompose({ mode: all ? 'replyAll' : 'reply', to: to.join(', '), cc: cc.join(', '), subject, body: quoteBody(body, selected), inReplyTo: body.messageId || '', account: selected.account, provider: selected.provider });
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
      const pw = await getPassword(compose.account);
      if (!pw) throw new Error(`No saved password for ${compose.account}`);
      await invoke('mail_send', {
        provider: compose.provider, email: compose.account, password: pw,
        to, cc, subject: compose.subject, body: compose.body, inReplyTo: compose.inReplyTo || null,
      });
      setCompose(null);
    } catch (e) {
      setSendError(String(e));
    } finally {
      setSending(false);
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
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-neutral-900">
        <div className="h-12 flex items-center gap-3 px-4 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
          <button onClick={() => setCompose(null)} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors" title="Discard">
            <X className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            {compose.mode === 'new' ? 'New message' : compose.mode === 'replyAll' ? 'Reply all' : 'Reply'}
          </span>
          <span className="text-xs text-neutral-400">from {compose.account}</span>
          <div className="flex-1" />
          <button onClick={sendCompose} disabled={sending} className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#4A5D75] text-white hover:opacity-90 transition-opacity disabled:opacity-40">
            {sending ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
          </button>
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto">
          {([['To', 'to'], ['Cc', 'cc'], ['Subject', 'subject']] as const).map(([label, field]) => (
            <div key={field} className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-100 dark:border-neutral-800">
              <label className="text-xs font-medium text-neutral-400 w-12 shrink-0">{label}</label>
              <input
                value={(compose as any)[field]}
                onChange={ev => setCompose(c => (c ? { ...c, [field]: ev.target.value } : c))}
                placeholder={field === 'cc' ? 'optional, comma-separated' : field === 'to' ? 'comma-separated' : ''}
                className="flex-1 bg-transparent text-sm text-neutral-800 dark:text-neutral-100 outline-none"
              />
            </div>
          ))}
          <textarea
            value={compose.body}
            onChange={ev => setCompose(c => (c ? { ...c, body: ev.target.value } : c))}
            placeholder="Write your message…"
            className="flex-1 min-h-[240px] resize-none bg-transparent px-4 py-3 text-sm text-neutral-800 dark:text-neutral-200 outline-none leading-relaxed font-sans"
          />
          {sendError && <div className="px-4 py-2 text-xs font-medium text-red-500 break-words">✗ {sendError}</div>}
        </div>
      </div>
    );
  }

  // ── Reading view ──
  if (selected) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-neutral-900">
        <div className="h-12 flex items-center gap-1 px-3 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
          <button onClick={() => { setSelected(null); setBody(null); }} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <button onClick={() => startReply(false)} disabled={!body} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors disabled:opacity-40" title="Reply">
            <Reply className="w-4 h-4" />
          </button>
          <button onClick={() => startReply(true)} disabled={!body} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors disabled:opacity-40" title="Reply all">
            <ReplyAll className="w-4 h-4" />
          </button>
          <button onClick={() => markUnread(selected)} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors" title="Mark as unread">
            <Mail className="w-4 h-4" />
          </button>
          <button onClick={() => deleteMessage(selected)} className="p-1.5 rounded-lg text-neutral-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500 transition-colors" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-4 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{selected.subject || '(no subject)'}</h1>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="font-medium text-neutral-700 dark:text-neutral-200">{selected.fromName || selected.fromEmail}</span>
            {selected.fromName && <span className="text-neutral-400">&lt;{selected.fromEmail}&gt;</span>}
            <span className="w-2 h-2 rounded-full" style={{ background: DOT[selected.provider] }} title={selected.account} />
            <div className="flex-1" />
            <span className="text-xs text-neutral-400">{new Date(Date.parse(selected.date) || Date.now()).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {bodyLoading ? (
            <div className="h-full flex items-center justify-center gap-2 text-neutral-400"><RotateCw className="w-5 h-5 animate-spin" /> <span className="text-sm">Loading message…</span></div>
          ) : bodyError ? (
            <div className="p-6 text-sm text-red-500">Couldn't load message: {bodyError}</div>
          ) : body?.html ? (
            <iframe title="email" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={body.html} onLoad={onIframeLoad} className="w-full h-full border-0 bg-white" />
          ) : (
            <pre className="px-6 py-4 whitespace-pre-wrap break-words font-sans text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">{body?.text || '(empty message)'}</pre>
          )}
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-neutral-900">
      <div className="h-12 flex items-center gap-3 px-4 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
        <Inbox className="w-4 h-4 text-neutral-400" />
        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Inbox</span>
        {accounts.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-neutral-400">
            {accounts.map(a => <span key={a.id} className="w-2 h-2 rounded-full" style={{ background: DOT[a.provider] }} title={a.email} />)}
            <span className="ml-1">{rows.length}</span>
          </span>
        )}
        <div className="flex-1" />
        {accounts.length > 0 && (
          <>
            <button onClick={startCompose} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#4A5D75] text-white hover:opacity-90 transition-opacity" title="Compose">
              <Pencil className="w-3.5 h-3.5" /> Compose
            </button>
            <select value={sort} onChange={e => setSort(e.target.value as SortMode)} className="text-xs bg-transparent border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-1 text-neutral-600 dark:text-neutral-300 outline-none" title="Sort">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="unread">Unread first</option>
              <option value="sender">Sender A–Z</option>
            </select>
          </>
        )}
        <button onClick={load} disabled={loading || accounts.length === 0} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors disabled:opacity-40" title="Refresh">
          <RotateCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {accounts.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
          <Wand2 className="w-3.5 h-3.5 text-[#4A5D75] shrink-0" />
          <input
            value={aiQuery}
            onChange={e => setAiQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runAiFilter(); }}
            placeholder="Describe what to show — e.g. “invoices & receipts”, “needs a reply”"
            className="flex-1 bg-transparent text-xs text-neutral-700 dark:text-neutral-300 outline-none placeholder:text-neutral-400"
          />
          {aiLoading && <RotateCw className="w-3.5 h-3.5 animate-spin text-neutral-400" />}
          {aiFilter ? (
            <button onClick={clearAiFilter} className="flex items-center gap-1 text-[11px] font-medium text-[#4A5D75] hover:underline shrink-0">
              {displayRows.length} match{displayRows.length === 1 ? '' : 'es'} · clear <X className="w-3 h-3" />
            </button>
          ) : (
            <button onClick={runAiFilter} disabled={!aiQuery.trim() || aiLoading} className="text-[11px] font-semibold text-[#4A5D75] disabled:opacity-40 shrink-0">Filter</button>
          )}
        </div>
      )}
      {aiError && <div className="px-4 py-1.5 text-[11px] text-red-500 border-b border-neutral-100 dark:border-neutral-800 shrink-0">✗ {aiError}</div>}

      <div className="flex-1 overflow-y-auto">
        {accounts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
            <Mail className="w-8 h-8 text-neutral-300 dark:text-neutral-600" />
            <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">No mail accounts connected yet. Add Gmail or iCloud with an app password to bring your inbox in.</p>
            <button onClick={openMailSettings} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#4A5D75] text-white hover:opacity-90 transition-opacity">
              <SettingsIcon className="w-3.5 h-3.5" /> Connect an account
            </button>
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-500">Couldn't load mail: {error}</div>
        ) : loading && rows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-neutral-400"><RotateCw className="w-5 h-5 animate-spin" /><span className="text-sm">Loading your inbox…</span></div>
        ) : displayRows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-neutral-400">{aiFilter ? 'No matches for that filter.' : 'No messages.'}</div>
        ) : (
          displayRows.map(r => (
            <div key={`${r.account}-${r.uid}`} className="group relative flex items-start gap-3 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
              <button onClick={() => openMessage(r)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-semibold text-neutral-500 dark:text-neutral-300">{initials(r.fromName, r.fromEmail)}</div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-neutral-900" style={{ background: DOT[r.provider] }} title={r.account} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-sm truncate', !r.seen ? 'font-bold text-neutral-900 dark:text-neutral-50' : 'text-neutral-700 dark:text-neutral-300')}>{r.fromName || r.fromEmail || '(unknown sender)'}</span>
                    {!r.seen && <span className="w-1.5 h-1.5 rounded-full bg-[#4A5D75] shrink-0" />}
                    <div className="flex-1" />
                    <span className="text-xs text-neutral-400 shrink-0 group-hover:opacity-0 transition-opacity">{formatDate(r.date)}</span>
                  </div>
                  <div className={clsx('text-sm truncate', !r.seen ? 'font-medium text-neutral-800 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-400')}>{r.subject || '(no subject)'}</div>
                  <div className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{r.fromEmail}</div>
                </div>
              </button>
              <button
                onClick={() => deleteMessage(r)}
                className="absolute right-3 top-3 p-1.5 rounded-lg text-neutral-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500 transition-all"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
