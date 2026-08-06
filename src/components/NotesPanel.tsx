import { useState, useEffect, useCallback } from 'react';
import { StickyNote, RotateCw, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';


import { getNotes } from '../services/connectors';
import type { NoteItem } from '../services/connectors';
import { useSettingsStore } from '../store/useSettingsStore';
import { ConnectorAccessGate } from './ui/ConnectorAccessGate';
import { useToolContextStore } from '../store/useToolContextStore';
import { useUIStore } from '../store/useUIStore';
// through plaintext — that path silently flattened bold/lists/images on the first edit.
function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split('\n').map(l => `<div>${l || '<br>'}</div>`).join('');
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

export function invalidateNotesCache(id?: string, newBody?: string) {
  if (id && newBody !== undefined) {
    notesCache.bodies[id] = newBody;
  }
  notesCache.byFolder = {};
}


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

  // Publish the current notes view to the docked agent (the list of titles).
  useEffect(() => {
    const text = notes.slice(0, 40).map(n => `• ${n.title || '(untitled)'}`).join('\n') || '(no notes)';
    useToolContextStore.getState().setToolContext({ label: 'Notes', text, source: 'notes' });
    return () => useToolContextStore.getState().clearToolContext();
  }, [notes]);

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

  const openNote = async (n: NoteItem) => {
    let html = notesCache.bodies[n.id] ?? '';
    
    if (!html) {
      setLoading(true);
      try {
        const full = await getNotes().readNote(n.id);
        html = full.body;
        notesCache.bodies[n.id] = full.body;
      } catch (e) {
        setError(String(e));
        return;
      } finally {
        setLoading(false);
      }
    }

    useUIStore.getState().setCanvasContent({
      id: n.id,
      title: n.title || 'Untitled Note',
      type: 'doc',
      content: html,
      source: 'notes',
      sourceNoteId: n.id,
      history: [{ timestamp: Date.now(), content: html }],
      historyIndex: 0
    });
    useUIStore.getState().setCanvasTab('preview');
  };

  const createNote = async () => {
    try {
      const id = await getNotes().createNote(folder, 'New Note', textToHtml(''));
      await loadNotes(folder);
      const fresh = { id, folder, title: 'New Note', body: '', updatedAt: Date.now(), source: 'local' as const };
      await openNote(fresh);
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteNote = async (n: NoteItem) => {
    if (!window.confirm(`Delete "${n.title || 'this note'}"?`)) return;
    try {
      await getNotes().deleteNote(n.id);
      loadNotes(folder);
    } catch (e) {
      setError(String(e));
    }
  };
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
              body="Docent can read and create notes in the Apple Notes app — and they sync to your iPhone via iCloud. The first time, macOS asks to let Docent control Notes."
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
