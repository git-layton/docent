import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Pin, PinOff, FileText, Pencil, ChevronDown, ChevronRight, Trash2, RotateCcw, Archive, Bookmark, Globe } from 'lucide-react';
import { KnowledgeDropZone } from './KnowledgeDropZone';
import { useBrowserStore } from '../store/useBrowserStore';
import { fetchMemoryLedger, describeFiles, type LedgerDay } from '../services/memoryLedger';

interface PinnedMessage {
  chatId: string;
  msgId: string;
  content: string;
}

interface ArchiveEntry {
  name: string;
  path: string;
  modified_secs: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  pinnedMessages: PinnedMessage[];
  onUnpin: (chatId: string, msgId: string) => void;
  onCompose: () => void;
  agentForgePath: string;
  agentId: string;
  onToast: (msg: string) => void;
  initialTab?: Tab;
  onDeleteFile?: (path: string) => Promise<void>;
  pinnedTokenEstimate?: number;
  onRestoreArchive?: (archivePath: string) => Promise<void>;
}

type Tab = 'pins' | 'notes' | 'library' | 'archive' | 'weblog' | 'ledger';

/** Friendly day header for the memory ledger. */
function ledgerDayLabel(isoDate: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${isoDate}T00:00:00`);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface FileEntry {
  name: string;
  path: string;
}

function formatAge(modifiedSecs: number): string {
  const diffSecs = Math.floor(Date.now() / 1000) - modifiedSecs;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  const days = Math.floor(diffSecs / 86400);
  return `${days}d ago`;
}

function timeAgo(ts: number): string {
  const diffSecs = Math.floor((Date.now() - ts) / 1000);
  if (diffSecs < 60) return 'Just now';
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)} minutes ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)} hours ago`;
  if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)} days ago`;
  return new Date(ts).toLocaleDateString();
}


export function MemmoPanel({ isOpen, onClose, pinnedMessages, onUnpin, onCompose, agentForgePath, agentId, onToast, initialTab, onDeleteFile, pinnedTokenEstimate, onRestoreArchive }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'library');
  const [memos, setMemos] = useState<FileEntry[]>([]);
  const [library, setLibrary] = useState<FileEntry[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<ArchiveEntry[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  const visitLog = useBrowserStore(s => s.visitLog);
  const clearVisitLog = useBrowserStore(s => s.clearVisitLog);
  const [ledgerDays, setLedgerDays] = useState<LedgerDay[]>([]);

  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen && agentForgePath) {
      if (tab === 'notes') loadMemos();
      if (tab === 'library') loadLibrary();
      if (tab === 'archive') loadArchive();
      if (tab === 'ledger') fetchMemoryLedger(60).then(setLedgerDays).catch(() => setLedgerDays([]));
    }
  }, [isOpen, tab, agentForgePath, agentId]);

  async function loadMemos() {
    setLoadingFiles(true);
    try {
      const result = await invoke<{ files: FileEntry[]; error?: string }>('list_agent_memory_files', { agentId });
      if (result.error) throw new Error(result.error);
      const files = result.files ?? [];
      setMemos(files.sort((a, b) => b.name.localeCompare(a.name)));
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (!msg.toLowerCase().includes('no such file') && !msg.includes('os error 2')) {
        onToast(`Could not load memos: ${msg}`);
      }
    } finally {
      setLoadingFiles(false);
    }
  }

  async function loadLibrary() {
    setLoadingFiles(true);
    try {
      const result = await invoke<{ files: FileEntry[]; error?: string }>('list_library_files');
      if (result.error) throw new Error(result.error);
      const files = result.files ?? [];
      setLibrary(files.sort((a, b) => b.name.localeCompare(a.name)));
    } catch (e: any) {
      const msg: string = e?.message ?? String(e);
      if (!msg.toLowerCase().includes('no such file') && !msg.includes('os error 2')) {
        onToast(`Could not load library: ${msg}`);
      }
    } finally {
      setLoadingFiles(false);
    }
  }

  async function loadArchive() {
    setLoadingFiles(true);
    try {
      const result = await invoke<{ files: ArchiveEntry[] }>('list_archive_files');
      setArchiveFiles(result.files ?? []);
    } catch (e: any) {
      onToast(`Could not load archive: ${e?.message ?? String(e)}`);
    } finally {
      setLoadingFiles(false);
    }
  }

  async function toggleFile(path: string) {
    if (expandedFile === path) { setExpandedFile(null); return; }
    setExpandedFile(path);
    if (fileContent[path]) return;
    try {
      const result = await invoke<{ ok: boolean; content: string; error?: string }>('read_knowledge_file', { path });
      if (!result.ok) throw new Error(result.error ?? 'Could not read file');
      const raw = result.content;
      // Strip YAML frontmatter for display
      const stripped = raw.replace(/^---[\s\S]*?---\n?/, '').trim();
      setFileContent(prev => ({ ...prev, [path]: stripped }));
    } catch {
      setFileContent(prev => ({ ...prev, [path]: '(could not read file)' }));
    }
  }

  function previewText(content: string): string {
    return content.slice(0, 100).replace(/\n/g, ' ').trim() + (content.length > 100 ? '…' : '');
  }

  async function handleRestoreArchive(archivePath: string) {
    if (!onRestoreArchive) return;
    setRestoringPath(archivePath);
    try {
      await onRestoreArchive(archivePath);
      setArchiveFiles(prev => prev.filter(f => f.path !== archivePath));
      onToast('File restored from archive.');
    } catch (e: any) {
      onToast(`Restore failed: ${e?.message ?? String(e)}`);
    } finally {
      setRestoringPath(null);
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'library', label: 'Library' },
    { id: 'pins',    label: 'Context', count: pinnedMessages.length },
    { id: 'notes',   label: 'Notes'   },
    { id: 'archive', label: 'Archive', count: archiveFiles.length || undefined },
    { id: 'weblog',  label: 'Web',     count: visitLog.length || undefined },
    { id: 'ledger',  label: 'Ledger'  },
  ];

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div className={`fixed top-0 right-0 h-full w-80 z-50 bg-panel-2 border-l border-edge shadow-2xl flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-accent">
              Your Library
            </span>
            <p className="text-[9px] text-ink-3 mt-0.5">Saved to ~/AgentForge/ · searched by your agents</p>
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-edge shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                tab === t.id
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-accent text-on-accent text-[9px] font-black">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* ── Pins tab ── */}
          {tab === 'pins' && (
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 mb-2 bg-warning-soft/60 border border-warning/30 rounded-xl">
                <span className="text-[10px]">📌</span>
                <span className="text-[10px] font-bold text-warning">Active Context — injected into every message you send</span>
              </div>
              {pinnedTokenEstimate !== undefined && pinnedTokenEstimate > 1500 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 mb-2 bg-danger-soft/60 border border-danger/30 rounded-xl">
                  <span className="text-[10px]">⚠️</span>
                  <span className="text-[10px] font-bold text-danger">Context Bloat — ~{pinnedTokenEstimate.toLocaleString()} tokens pinned. Unpin some to reduce RAM pressure.</span>
                </div>
              )}
              {pinnedMessages.length === 0 ? (
                <div className="text-center py-12 text-ink-3">
                  <Pin className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="text-xs">No pinned messages yet.</p>
                  <p className="text-xs mt-1 opacity-70">Pin any message to save it here.</p>
                </div>
              ) : (
                pinnedMessages.map(p => (
                  <div
                    key={p.msgId}
                    className="flex items-start gap-2 p-3 rounded-xl bg-inset border border-edge"
                  >
                    <Pin className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                    <p className="flex-1 text-xs text-ink-2 leading-relaxed line-clamp-4">
                      {p.content}
                    </p>
                    <button
                      onClick={() => onUnpin(p.chatId, p.msgId)}
                      className="text-ink-3 hover:text-danger transition-colors shrink-0"
                      title="Unpin"
                    >
                      <PinOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Notes tab ── */}
          {tab === 'notes' && (
            <div className="p-4 space-y-2">
              <div className="flex flex-col gap-0.5 px-2.5 py-1.5 mb-2 bg-accent-soft/40 border border-accent/20 rounded-xl">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px]">🔍</span>
                  <span className="text-[10px] font-bold text-accent">Searched when relevant — retrieved by Knowledge Search</span>
                </div>
                <p className="text-[9px] text-ink-3 pl-4">Deleting a memo removes it permanently from disk and from your agent's memory.</p>
              </div>
              <button
                onClick={onCompose}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-edge-2 text-xs font-bold text-ink-2 hover:border-accent hover:text-accent transition-all mb-4"
              >
                <Pencil className="w-3.5 h-3.5" />
                New Note
              </button>

              {loadingFiles ? (
                <div className="text-center py-8 text-ink-3 text-xs">Loading...</div>
              ) : memos.length === 0 ? (
                <div className="text-center py-8 text-ink-3 space-y-2">
                  <FileText className="w-8 h-8 mx-auto opacity-30" />
                  <p className="text-xs font-bold">No notes yet.</p>
                  <p className="text-[10px] leading-relaxed opacity-80 px-2">
                    Notes are markdown files saved to your Knowledge Core (<code className="bg-inset px-1 rounded">~/AgentForge/memory/</code>). Your agent can search them when Knowledge Search is enabled.
                  </p>
                  <p className="text-[10px] opacity-60">Use ⌘⇧M or type /memo in chat to write one.</p>
                </div>
              ) : (
                memos.map(f => (
                  <div key={f.path} className="rounded-xl border border-edge overflow-hidden">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleFile(f.path)}
                        className="flex-1 flex items-center gap-2 p-3 text-left hover:bg-wash transition-colors min-w-0"
                      >
                        {expandedFile === f.path
                          ? <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                        }
                        <span className="flex-1 text-xs font-bold text-ink-2 truncate">
                          {f.name}
                        </span>
                      </button>
                      {onDeleteFile && (
                        pendingDelete === f.path ? (
                          <div className="flex items-center gap-1 mr-2 shrink-0">
                            <span className="text-[10px] font-bold text-danger">Delete?</span>
                            <button
                              onClick={async () => {
                                setPendingDelete(null);
                                setMemos(prev => prev.filter(m => m.path !== f.path));
                                try { await onDeleteFile(f.path); } catch { loadMemos(); }
                              }}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-danger text-danger-soft hover:opacity-90 transition-colors"
                            >Yes</button>
                            <button
                              onClick={() => setPendingDelete(null)}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-inset text-ink-2 hover:bg-wash transition-colors"
                            >No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingDelete(f.path)}
                            className="p-2 mr-2 text-ink-3 hover:text-danger transition-colors shrink-0"
                            title="Delete memo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                    {expandedFile === f.path && (
                      <div className="px-4 pb-3 pt-0">
                        <p className="text-xs text-ink-2 leading-relaxed whitespace-pre-wrap font-mono">
                          {fileContent[f.path]
                            ? previewText(fileContent[f.path])
                            : 'Loading...'}
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Library tab ── */}
          {tab === 'library' && (
            <div className="p-4 space-y-3">
              <button
                onClick={onCompose}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-edge-2 text-xs font-bold text-ink-2 hover:border-accent hover:text-accent transition-all mb-1"
              >
                <Pencil className="w-3.5 h-3.5" />
                New Note
              </button>
              <KnowledgeDropZone
                agentForgePath={agentForgePath}
                onFileIngested={() => loadLibrary()}
                onError={msg => onToast(msg)}
              />

              {loadingFiles ? (
                <div className="text-center py-8 text-ink-3 text-xs">Loading...</div>
              ) : library.length === 0 ? (
                <div className="text-center py-12 text-ink-3 space-y-3">
                  <Bookmark className="w-10 h-10 mx-auto opacity-20" />
                  <p className="text-xs font-bold">Your Library is empty.</p>
                  <p className="text-[10px] leading-relaxed opacity-80 px-4">
                    Click the <span className="font-black">🔖</span> Bookmark icon on any chat message to save it here for permanent context.
                  </p>
                  <p className="text-[10px] opacity-60">Or drop files above · Or write a New Note.</p>
                </div>
              ) : (
                library.map(f => (
                  <div key={f.path} className="rounded-xl border border-edge overflow-hidden">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleFile(f.path)}
                        className="flex-1 flex items-center gap-2 p-3 text-left hover:bg-wash transition-colors min-w-0"
                      >
                        {expandedFile === f.path
                          ? <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                        }
                        <FileText className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                        <span className="flex-1 text-xs font-bold text-ink-2 truncate">
                          {f.name}
                        </span>
                      </button>
                      {onDeleteFile && (
                        pendingDelete === f.path ? (
                          <div className="flex items-center gap-1 mr-2 shrink-0">
                            <span className="text-[10px] font-bold text-danger">Delete?</span>
                            <button
                              onClick={async () => {
                                setPendingDelete(null);
                                setLibrary(prev => prev.filter(l => l.path !== f.path));
                                try { await onDeleteFile(f.path); } catch { loadLibrary(); }
                              }}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-danger text-danger-soft hover:opacity-90 transition-colors"
                            >Yes</button>
                            <button
                              onClick={() => setPendingDelete(null)}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-inset text-ink-2 hover:bg-wash transition-colors"
                            >No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingDelete(f.path)}
                            className="p-2 mr-2 text-ink-3 hover:text-danger transition-colors shrink-0"
                            title="Delete file"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                    {expandedFile === f.path && (
                      <div className="px-4 pb-3 pt-0">
                        <p className="text-xs text-ink-2 leading-relaxed whitespace-pre-wrap font-mono">
                          {fileContent[f.path]
                            ? previewText(fileContent[f.path])
                            : 'Loading...'}
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Web Log tab ── */}
          {tab === 'weblog' && (
            <div className="p-4 space-y-2">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-black text-ink-2">Web Log</span>
                  {visitLog.length > 0 && (
                    <span className="flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-accent text-on-accent text-[9px] font-black">
                      {visitLog.length}
                    </span>
                  )}
                </div>
              </div>

              {visitLog.length === 0 ? (
                /* Browser store active but no entries */
                <div className="text-center py-12 text-ink-3 space-y-3">
                  <Globe className="w-10 h-10 mx-auto opacity-20" />
                  <p className="text-xs font-bold">No pages visited yet.</p>
                  <p className="text-[10px] opacity-60">Open the browser to start logging visits.</p>
                </div>
              ) : (
                /* Entry list — newest first */
                [...visitLog].reverse().map(entry => {
                  let domain = '';
                  try { domain = new URL(entry.url).hostname; } catch { domain = ''; }
                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2.5 p-3 rounded-xl bg-inset border border-edge"
                    >
                      {/* Favicon */}
                      <div className="shrink-0 w-4 h-4 mt-0.5">
                        {domain ? (
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                            alt=""
                            className="w-4 h-4 rounded-sm"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <Globe className="w-4 h-4 text-ink-3" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-xs font-bold text-ink-2 truncate leading-tight">
                          {entry.title || domain || entry.url}
                        </p>
                        <p className="text-[10px] text-ink-3 truncate leading-tight">
                          {entry.url}
                        </p>
                        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                          <span className="text-[9px] text-ink-3">{timeAgo(entry.timestamp)}</span>
                          {entry.wasDigested && (
                            <span className="px-1.5 py-0.5 rounded-full bg-success-soft text-success text-[9px] font-black">
                              Digest saved
                            </span>
                          )}
                          {entry.isPrivate && (
                            <span className="px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 text-[9px] font-black">
                              Private
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Clear history button */}
              <div className="pt-2">
                <button
                  onClick={clearVisitLog}
                  disabled={visitLog.length === 0}
                  className="w-full py-1.5 text-[10px] font-bold text-ink-3 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-edge rounded-xl hover:border-danger/40 disabled:hover:border-edge disabled:hover:text-ink-3"
                >
                  Clear history
                </button>
              </div>
            </div>
          )}

          {/* ── Archive tab ── */}
          {tab === 'archive' && (
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 mb-2 bg-danger-soft/60 border border-danger/30 rounded-xl">
                <span className="text-[10px]">🗂️</span>
                <span className="text-[10px] font-bold text-danger">
                  Soft-deleted by Dream Cycle — purged after 7 days
                </span>
              </div>

              {loadingFiles ? (
                <div className="text-center py-8 text-ink-3 text-xs">Loading...</div>
              ) : archiveFiles.length === 0 ? (
                <div className="text-center py-12 text-ink-3">
                  <Archive className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="text-xs">Archive is empty.</p>
                  <p className="text-xs mt-1 opacity-70">Files archived by Dream Cycle appear here.</p>
                </div>
              ) : (
                archiveFiles.map(f => (
                  <div key={f.path} className="rounded-xl border border-edge overflow-hidden">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleFile(f.path)}
                        className="flex-1 flex items-center gap-2 p-3 text-left hover:bg-wash transition-colors min-w-0"
                      >
                        {expandedFile === f.path
                          ? <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                        }
                        <span className="flex-1 text-xs font-bold text-ink-2 truncate">
                          {f.name}
                        </span>
                        <span className="text-[9px] text-ink-3 shrink-0 ml-1">
                          {formatAge(f.modified_secs)}
                        </span>
                      </button>
                      {onRestoreArchive && (
                        <button
                          onClick={() => handleRestoreArchive(f.path)}
                          disabled={restoringPath === f.path}
                          className="p-2 mr-2 text-ink-3 hover:text-success transition-colors shrink-0 disabled:opacity-50"
                          title="Restore file"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${restoringPath === f.path ? 'animate-spin' : ''}`} />
                        </button>
                      )}
                    </div>
                    {expandedFile === f.path && (
                      <div className="px-4 pb-3 pt-0">
                        <p className="text-xs text-ink-2 leading-relaxed whitespace-pre-wrap font-mono">
                          {fileContent[f.path]
                            ? previewText(fileContent[f.path])
                            : 'Loading...'}
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Memory ledger — the Knowledge Core's git history as a human story. Read-only:
              this is "audit what it learned", the moat rendered visible. */}
          {tab === 'ledger' && (
            <div className="flex flex-col">
              {ledgerDays.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-xs text-ink-3 leading-relaxed">
                    No memory history yet. As agents learn things, every change lands here as a
                    git commit you can audit.
                  </p>
                </div>
              ) : (
                ledgerDays.map(day => (
                  <div key={day.date}>
                    <div className="px-5 pt-4 pb-1.5 text-[10px] font-black uppercase tracking-widest text-ink-3">
                      {ledgerDayLabel(day.date)}
                    </div>
                    {day.entries.map(e => (
                      <div key={e.hash} className="px-5 py-2.5 border-b border-edge">
                        <p className="text-xs font-bold text-ink-2 leading-snug break-words">{e.subject || '(no message)'}</p>
                        <p className="text-[10px] text-ink-3 mt-0.5">
                          {describeFiles(e.files)}{e.files.length > 0 ? ' · ' : ''}
                          <span className="font-mono">{e.hash}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
