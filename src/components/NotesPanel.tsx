import { useState, useEffect, useCallback } from 'react';
import { StickyNote, RotateCw, Plus, ArrowLeft, Pencil, Trash2, Share2, X, Send, Mail, MessageCircle } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getNotes } from '../services/connectors';
import type { NoteItem } from '../services/connectors';
import { useSettingsStore } from '../store/useSettingsStore';
import { ConnectorAccessGate } from './ui/ConnectorAccessGate';
import { useToolContextStore } from '../store/useToolContextStore';

interface ImChat { guid: string; name: string }

// HTML ↔ plaintext for the editor (Notes bodies are HTML). Keep it simple: strip tags for editing,
// escape + <br> when saving so user line breaks survive.
function htmlToText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent || '').trim();
}
function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split('\n').map(l => `<div>${l || '<br>'}</div>`).join('');
}
// Notes render in a sandboxed iframe (bodies are arbitrary HTML). Wrap the body in a consistent light
// "paper" document — the same surface the editor uses — so saving doesn't flash from the dark editor to
// a bare white frame, and so note content (which assumes a light background) stays readable in dark mode.
const NOTE_PAPER = '#fcfcfa';
const NOTE_INK = '#1c1b17';
function paperNoteDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:${NOTE_PAPER};color:${NOTE_INK};
      font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      padding:20px 26px;-webkit-font-smoothing:antialiased;}
    img{max-width:100%;height:auto;} a{color:#534ab7;} *{max-width:100%;}
  </style></head><body>${html || '<p style="color:#9a988f">(empty note)</p>'}</body></html>`;
}
function relativeTime(ts: number): string {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Module-scoped cache — survives the unmount/remount that a tab switch causes (App.tsx's
// renderTabContent mounts a fresh panel each time). Notes was the worst offender: every reopen
// re-ran AppleScript and flashed empty. Now the panel hydrates from here instantly and refreshes in
// the background. Keyed by backend so switching local↔Apple Notes can't show stale cross-backend data.
const notesCache: {
  backend: string;
  folders: string[];
  byFolder: Record<string, NoteItem[]>;
  bodies: Record<string, string>;
} = { backend: '', folders: [], byFolder: {}, bodies: {} };

export function NotesPanel() {
  const notesBackend: string = useSettingsStore(s => (s.integrations as any).notes?.backend ?? 'local');
  // A backend change invalidates the cache before first paint.
  if (notesCache.backend !== notesBackend) {
    notesCache.backend = notesBackend;
    notesCache.folders = [];
    notesCache.byFolder = {};
    notesCache.bodies = {};
  }
  const [folders, setFolders] = useState<string[]>(() => notesCache.folders);
  const [folder, setFolder] = useState<string>('Notes');
  const [notes, setNotes] = useState<NoteItem[]>(() => notesCache.byFolder['Notes'] ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<NoteItem | null>(null);
  const [body, setBody] = useState<string>(''); // HTML of the open note
  const [bodyLoading, setBodyLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const [sharing, setSharing] = useState(false);
  const [chats, setChats] = useState<ImChat[]>([]);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadFolders = useCallback(async () => {
    try {
      const fs = await getNotes().listFolders();
      notesCache.folders = fs;
      setFolders(fs);
      if (fs.length && !fs.includes(folder)) setFolder(fs[0]);
    } catch (e) {
      setError(String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNotes = useCallback(async (f: string) => {
    // Only show the spinner on a cold load — a cached folder refreshes silently in the background.
    if (!notesCache.byFolder[f]) setLoading(true);
    setError(null);
    try {
      const list = await getNotes().listNotes(f);
      const sorted = list.sort((a, b) => b.updatedAt - a.updatedAt);
      notesCache.byFolder[f] = sorted;
      setNotes(sorted);
    } catch (e) {
      setError(String(e));
      if (!notesCache.byFolder[f]) setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => {
    if (!folder) return;
    // Hydrate instantly from cache on a folder switch, then refresh in the background.
    if (notesCache.byFolder[folder]) setNotes(notesCache.byFolder[folder]);
    loadNotes(folder);
  }, [folder, loadNotes]);

  // Publish the current notes view to the docked agent (open note's text, or the list of titles).
  useEffect(() => {
    const text = selected
      ? `Open note "${selected.title || '(untitled)'}":\n${htmlToText(body)}`
      : (notes.slice(0, 40).map(n => `• ${n.title || '(untitled)'}`).join('\n') || '(no notes)');
    useToolContextStore.getState().setToolContext({ label: selected ? `Note: ${selected.title || 'untitled'}` : 'Notes', text, source: 'notes' });
    return () => useToolContextStore.getState().clearToolContext();
  }, [selected, body, notes]);

  // Retry after the Automation prompt (Apple Notes backend) — the first list call triggers it.
  const reconnect = useCallback(async () => {
    setError(null);
    await loadFolders();
    await loadNotes(folder);
  }, [loadFolders, loadNotes, folder]);

  const openNotesSettings = () => {
    const s = useSettingsStore.getState();
    s.setProfileSettingsTab('integrations');
    s.setShowProfileSettings(true);
  };

  useEffect(() => {
    if (!actionMsg) return;
    const t = setTimeout(() => setActionMsg(null), 4000);
    return () => clearTimeout(t);
  }, [actionMsg]);

  const openNote = async (n: NoteItem) => {
    setSelected(n);
    setEditing(false);
    // Show the cached body instantly (no flash), then refresh it in the background.
    const cached = notesCache.bodies[n.id];
    setBody(cached ?? '');
    setBodyLoading(!cached);
    try {
      const full = await getNotes().readNote(n.id);
      notesCache.bodies[n.id] = full.body;
      setBody(full.body);
    } catch (e) {
      if (!cached) setError(String(e));
    } finally {
      setBodyLoading(false);
    }
  };

  const startEdit = () => { setDraft(htmlToText(body)); setEditing(true); };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const html = textToHtml(draft);
      await getNotes().updateNote(selected.id, html);
      notesCache.bodies[selected.id] = html; // keep the cached body in step with the save
      setBody(html);
      setEditing(false);
      // Title may have changed (Notes derives it from the first line) — refresh the list.
      loadNotes(folder);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const createNote = async () => {
    try {
      const id = await getNotes().createNote(folder, 'New Note', textToHtml(''));
      await loadNotes(folder);
      const fresh = { id, folder, title: 'New Note', body: '', updatedAt: Date.now(), source: 'local' as const };
      await openNote(fresh);
      startEdit();
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteNote = async (n: NoteItem) => {
    if (!window.confirm(`Delete "${n.title || 'this note'}"?`)) return;
    try {
      await getNotes().deleteNote(n.id);
      if (selected?.id === n.id) { setSelected(null); setBody(''); }
      loadNotes(folder);
    } catch (e) {
      setError(String(e));
    }
  };

  // ── Share ──
  const openShare = async () => {
    setSharing(true);
    if (chats.length === 0) {
      const list = await invoke<ImChat[]>('imessage_list_chats', { limit: 30 }).catch(() => [] as ImChat[]);
      setChats(list);
    }
  };
  const shareText = () => `${selected?.title ? selected.title + '\n\n' : ''}${htmlToText(body)}`.trim();
  const shareToChat = async (guid: string) => {
    try {
      await invoke('imessage_send', { chatGuid: guid, text: shareText() });
      setSharing(false);
      setActionMsg('Sent via Messages');
    } catch (e) {
      setActionMsg(`Couldn't send: ${String(e)}`);
    }
  };
  const shareToMail = () => {
    const subject = encodeURIComponent(selected?.title || 'Note');
    const bodyParam = encodeURIComponent(htmlToText(body));
    openUrl(`mailto:?subject=${subject}&body=${bodyParam}`).catch(() => {});
    setSharing(false);
  };

  // ── Reading / editing view ──
  if (selected) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
        <div className="h-12 flex items-center gap-1 px-3 border-b border-edge shrink-0">
          <button onClick={() => { setSelected(null); setBody(''); setEditing(false); }} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-ink truncate flex-1 px-1">{selected.title || '(untitled)'}</span>
          {editing ? (
            <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity disabled:opacity-40">
              {saving ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />} Save
            </button>
          ) : (
            <>
              <button onClick={startEdit} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
              <button onClick={openShare} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Share"><Share2 className="w-4 h-4" /></button>
              <button onClick={() => deleteNote(selected)} className="p-1.5 rounded-lg text-ink-3 hover:bg-danger-soft hover:text-danger transition-colors" title="Delete"><Trash2 className="w-4 h-4" /></button>
            </>
          )}
        </div>

        {actionMsg && <div className="px-4 py-1.5 text-[11px] font-medium text-ink-2 border-b border-edge shrink-0">{actionMsg}</div>}

        <div className="flex-1 overflow-y-auto">
          {bodyLoading ? (
            <div className="h-full flex items-center justify-center gap-2 text-ink-3"><RotateCw className="w-5 h-5 animate-spin" /> <span className="text-sm">Loading note…</span></div>
          ) : editing ? (
            <textarea
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Write your note…"
              style={{ background: NOTE_PAPER, color: NOTE_INK }}
              className="w-full h-full resize-none px-6 py-5 text-[15px] outline-none leading-[1.65] font-sans"
            />
          ) : (
            <iframe title="note" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={paperNoteDoc(body)} className="w-full h-full border-0" style={{ background: NOTE_PAPER }} />
          )}
        </div>

        {/* Share picker */}
        {sharing && (
          <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setSharing(false)}>
            <div className="bg-panel-2 w-full max-w-sm rounded-2xl border border-edge shadow-2xl p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-ink">Share note</span>
                <button onClick={() => setSharing(false)} className="text-ink-3 hover:text-ink"><X className="w-4 h-4" /></button>
              </div>
              <button onClick={shareToMail} className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-edge hover:bg-wash transition-colors text-left">
                <Mail className="w-4 h-4 text-accent shrink-0" /> <span className="text-sm font-medium text-ink">Email it</span>
              </button>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-ink-3 px-1 pt-1"><MessageCircle className="w-3.5 h-3.5" /> Send via Messages</div>
              <div className="max-h-56 overflow-y-auto flex flex-col gap-1">
                {chats.length === 0 ? (
                  <span className="text-xs text-ink-3 px-1 py-2">No conversations available.</span>
                ) : chats.map(c => (
                  <button key={c.guid} onClick={() => shareToChat(c.guid)} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-wash transition-colors text-left">
                    <Send className="w-3.5 h-3.5 text-ink-3 shrink-0" /> <span className="text-sm text-ink-2 truncate">{c.name || c.guid}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <StickyNote className="w-4 h-4 text-ink-3" />
        <span className="text-sm font-semibold text-ink">Notes</span>
        {folders.length > 0 && (
          <select value={folder} onChange={e => setFolder(e.target.value)} className="text-xs bg-transparent border border-edge-2 rounded-lg px-2 py-1 text-ink-2 outline-none" title="Folder">
            {folders.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <button onClick={createNote} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity" title="New note">
          <Plus className="w-3.5 h-3.5" /> New
        </button>
        <button onClick={() => loadNotes(folder)} disabled={loading} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Refresh">
          <RotateCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          notesBackend === 'applescript' ? (
            <ConnectorAccessGate
              icon={StickyNote}
              title="Connect Apple Notes"
              body="Agent Forge can read and create notes in the Apple Notes app — and they sync to your iPhone via iCloud. The first time, macOS asks to let Agent Forge control Notes."
              buttonLabel="Connect Apple Notes"
              onConnect={reconnect}
              busy={loading}
              error={error}
            />
          ) : (
            <div className="p-6 text-sm text-danger">Couldn't load notes: {error}</div>
          )
        ) : loading && notes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-3"><RotateCw className="w-5 h-5 animate-spin" /><span className="text-sm">Loading notes…</span></div>
        ) : notes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
            <StickyNote className="w-8 h-8 text-ink-3" />
            <p className="text-sm text-ink-2 max-w-xs">
              No notes here yet. Create one — it stays {notesBackend === 'applescript' ? 'in Apple Notes and syncs to your devices' : 'on this Mac'}.
            </p>
            {notesBackend !== 'applescript' && (
              <button onClick={openNotesSettings} className="text-xs font-semibold text-accent hover:underline">
                Use Apple Notes instead (syncs to your iPhone) →
              </button>
            )}
          </div>
        ) : (
          notes.map(n => (
            <div key={n.id} className="group relative flex items-start gap-3 px-4 py-3 border-b border-edge hover:bg-wash transition-colors">
              <button onClick={() => openNote(n)} className="flex items-start gap-3 flex-1 min-w-0 text-left">
                <div className="w-9 h-9 rounded-lg bg-inset flex items-center justify-center shrink-0"><StickyNote className="w-4 h-4 text-ink-3" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{n.title || '(untitled)'}</div>
                  <div className="text-xs text-ink-3 truncate">{relativeTime(n.updatedAt)}</div>
                </div>
              </button>
              <button onClick={() => deleteNote(n)} className="absolute right-3 top-3 p-1.5 rounded-lg text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-danger-soft hover:text-danger transition-all" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
