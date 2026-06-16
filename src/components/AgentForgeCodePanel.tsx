import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  FolderGit2, Folder, FileText, FolderPlus, FileInput, RotateCw, Trash2, Pencil,
  ExternalLink, Link2, Copy, RefreshCw, X, GitBranch, ChevronRight, Home, Search,
  ShieldAlert, Check, Clock, CornerUpLeft, Unlink,
} from 'lucide-react';
import clsx from 'clsx';
import { useMemoryStore } from '../store/useMemoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSpaceStore } from '../store/useSpaceStore';
import { useToolContextStore } from '../store/useToolContextStore';
import { parseProvenance, provenanceComment, stripProvenance, importTargetName } from '../services/fileAccess/provenance';
import { spaceHome, spacePath, relativeToSpace } from '../services/fileAccess/spaces';
import { makeGrant, grantKey } from '../services/fileAccess/consent';
import type { Provenance } from '../services/fileAccess/provenance';
import type { FileActivityEntry, FileGrant, GrantScope } from '../services/fileAccess/types';

// AgentForge Code — the human-facing cockpit over the agent's file-access engine. It browses the
// agent's workspace (~/AgentForge/workspace), brings in real files (recommending work-in-place for
// repos vs a tracked copy for loose docs), and surfaces the grants + activity the engine already
// records. The agent reaches the same files via ```file_op blocks; this is just the front door.
// Phase 1 of the AgentForge Code roadmap (editor → terminal/git come next). See the design doc.

interface Entry { name: string; path: string; isDir: boolean; size: number }
type View = 'workspace' | 'linked' | 'activity';
interface Selected { path: string; content: string; provenance: Provenance | null }
interface ImportRec { source: string; inProject: boolean; isRepo: boolean; root?: string }

const hasTauri = typeof window !== 'undefined' && !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

function relativeTime(ts: number): string {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}

export function AgentForgeCodePanel() {
  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const workspaceRoot = agentForgePath ? `${agentForgePath}/workspace` : '';
  const grants = useSettingsStore(s => s.appSettings.fileAccessGrants ?? {});
  const activity = useSettingsStore(s => s.appSettings.fileActivity ?? []);
  const revokeFileGrant = useSettingsStore(s => s.revokeFileGrant);
  // A space ≈ a project; each gets its own home folder (spaces/<id>/) under the workspace jail, so its
  // files stay separate from other spaces'. See docs/agentforge-code-design.md.
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);
  const spaceName = useSpaceStore(s => s.spaces.find(x => x.id === s.activeSpaceId)?.name ?? 'Workspace');
  const rootPath = spaceHome(activeSpaceId);

  const [view, setView] = useState<View>('workspace');
  const [cwd, setCwd] = useState<string>(() => spaceHome(useSpaceStore.getState().activeSpaceId));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [importRec, setImportRec] = useState<ImportRec | null>(null);

  const log = useCallback((action: FileActivityEntry['action'], path: string, ok: boolean, detail?: string) => {
    useSettingsStore.getState().logFileActivity({
      id: `afc-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      action, path, tier: path.startsWith('/') ? 'external' : 'workspace', ok, detail, at: Date.now(),
    });
  }, []);

  const load = useCallback(async () => {
    if (!hasTauri) { setError('The workspace lives on disk — open AgentForge Code in the desktop app to browse it.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await invoke<any>('fs_list', { path: cwd });
      if (res?.ok) setEntries((res.entries ?? []) as Entry[]);
      else setError(res?.error ?? 'Could not read the workspace');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { if (view === 'workspace') void load(); }, [view, load]);

  // Follow the active space — jump to its home folder when you switch spaces.
  useEffect(() => { setCwd(rootPath); setSelected(null); }, [rootPath]);

  // Publish what's on screen to the docked agent (workspace files are trusted-local → no source tag).
  useEffect(() => {
    const here = relativeToSpace(activeSpaceId, cwd);
    const text = selected
      ? `Open file "${relativeToSpace(activeSpaceId, selected.path)}" in space "${spaceName}":\n${selected.content.slice(0, 4000)}`
      : `AgentForge Code — space "${spaceName}" /${here}\n` + entries.slice(0, 60).map(e => `${e.isDir ? '📁 ' : ''}${relativeToSpace(activeSpaceId, e.path)}`).join('\n');
    useToolContextStore.getState().setToolContext({ label: selected ? `Code: ${relativeToSpace(activeSpaceId, selected.path)}` : `Code · ${spaceName}`, text });
    return () => useToolContextStore.getState().clearToolContext();
  }, [selected, entries, cwd, activeSpaceId, spaceName]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const absOf = (relPath: string) => (workspaceRoot ? `${workspaceRoot}/${relPath}` : relPath);
  const reveal = (absPath: string) => { void invoke('fs_reveal', { path: absPath }).catch(() => {}); };

  const openEntry = async (e: Entry) => {
    if (e.isDir) { setCwd(e.path); setSelected(null); return; }
    try {
      const res = await invoke<any>('fs_read', { path: e.path });
      const content = res?.ok ? (res.content ?? '') : '';
      setSelected({ path: e.path, content, provenance: parseProvenance(content) });
      if (!res?.ok) setToast(res?.error ?? 'Could not read this file (it may be binary)');
    } catch (err: any) { setToast(String(err)); }
  };

  const createFolder = async () => {
    const name = window.prompt('New folder name');
    if (!name) return;
    const path = cwd ? `${cwd}/${name}` : name;
    const res = await invoke<any>('fs_mkdir', { path });
    if (res?.ok) { log('write', path, true, 'created folder'); void load(); }
    else setToast(res?.error ?? 'Could not create the folder');
  };

  const renameEntry = async (e: Entry) => {
    const next = window.prompt('Rename to', e.name);
    if (!next || next === e.name) return;
    const base = parentOf(e.path);
    const to = base ? `${base}/${next}` : next;
    const res = await invoke<any>('fs_move', { from: e.path, to });
    if (res?.ok) { log('move', to, true, `renamed from ${e.name}`); if (selected?.path === e.path) setSelected(null); void load(); }
    else setToast(res?.error ?? 'Rename failed');
  };

  const deleteEntry = async (e: Entry) => {
    if (!window.confirm(`Delete "${e.name}"?\n\nThe workspace is git-versioned, so this can be recovered.`)) return;
    const res = await invoke<any>('fs_delete', { path: e.path });
    if (res?.ok) { log('delete', e.path, true); if (selected?.path === e.path) setSelected(null); void load(); }
    else setToast(res?.error ?? 'Delete failed');
  };

  // ── Bring in a file: pick → probe → recommend ─────────────────────────────
  const bringInFile = async () => {
    try {
      const sel = await openDialog({ multiple: false, title: 'Choose a file to bring in' });
      if (!sel || typeof sel !== 'string') return;
      let probe: any = { inProject: false };
      try { probe = await invoke('fs_probe_context', { path: sel }); } catch { /* default to loose */ }
      setImportRec({ source: sel, inProject: !!probe?.inProject, isRepo: !!probe?.isRepo, root: probe?.root });
    } catch (e: any) { setToast(String(e)); }
  };

  const importCopy = async (source: string) => {
    const dest = spacePath(activeSpaceId, importTargetName(source, Date.now()));
    const res = await invoke<any>('fs_import', { sourcePath: source, destName: dest });
    if (!res?.ok) { setToast(res?.error ?? 'Import failed'); return; }
    // Stamp provenance so the copy is never an orphan — text files only (binary fs_read fails).
    const read = await invoke<any>('fs_read', { path: res.path });
    if (read?.ok) {
      const withProv = (read.content ?? '') + provenanceComment(source, new Date());
      await invoke('fs_write', { path: res.path, content: withProv });
    }
    log('import', res.path, true, `from ${source}`);
    setImportRec(null);
    setSelected(null);
    setCwd(parentOf(res.path));
    setToast(`Imported a copy → ${res.path}`);
  };

  const workInPlace = (rec: ImportRec) => {
    const target = rec.inProject && rec.root ? rec.root : rec.source;
    const scope: GrantScope = rec.inProject ? 'folder' : 'file';
    useSettingsStore.getState().addFileGrant(makeGrant(target, scope, 'write', Date.now()));
    log('write', target, true, `linked for in-place editing (${scope})`);
    setImportRec(null);
    setView('linked');
    setToast(`Linked ${target} — the agent can now work here in place`);
  };

  // ── Provenance actions on the open file ───────────────────────────────────
  const reSync = async () => {
    if (!selected?.provenance) return;
    const src = selected.provenance.source;
    const r = await invoke<any>('fs_read_external', { path: src });
    if (!r?.ok) { setToast(`Couldn't read the original: ${r?.error ?? 'missing?'}`); return; }
    const content = (r.content ?? '') + provenanceComment(src, new Date());
    const w = await invoke<any>('fs_write', { path: selected.path, content });
    if (w?.ok) { setSelected({ ...selected, content, provenance: parseProvenance(content) }); log('write', selected.path, true, `re-synced from ${src}`); setToast('Re-synced from the original'); }
    else setToast(w?.error ?? 'Re-sync failed');
  };

  const pushBack = async () => {
    if (!selected?.provenance) return;
    const src = selected.provenance.source;
    if (!window.confirm(`Overwrite the original file?\n\n${src}\n\nThis writes your workspace copy back to its source.`)) return;
    const stripped = stripProvenance(selected.content);
    const w = await invoke<any>('fs_write_external', { path: src, content: stripped });
    if (w?.ok) { log('write', src, true, 'pushed back to original'); setToast('Pushed your changes back to the original'); }
    else setToast(w?.error ?? 'Push back failed');
  };

  const detach = async () => {
    if (!selected) return;
    const stripped = stripProvenance(selected.content);
    const w = await invoke<any>('fs_write', { path: selected.path, content: stripped });
    if (w?.ok) { setSelected({ ...selected, content: stripped, provenance: null }); setToast('Detached — now a plain workspace file'); }
    else setToast(w?.error ?? 'Detach failed');
  };

  const crumbs = useMemo(() => {
    const rel = relativeToSpace(activeSpaceId, cwd);
    return rel ? rel.split('/') : [];
  }, [cwd, activeSpaceId]);
  const shown = useMemo(
    () => (query ? entries.filter(e => e.name.toLowerCase().includes(query.toLowerCase())) : entries),
    [entries, query],
  );
  const grantList = useMemo(() => Object.entries(grants) as Array<[string, FileGrant]>, [grants]);

  const Segment = ({ id, label }: { id: View; label: string }) => (
    <button
      onClick={() => { setView(id); setSelected(null); }}
      className={clsx(
        'px-3 py-1 rounded-md text-xs font-semibold transition-colors',
        view === id ? 'bg-panel text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
      )}
    >{label}</button>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      {/* Header */}
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <FolderGit2 className="w-4 h-4 text-ink-3" />
        <span className="text-sm font-semibold text-ink">Code</span>
        <div className="flex items-center gap-1 ml-2 p-0.5 rounded-lg bg-inset">
          <Segment id="workspace" label="Workspace" />
          <Segment id="linked" label="Linked files" />
          <Segment id="activity" label="Activity" />
        </div>
        <div className="flex-1" />
        {view === 'workspace' && (
          <>
            <button onClick={createFolder} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-ink-2 border border-edge-2 hover:bg-wash transition-colors" title="New folder">
              <FolderPlus className="w-3.5 h-3.5" /> New folder
            </button>
            <button onClick={bringInFile} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity" title="Bring in a file">
              <FileInput className="w-3.5 h-3.5" /> Bring in a file…
            </button>
            <button onClick={() => load()} disabled={loading} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Refresh">
              <RotateCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
          </>
        )}
      </div>

      {/* ── Workspace view ── */}
      {view === 'workspace' && (
        <div className="flex-1 flex overflow-hidden">
          {/* File list */}
          <div className="w-80 shrink-0 border-r border-edge flex flex-col overflow-hidden">
            {/* Breadcrumb + filter */}
            <div className="px-3 py-2 border-b border-edge flex flex-col gap-2 shrink-0">
              <div className="flex items-center gap-1 text-xs text-ink-3 flex-wrap">
                <button onClick={() => { setCwd(rootPath); setSelected(null); }} className="flex items-center gap-1 hover:text-ink-2" title={spaceName}><Home className="w-3.5 h-3.5" /> {spaceName}</button>
                {crumbs.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChevronRight className="w-3 h-3" />
                    <button onClick={() => { setCwd(spacePath(activeSpaceId, crumbs.slice(0, i + 1).join('/'))); setSelected(null); }} className="hover:text-ink-2">{seg}</button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-inset">
                <Search className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter files…" className="flex-1 bg-transparent text-xs text-ink outline-none" />
                {query && <button onClick={() => setQuery('')} className="text-ink-3 hover:text-ink"><X className="w-3.5 h-3.5" /></button>}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {error ? (
                <div className="p-5 text-xs text-ink-3 leading-relaxed">{error}</div>
              ) : loading && entries.length === 0 ? (
                <div className="h-full flex items-center justify-center gap-2 text-ink-3"><RotateCw className="w-4 h-4 animate-spin" /> <span className="text-xs">Loading…</span></div>
              ) : shown.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6 text-ink-3">
                  <Folder className="w-7 h-7" />
                  <p className="text-xs">{query ? 'No files match.' : 'This folder is empty. Ask an agent to create something, or bring in a file.'}</p>
                </div>
              ) : (
                shown.map(e => (
                  <div key={e.path} className={clsx('group flex items-center gap-2.5 px-3 py-2 border-b border-edge hover:bg-wash transition-colors cursor-pointer', selected?.path === e.path && 'bg-wash')} onClick={() => openEntry(e)}>
                    {e.isDir ? <Folder className="w-4 h-4 text-accent shrink-0" /> : <FileText className="w-4 h-4 text-ink-3 shrink-0" />}
                    <span className="flex-1 min-w-0 text-sm text-ink truncate">{e.name}</span>
                    <span className="text-[10px] text-ink-3 group-hover:hidden">{e.isDir ? '' : formatSize(e.size)}</span>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button onClick={ev => { ev.stopPropagation(); renameEntry(e); }} className="p-1 rounded text-ink-3 hover:bg-inset hover:text-ink" title="Rename"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={ev => { ev.stopPropagation(); reveal(absOf(e.path)); }} className="p-1 rounded text-ink-3 hover:bg-inset hover:text-ink" title="Reveal in Finder"><ExternalLink className="w-3.5 h-3.5" /></button>
                      <button onClick={ev => { ev.stopPropagation(); deleteEntry(e); }} className="p-1 rounded text-ink-3 hover:bg-danger-soft hover:text-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1 flex flex-col overflow-hidden bg-panel-2">
            {selected ? (
              <>
                <div className="px-4 py-2.5 border-b border-edge shrink-0 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-ink-3 shrink-0" />
                  <span className="text-sm font-medium text-ink truncate flex-1">{selected.path}</span>
                  <button onClick={() => reveal(absOf(selected.path))} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink" title="Reveal in Finder"><ExternalLink className="w-4 h-4" /></button>
                </div>
                {selected.provenance && (
                  <div className="px-4 py-2.5 border-b border-edge bg-info-soft/30 shrink-0">
                    <div className="flex items-center gap-2 text-xs text-ink-2">
                      <Link2 className="w-3.5 h-3.5 text-info shrink-0" />
                      <span className="truncate">Imported copy of <span className="font-mono">{selected.provenance.source}</span> · {relativeTime(new Date(selected.provenance.imported).getTime())}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button onClick={() => reveal(selected.provenance!.source)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><ExternalLink className="w-3 h-3" /> Open original</button>
                      <button onClick={reSync} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><RefreshCw className="w-3 h-3" /> Re-sync</button>
                      <button onClick={pushBack} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><CornerUpLeft className="w-3 h-3" /> Push back</button>
                      <button onClick={detach} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><Unlink className="w-3 h-3" /> Detach</button>
                    </div>
                  </div>
                )}
                <pre className="flex-1 overflow-auto text-[12px] font-mono leading-relaxed text-ink-2 whitespace-pre-wrap px-4 py-3">{selected.content || '(empty file)'}</pre>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-3 text-center px-8">
                <FolderGit2 className="w-9 h-9" />
                <p className="text-sm max-w-xs">Select a file to preview it. This is the same workspace your agents read and write — changes here and theirs stay in sync, git-versioned and undoable.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Linked files view ── */}
      {view === 'linked' && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-3 text-xs text-ink-3 border-b border-edge leading-relaxed">
            Real files and folders you've allowed an agent to work in <span className="font-semibold text-ink-2">in place</span> (no copy). Revoke any time.
          </div>
          {grantList.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-ink-3 text-center px-8">
              <Link2 className="w-8 h-8" />
              <p className="text-sm max-w-xs">No linked files yet. Use “Bring in a file…” and choose <span className="font-semibold">Work in place</span> for repo or project files.</p>
            </div>
          ) : grantList.map(([key, g]) => (
            <div key={key} className="group flex items-center gap-3 px-5 py-3 border-b border-edge hover:bg-wash transition-colors">
              <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', g.scope === 'folder' ? 'bg-accent-soft text-accent' : 'bg-inset text-ink-3')}>
                {g.scope === 'folder' ? <Folder className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink font-mono truncate">{g.path}</div>
                <div className="text-[11px] text-ink-3">{g.scope === 'folder' ? 'Folder (and everything under it)' : 'This file'} · can {g.effect} · since {relativeTime(g.grantedAt)}</div>
              </div>
              <button onClick={() => reveal(g.path)} className="p-1.5 rounded-lg text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-inset hover:text-ink transition-all" title="Reveal in Finder"><ExternalLink className="w-4 h-4" /></button>
              <button onClick={() => revokeFileGrant(grantKey(g))} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-ink-3 border border-edge-2 hover:bg-danger-soft hover:text-danger hover:border-danger/40 transition-colors" title="Revoke access">Revoke</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Activity view ── */}
      {view === 'activity' && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-3 text-xs text-ink-3 border-b border-edge leading-relaxed">Every file and command action — yours and the agents' — newest first.</div>
          {activity.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-ink-3 text-center px-8">
              <Clock className="w-8 h-8" />
              <p className="text-sm">Nothing yet. File activity shows up here as a receipt.</p>
            </div>
          ) : activity.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-edge">
              <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', a.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
                {a.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink truncate"><span className="font-semibold capitalize">{a.action}</span> <span className="font-mono text-ink-2">{a.path}</span></div>
                {a.detail && <div className="text-[11px] text-ink-3 truncate">{a.detail}</div>}
              </div>
              <span className={clsx('text-[10px] uppercase tracking-widest font-semibold shrink-0', a.tier === 'external' ? 'text-warning' : a.tier === 'command' ? 'text-danger' : 'text-ink-3')}>{a.tier}</span>
              <span className="text-[10px] text-ink-3 shrink-0 w-16 text-right">{relativeTime(a.at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-ink text-panel text-xs font-medium shadow-lg max-w-md text-center">{toast}</div>
      )}

      {/* ── Import recommendation sheet ── */}
      {importRec && (
        <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setImportRec(null)}>
          <div className="bg-panel-2 w-full max-w-md rounded-2xl border border-edge shadow-2xl p-5 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            {importRec.inProject ? (
              <>
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-warning shrink-0" />
                  <span className="text-sm font-bold text-ink">This file lives inside {importRec.isRepo ? 'a Git repo' : 'a project'}</span>
                </div>
                <p className="text-xs text-ink-2 leading-relaxed">
                  <span className="font-mono">{importRec.source}</span> is part of <span className="font-mono">{importRec.root}</span>.
                </p>
                <div className="rounded-xl bg-warning-soft/40 px-3 py-2.5 text-xs text-ink-2 leading-relaxed">
                  <ShieldAlert className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-warning" />
                  Recommended: <span className="font-semibold">work in place</span> so edits stay in your repo and git history. Copying would create a stale duplicate.
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => workInPlace(importRec)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-accent text-on-accent hover:bg-accent-strong"><Link2 className="w-3.5 h-3.5" /> Work in place</button>
                  <button onClick={() => importCopy(importRec.source)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-edge-2 text-ink-2 hover:bg-wash"><Copy className="w-3.5 h-3.5" /> Copy in anyway</button>
                  <button onClick={() => setImportRec(null)} className="px-3 py-2 rounded-xl text-xs font-bold text-ink-3 hover:bg-wash">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <FileInput className="w-4 h-4 text-accent shrink-0" />
                  <span className="text-sm font-bold text-ink">Bring this file into your workspace</span>
                </div>
                <p className="text-xs text-ink-2 leading-relaxed">
                  <span className="font-mono">{importRec.source}</span> is a loose file. A tracked copy goes into your workspace — the original stays untouched.
                </p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => importCopy(importRec.source)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-accent text-on-accent hover:bg-accent-strong"><Copy className="w-3.5 h-3.5" /> Import a copy</button>
                  <button onClick={() => workInPlace(importRec)} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-edge-2 text-ink-2 hover:bg-wash"><Link2 className="w-3.5 h-3.5" /> Work in place</button>
                  <button onClick={() => setImportRec(null)} className="px-3 py-2 rounded-xl text-xs font-bold text-ink-3 hover:bg-wash">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
