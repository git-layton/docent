import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  FolderGit2, Folder, FileText, FolderPlus, FileInput, RotateCw, Trash2, Pencil,
  ExternalLink, Link2, Copy, RefreshCw, X, GitBranch, ChevronRight, Home, Search,
  ShieldAlert, Settings2, ChevronDown, TerminalSquare, Files, Monitor, CornerUpLeft, Unlink,
  Users, PanelRightClose, Eye,
} from 'lucide-react';
import clsx from 'clsx';
import { useMemoryStore } from '../store/useMemoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSpaceStore, TEAM_CHAT_ID } from '../store/useSpaceStore';
import { useUIStore } from '../store/useUIStore';
import { useChatStore } from '../store/useChatStore';
import { useAgentStore } from '../store/useAgentStore';
import { ChatPanel } from './ChatPanel';
import type { SpaceLogProps, ChatInputBarProps } from './ChatPanel';
import { parseProvenance, provenanceComment, stripProvenance, importTargetName } from '../services/fileAccess/provenance';
import { spaceHome, spacePath, relativeToSpace } from '../services/fileAccess/spaces';
import { TerminalPane } from './TerminalPane';
import { makeGrant } from '../services/fileAccess/consent';
import { resolveCodeyId } from '../store/useAgentStore';
import { db } from '../services/database';
import { extractTextFromPDF } from '../services/pdfParser';
import { modelSupportsVision, hasVisionProvider } from '../services/llm';
import type { Provenance } from '../services/fileAccess/provenance';
import type { FileActivityEntry, GrantScope } from '../services/fileAccess/types';

// ── AgentForge Code — chat-first cockpit (pt 8) ────────────────────────────────
// The Code surface is a CONVERSATION with Codey, the code copilot, who drives the work via the
// app's existing chat machinery (the inline file_op diff cards + command-result cards flow through
// renderMessageWithWidgets, so coding actions render right in the thread). Files / Terminal / Preview
// are togglable side panels — NOT the default view, and NOT tabs. The default view is just Codey's
// chat. The Files panel reuses the original browse/import/preview engine; Terminal reuses TerminalPane;
// Preview frames a localhost dev server. See docs/agentforge-code-design.md pt 8.

interface Entry { name: string; path: string; isDir: boolean; size: number }
type SidePanel = 'files' | 'terminal' | 'preview';
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

interface AgentForgeCodePanelProps {
  spaceLogProps: SpaceLogProps;
  chatInputBarProps: ChatInputBarProps;
  onSendPrompt: (text: string) => void;
  // ── Team rail (pt 9): a SECOND live conversation — the user's REAL agents (NOT Codey) — rendered
  // beside Codey's center chat. The bags are pointed at the Team thread; this panel layers in the
  // rail's OWN composer buffer so the two composers never share state. onSendTeamMessage sends to a
  // specific chatId via processChatRequest, never touching the global active chat.
  teamSpaceLogProps: SpaceLogProps;
  teamChatInputBarProps: ChatInputBarProps;
  onSendTeamMessage: (targetChatId: string, text: string, attachments: any[]) => void;
}

export function AgentForgeCodePanel({
  spaceLogProps,
  chatInputBarProps,
  onSendPrompt,
  teamSpaceLogProps,
  teamChatInputBarProps,
  onSendTeamMessage,
}: AgentForgeCodePanelProps) {
  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const workspaceRoot = agentForgePath ? `${agentForgePath}/workspace` : '';
  // A space ≈ a project; each gets its own home folder (spaces/<id>/) under the workspace jail, so its
  // files stay separate from other spaces'. See docs/agentforge-code-design.md.
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);
  const activeSpace = useSpaceStore(s => s.spaces.find(x => x.id === s.activeSpaceId) ?? null);
  const spaceName = activeSpace?.name ?? 'Code';
  const rootPath = spaceHome(activeSpaceId);

  // Codey drives Code. He's pinned as the Code space's primary, so the global active chat/agent are
  // already his when this panel is on screen (setActiveSpaceId points activeChatId=chat-space-code +
  // activeFolderId=Codey). We reuse the global ChatPanel rather than building a parallel chat.
  const assistants = useAgentStore(s => s.assistants);
  const activeFolderId = useAgentStore(s => s.activeFolderId);
  const models = useSettingsStore(s => s.models);
  const developerMode = useSettingsStore(s => s.appSettings.developerMode ?? false);
  const codeAgent = useMemo(() => {
    const codeyId = resolveCodeyId(assistants);
    return assistants.find((a: any) => a.id === codeyId) ?? assistants[0];
  }, [assistants]);

  // Strategy A: the global chat is keyed off a single activeChatId + activeFolderId, so before the
  // ChatPanel reads/sends, pin them to THIS Code space's conversation (Codey). Guards against drift if
  // the co-pilot agent picker changed activeFolderId in another space. True decoupling (chatId-keyed
  // send pipeline) is deferred — see docs pt 8.
  const codeChatId = activeSpace?.chatId ?? null;
  const codeyPrimaryId = activeSpace?.agentIds[0] ?? null;
  useEffect(() => {
    if (codeChatId && useChatStore.getState().activeChatId !== codeChatId) {
      useChatStore.getState().setActiveChatId(codeChatId);
    }
    if (codeyPrimaryId && useAgentStore.getState().activeFolderId !== codeyPrimaryId) {
      useAgentStore.getState().setActiveFolderId(codeyPrimaryId);
    }
  }, [codeChatId, codeyPrimaryId]);

  // Empty conversation → show the friendly first-run hero instead of a bare composer.
  const isFirstRun = (spaceLogProps.activeMessages?.length ?? 0) === 0;

  // ── Side panels (toggled open; default = just the conversation) ──
  const [sidePanel, setSidePanel] = useState<SidePanel | null>(null);
  const [showGear, setShowGear] = useState(false);

  // ── Team rail (pt 9): a collapsible RIGHT rail that is a PRIVATE GROUP CHAT with the user's REAL
  // agents (Alexis & co.) — a SEPARATE conversation from Codey's center chat, so you can talk things
  // over with your team WITHOUT involving Codey. It reuses ChatPanel pointed at the Team thread. The
  // rail owns its OWN composer buffer (railInput/railDocs) so the two composers never share state.
  const teamChatId = activeSpace?.teamChatId ?? null;
  // Rail reliability backfill (pt 10): hydrate restores a pre-existing Code space VERBATIM and never
  // seeds teamChatId (only openCodeSpace did) — so a user who reopens DIRECTLY into the Code tab would
  // see NO Team rail. Backfill it on mount when the active Code space lacks the pointer. Loop-guarded:
  // ensureCodeTeamThread is a no-op once teamChatId === TEAM_CHAT_ID, and this effect's condition is
  // false on the next render, so it never re-fires.
  useEffect(() => {
    if (activeSpaceId && activeSpace && activeSpace.teamChatId !== TEAM_CHAT_ID) {
      useSpaceStore.getState().ensureCodeTeamThread(activeSpaceId);
    }
  }, [activeSpaceId, activeSpace?.teamChatId]);
  const [teamRailOpen, setTeamRailOpen] = useState(false);
  useEffect(() => { db.get('codeTeamRailOpen', false).then((v: any) => setTeamRailOpen(v === true)).catch(() => {}); }, []);
  const toggleTeamRail = (v: boolean) => { setTeamRailOpen(v); void db.set('codeTeamRailOpen', v); };
  const [railInput, setRailInput] = useState('');
  const [railDocs, setRailDocs] = useState<any[]>([]);
  const railFileInputRef = useRef<HTMLInputElement | null>(null);
  const teamPrimaryName = (teamChatInputBarProps.activeAssistant as any)?.name ?? 'your team';
  const sendTeamMessage = useCallback(() => {
    if (!teamChatId) return;
    if (!railInput.trim() && railDocs.length === 0) return;
    onSendTeamMessage(teamChatId, railInput, railDocs);
    setRailInput('');
    setRailDocs([]);
  }, [teamChatId, railInput, railDocs, onSendTeamMessage]);

  // Rail-local file upload — writes into the rail's OWN attachment buffer (railDocs), not the global
  // useUIStore the center composer uses, so attaching in the rail never touches Codey's composer.
  // Mirrors App.handleChatFileUpload's text/image/PDF handling on a smaller surface.
  const handleRailFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const ui = useSettingsStore.getState();
    if (file.size > 5 * 1024 * 1024) { setToast('File is too large. Max 5MB allowed.'); e.target.value = ''; return; }
    if (file.type === 'application/pdf') {
      try {
        const text = await extractTextFromPDF(file);
        setRailDocs(prev => [...prev, { name: file.name, content: text, type: 'text/plain', isImage: false }]);
      } catch { setToast('Failed to parse PDF.'); }
      e.target.value = ''; return;
    }
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      const sel = ui.models.find(m => m.id === ui.selectedModelId) ?? ui.models[0] ?? null;
      if (!modelSupportsVision(sel) && !hasVisionProvider(ui.appSettings, ui.integrations, ui.models)) {
        setToast("This model can't read images. Turn on Image Understanding, or pick a vision model.");
        e.target.value = ''; return;
      }
      reader.onloadend = () => setRailDocs(prev => [...prev, { name: file.name, content: reader.result, type: file.type, isImage: true }]);
      reader.readAsDataURL(file);
    } else {
      reader.onloadend = () => setRailDocs(prev => [...prev, { name: file.name, content: reader.result, type: file.type, isImage: false }]);
      reader.readAsText(file);
    }
    e.target.value = '';
  }, []);

  const [cwd, setCwd] = useState<string>(() => spaceHome(useSpaceStore.getState().activeSpaceId));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [importRec, setImportRec] = useState<ImportRec | null>(null);

  // ── Preview: a localhost dev server framed in a sandboxed iframe (v1: manual URL, no auto-detect) ──
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000');
  const [previewLive, setPreviewLive] = useState('');
  const [previewKey, setPreviewKey] = useState(0);

  // Frame a URL in the iframe AND lift it into shared state so the preview-observe capability reads
  // the EXACT same URL the human is looking at (docs pt 10). Keeps the human view and Codey's read
  // identical — no guessing localhost:3000.
  const goPreview = useCallback((raw: string) => {
    const url = raw.trim();
    setPreviewLive(url);
    setPreviewKey(k => k + 1);
    useUIStore.getState().setCodePreviewUrl(url || null);
  }, []);

  // "Codey, look at this" — force the preview-observe route and ask Codey to read the running app and
  // fix anything broken (the verify loop). Sends through the normal Codey composer pipeline.
  const observePreview = useCallback(() => {
    if (!previewLive) { setToast('Enter a dev-server URL and hit Go first.'); return; }
    useUIStore.getState().setCodePreviewUrl(previewLive);
    useUIStore.getState().setForcedTool('preview');
    onSendPrompt('Look at the running preview and fix anything broken.');
  }, [previewLive, onSendPrompt]);

  const log = useCallback((action: FileActivityEntry['action'], path: string, ok: boolean, detail?: string) => {
    useSettingsStore.getState().logFileActivity({
      id: `afc-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      action, path, tier: path.startsWith('/') ? 'external' : 'workspace', ok, detail, at: Date.now(),
    });
  }, []);

  const load = useCallback(async () => {
    if (!hasTauri) { setError('The workspace lives on disk — open the desktop app to browse it.'); return; }
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

  // Only fetch the file list while the Files panel is open (the default view is the chat).
  useEffect(() => { if (sidePanel === 'files') void load(); }, [sidePanel, load]);

  // Follow the active space — jump to its home folder when you switch spaces.
  useEffect(() => { setCwd(rootPath); setSelected(null); }, [rootPath]);

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
    setToast(`Linked ${target} — Codey can now work here in place`);
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

  const toggle = (panel: SidePanel) => setSidePanel(prev => (prev === panel ? null : panel));

  const ToggleButton = ({ panel, icon: Icon, label }: { panel: SidePanel; icon: any; label: string }) => (
    <button
      onClick={() => toggle(panel)}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
        sidePanel === panel ? 'bg-accent-soft text-accent border-accent/40' : 'text-ink-2 border-edge-2 hover:bg-wash',
      )}
      title={`Toggle ${label}`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel relative">
      {/* ── Header: project name + gear + Files·Terminal·Preview toggles ── */}
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <FolderGit2 className="w-4 h-4 text-ink-3 shrink-0" />
        <span className="text-sm font-semibold text-ink truncate">{spaceName}</span>
        <div className="flex-1" />

        <ToggleButton panel="files" icon={Files} label="Files" />
        <ToggleButton panel="terminal" icon={TerminalSquare} label="Terminal" />
        <ToggleButton panel="preview" icon={Monitor} label="Preview" />

        {/* ── Codey settings gear (model + Developer Mode + Edit agent) ── */}
        {codeAgent && (
          <div className="relative ml-1">
            <button
              onClick={() => setShowGear(v => !v)}
              className={clsx(
                'flex items-center gap-1 px-2 py-1.5 rounded-lg border transition-colors',
                showGear ? 'bg-accent-soft text-accent border-accent/40' : 'text-ink-2 border-edge-2 hover:bg-wash',
              )}
              title={`${codeAgent.name}'s settings`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              <ChevronDown className={clsx('w-3 h-3 text-ink-3 transition-transform', showGear && 'rotate-180')} />
            </button>

            {showGear && (
              <>
                {/* Outside-click catcher — mirrors the import sheet's overlay/stopPropagation pattern. */}
                <div className="fixed inset-0 z-40" onClick={() => setShowGear(false)} />
                <div
                  className="absolute right-0 top-full mt-2 z-50 w-72 bg-panel-2 rounded-xl border border-edge shadow-2xl p-4 flex flex-col gap-3.5"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-accent shrink-0" />
                    <span className="text-sm font-bold text-ink truncate">{codeAgent.name}</span>
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-ink-3 ml-auto">Code copilot</span>
                  </div>

                  {/* Model — Codey's defaultModelId; applied live if he's the active agent. */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-ink-2">Model</label>
                    <select
                      value={codeAgent.defaultModelId ?? ''}
                      onChange={e => {
                        const nextId = e.target.value;
                        useAgentStore.getState().setAssistants((prev: any[]) =>
                          prev.map((a: any) => a.id === codeAgent.id ? { ...a, defaultModelId: nextId } : a),
                        );
                        void useAgentStore.getState().persist();
                        if (codeAgent.id === activeFolderId && nextId) {
                          useSettingsStore.getState().setSelectedModelId(nextId);
                        }
                      }}
                      className="w-full bg-inset border border-edge rounded-lg px-3 py-2 text-xs font-medium text-ink outline-none focus:border-accent"
                    >
                      <option value="">Use current model</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Developer Mode — global setting surfaced here; gates the Terminal + Codey's commands. */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-semibold text-ink-2">Developer Mode</span>
                      <span className="text-[10px] text-ink-3">Lets Codey run terminal commands.</span>
                    </div>
                    <button
                      onClick={() => useSettingsStore.getState().setAppSettings((prev: any) => ({ ...prev, developerMode: !prev.developerMode }))}
                      className={clsx('w-8 h-4 rounded-full transition-all relative shrink-0', developerMode ? 'bg-accent' : 'bg-edge-2')}
                      role="switch"
                      aria-checked={developerMode}
                    >
                      <div className={clsx('absolute top-0.5 w-3 h-3 rounded-full bg-panel transition-all', developerMode ? 'right-0.5' : 'left-0.5')} />
                    </button>
                  </div>

                  {/* Full editor (tools, prompt) for Codey. */}
                  <button
                    onClick={() => {
                      setShowGear(false);
                      useAgentStore.getState().setEditingAssistant({ ...codeAgent });
                      useAgentStore.getState().setAssistantSettingsTab('config');
                      useAgentStore.getState().setShowAssistantSettings(true);
                    }}
                    className="flex items-center justify-center gap-1.5 mt-0.5 px-3 py-2 rounded-lg text-xs font-semibold text-accent border border-accent/30 hover:bg-accent-soft/40 transition-colors"
                  >
                    Codey&apos;s tools &amp; prompt <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Body: the conversation (default) + an optional side panel ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Codey's conversation — the global ChatPanel, pointed at chat-space-code + Codey. */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          <ChatPanel
            mode="inline"
            spaceLogProps={{ ...spaceLogProps, hideEmptyState: true }}
            chatInputBarProps={chatInputBarProps}
            onSendPrompt={onSendPrompt}
          />

          {/* First-run hero — friendly prompt instead of an empty/confusing thread. Overlaid above the
              composer; pointer-events pass through except on its own controls so the input stays usable. */}
          {isFirstRun && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center px-8 pb-28 pointer-events-none">
              <div className="pointer-events-auto flex flex-col items-center gap-4 max-w-md">
                <div className="w-14 h-14 rounded-2xl bg-accent-soft flex items-center justify-center">
                  <FolderGit2 className="w-7 h-7 text-accent" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-ink">Build with {codeAgent?.name ?? 'Codey'}</h2>
                  <p className="text-sm text-ink-2 mt-1.5 leading-relaxed">
                    Open a folder, or tell me what to build. I can write &amp; edit files, run commands, and research the web while we go.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => { setSidePanel('files'); void bringInFile(); }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity"
                  >
                    <FileInput className="w-3.5 h-3.5" /> Open a folder…
                  </button>
                  {['Scaffold a new project', 'Review my code', 'Fix a failing test'].map(p => (
                    <button
                      key={p}
                      onClick={() => onSendPrompt(p)}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-ink-2 border border-edge-2 hover:bg-wash transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Files panel ── */}
        {sidePanel === 'files' && (
          <div className="w-[440px] xl:w-[520px] shrink-0 border-l border-edge flex flex-col overflow-hidden bg-panel-2">
            <div className="h-10 flex items-center gap-2 px-3 border-b border-edge shrink-0">
              <Files className="w-3.5 h-3.5 text-ink-3" />
              <span className="text-xs font-semibold text-ink">Files</span>
              <div className="flex-1" />
              <button onClick={createFolder} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="New folder"><FolderPlus className="w-3.5 h-3.5" /></button>
              <button onClick={bringInFile} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Bring in a file…"><FileInput className="w-3.5 h-3.5" /></button>
              <button onClick={() => load()} disabled={loading} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors disabled:opacity-40" title="Refresh"><RotateCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} /></button>
              <button onClick={() => setSidePanel(null)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Close"><X className="w-3.5 h-3.5" /></button>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* File list */}
              <div className="w-1/2 shrink-0 border-r border-edge flex flex-col overflow-hidden">
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
                      <p className="text-xs">{query ? 'No files match.' : 'This folder is empty. Ask Codey to create something, or bring in a file.'}</p>
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

              {/* Preview of the selected file */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {selected ? (
                  <>
                    <div className="px-3 py-2 border-b border-edge shrink-0 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-ink-3 shrink-0" />
                      <span className="text-xs font-medium text-ink truncate flex-1">{relativeToSpace(activeSpaceId, selected.path)}</span>
                      <button onClick={() => reveal(absOf(selected.path))} className="p-1 rounded-lg text-ink-3 hover:bg-wash hover:text-ink" title="Reveal in Finder"><ExternalLink className="w-3.5 h-3.5" /></button>
                    </div>
                    {selected.provenance && (
                      <div className="px-3 py-2 border-b border-edge bg-info-soft/30 shrink-0">
                        <div className="flex items-center gap-2 text-[11px] text-ink-2">
                          <Link2 className="w-3.5 h-3.5 text-info shrink-0" />
                          <span className="truncate">Imported copy of <span className="font-mono">{selected.provenance.source}</span> · {relativeTime(new Date(selected.provenance.imported).getTime())}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <button onClick={() => reveal(selected.provenance!.source)} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><ExternalLink className="w-3 h-3" /> Open original</button>
                          <button onClick={reSync} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><RefreshCw className="w-3 h-3" /> Re-sync</button>
                          <button onClick={pushBack} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><CornerUpLeft className="w-3 h-3" /> Push back</button>
                          <button onClick={detach} className="flex items-center gap-1 px-2 py-1 rounded-lg border border-edge-2 text-[11px] font-semibold text-ink-2 hover:bg-wash"><Unlink className="w-3 h-3" /> Detach</button>
                        </div>
                      </div>
                    )}
                    <pre className="flex-1 overflow-auto text-[12px] font-mono leading-relaxed text-ink-2 whitespace-pre-wrap px-3 py-2.5">{selected.content || '(empty file)'}</pre>
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-2 text-ink-3 text-center px-6">
                    <FileText className="w-8 h-8" />
                    <p className="text-xs max-w-[200px]">Select a file to preview it. This is the same workspace Codey reads and writes — changes stay in sync, git-versioned and undoable.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Terminal panel (Developer-Mode gated) ── */}
        {sidePanel === 'terminal' && (
          <div className="w-[460px] xl:w-[560px] shrink-0 border-l border-edge flex flex-col overflow-hidden bg-panel">
            <div className="h-10 flex items-center gap-2 px-3 border-b border-edge shrink-0">
              <TerminalSquare className="w-3.5 h-3.5 text-ink-3" />
              <span className="text-xs font-semibold text-ink">Terminal</span>
              <div className="flex-1" />
              <button onClick={() => setSidePanel(null)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Close"><X className="w-3.5 h-3.5" /></button>
            </div>
            {developerMode ? (
              // rootPath is a jail-RELATIVE space home (spaces/<id>), so this joins to an absolute path.
              <TerminalPane cwd={rootPath ? `${workspaceRoot}/${rootPath}` : workspaceRoot} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8 bg-panel">
                <TerminalSquare className="w-9 h-9 text-ink-3" />
                <p className="text-sm text-ink max-w-xs">Developer Mode lets Codey and you run a terminal here.</p>
                <p className="text-xs text-ink-3 max-w-xs leading-relaxed">It opens a real shell in this project's workspace folder. Off by default — turn it on when you want to run commands.</p>
                <button
                  onClick={() => useSettingsStore.getState().setAppSettings((prev: any) => ({ ...prev, developerMode: true }))}
                  className="mt-1 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity"
                >
                  <TerminalSquare className="w-3.5 h-3.5" /> Enable Developer Mode
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Preview panel (frame a localhost dev server) ── */}
        {sidePanel === 'preview' && (
          <div className="w-[480px] xl:w-[620px] shrink-0 border-l border-edge flex flex-col overflow-hidden bg-panel">
            <div className="h-10 flex items-center gap-2 px-3 border-b border-edge shrink-0">
              <Monitor className="w-3.5 h-3.5 text-ink-3 shrink-0" />
              <form
                className="flex-1 flex items-center gap-1.5"
                onSubmit={e => { e.preventDefault(); goPreview(previewUrl); }}
              >
                <input
                  value={previewUrl}
                  onChange={e => setPreviewUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-inset border border-edge rounded-lg px-2.5 py-1 text-[11px] font-mono text-ink outline-none focus:border-accent"
                />
                <button type="submit" className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity">Go</button>
              </form>
              {previewLive && (
                <>
                  {/* "Codey, look at this" — Codey reads the running app at this URL and self-corrects
                      (the verify loop). Forces the preview-observe capability. See docs pt 10. */}
                  <button onClick={observePreview} className="p-1.5 rounded-lg text-accent hover:bg-accent-soft transition-colors" title="Ask Codey to look at the running preview and fix anything broken"><Eye className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setPreviewKey(k => k + 1)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Reload"><RotateCw className="w-3.5 h-3.5" /></button>
                </>
              )}
              <button onClick={() => setSidePanel(null)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Close"><X className="w-3.5 h-3.5" /></button>
            </div>
            {previewLive ? (
              <iframe
                key={previewKey}
                src={previewLive}
                title="Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                className="flex-1 w-full bg-white border-0"
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-3 text-center px-8">
                <Monitor className="w-9 h-9" />
                <p className="text-sm text-ink max-w-xs">Preview a running app.</p>
                <p className="text-xs text-ink-3 max-w-xs leading-relaxed">Start your dev server (e.g. via the Terminal), then enter its URL above and hit Go. Some servers block being framed — if it stays blank, that's their CSP.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Team rail: a PRIVATE GROUP CHAT with your REAL agents (NOT Codey) ──
            A SEPARATE conversation from Codey's center chat — talk things over with your team without
            involving Codey. Reuses ChatPanel pointed at the Team thread, with the rail's OWN composer
            buffer. Context-aware for free (the rail send reads the active Code space's ambient/project
            context). Collapsible; the heavy ChatPanel only mounts when expanded. See docs pt 9. */}
        {teamChatId && (
          teamRailOpen ? (
            <div className="w-[360px] xl:w-[420px] shrink-0 border-l border-edge flex flex-col overflow-hidden bg-panel">
              <div className="h-10 flex items-center gap-2 px-3 border-b border-edge shrink-0">
                <Users className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-xs font-semibold text-ink">Team</span>
                <span className="text-[10px] text-ink-3 truncate">private group chat</span>
                <div className="flex-1" />
                <button onClick={() => toggleTeamRail(false)} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Collapse team chat"><PanelRightClose className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChatPanel
                  mode="inline"
                  hideHeader
                  spaceLogProps={{ ...teamSpaceLogProps, hideEmptyState: true }}
                  chatInputBarProps={{
                    ...teamChatInputBarProps,
                    // The rail composer runs its OWN buffer (not the global UI store) so it never
                    // shares/corrupts the center (Codey) composer's text or attachments — including
                    // its own file input + upload handler.
                    onSend: sendTeamMessage,
                    inputValue: railInput,
                    onInputChange: setRailInput,
                    attachedDocsOverride: railDocs,
                    onAttachedDocsChange: (fn: (prev: any[]) => any[]) => setRailDocs(fn),
                    onChatFileUpload: handleRailFileUpload,
                    fileInputRef: railFileInputRef,
                  }}
                  onSendPrompt={(text: string) => { if (teamChatId) onSendTeamMessage(teamChatId, text, []); }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={() => toggleTeamRail(true)}
              className="shrink-0 w-9 flex flex-col items-center pt-3 gap-1 border-l border-edge bg-panel text-ink-3 hover:text-ink hover:bg-wash transition-colors"
              title={`Talk to ${teamPrimaryName} & your team — a private group chat, separate from Codey`}
            >
              <Users className="w-4 h-4" />
            </button>
          )
        )}
      </div>

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
