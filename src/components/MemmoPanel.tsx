import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Pin, PinOff, FileText, Pencil, FolderOpen, ChevronDown, ChevronRight, Trash2, RotateCcw, Archive } from 'lucide-react';
import { KnowledgeDropZone } from './KnowledgeDropZone';

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

type Tab = 'pins' | 'memos' | 'library' | 'archive';

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

export function MemmoPanel({ isOpen, onClose, pinnedMessages, onUnpin, onCompose, agentForgePath, agentId, onToast, initialTab, onDeleteFile, pinnedTokenEstimate, onRestoreArchive }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'pins');
  const [memos, setMemos] = useState<FileEntry[]>([]);
  const [library, setLibrary] = useState<FileEntry[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<ArchiveEntry[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialTab) setTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen && agentForgePath) {
      if (tab === 'memos') loadMemos();
      if (tab === 'library') loadLibrary();
      if (tab === 'archive') loadArchive();
    }
  }, [isOpen, tab, agentForgePath, agentId]);

  async function loadMemos() {
    setLoadingFiles(true);
    try {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const files: FileEntry[] = [];

      async function collect(dirPath: string) {
        const entries = await readDir(dirPath);
        for (const e of entries) {
          if (e.isFile && e.name?.endsWith('.md') && e.name !== 'tasks.md') {
            files.push({ name: e.name.replace('.md', ''), path: `${dirPath}/${e.name}` });
          } else if (e.isDirectory && e.name !== '.archive') {
            await collect(`${dirPath}/${e.name}`);
          }
        }
      }

      await collect(`${agentForgePath}/memory/${agentId}`);
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
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(`${agentForgePath}/library`);
      const files: FileEntry[] = entries
        .filter(e => e.isFile && e.name?.endsWith('.md'))
        .map(e => ({ name: e.name!.replace('.md', ''), path: `${agentForgePath}/library/${e.name}` }));
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
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const raw = await readTextFile(path);
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
    { id: 'pins',    label: 'Pins',    count: pinnedMessages.length },
    { id: 'memos',   label: 'Memos'   },
    { id: 'library', label: 'Library' },
    { id: 'archive', label: 'Archive', count: archiveFiles.length || undefined },
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
      <div className={`fixed top-0 right-0 h-full w-80 z-50 bg-white dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#899AB5]">
              Memos & Memory
            </span>
            <p className="text-[9px] text-neutral-400 mt-0.5">Notes saved to ~/AgentForge/ · searchable via Knowledge Search</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                tab === t.id
                  ? 'border-b-2 border-[#4A5D75] text-[#4A5D75] dark:text-[#899AB5]'
                  : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#D4AA7D] text-white text-[9px] font-black">
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
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 mb-2 bg-[#D4AA7D]/10 dark:bg-[#D4AA7D]/5 border border-[#D4AA7D]/30 rounded-xl">
                <span className="text-[10px]">📌</span>
                <span className="text-[10px] font-bold text-[#9C7A3C] dark:text-[#D4AA7D]">Always in context — injected into every message</span>
              </div>
              {pinnedTokenEstimate !== undefined && pinnedTokenEstimate > 1500 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 mb-2 bg-[#C98A8A]/10 border border-[#C98A8A]/30 rounded-xl">
                  <span className="text-[10px]">⚠️</span>
                  <span className="text-[10px] font-bold text-[#C98A8A]">Context Bloat — ~{pinnedTokenEstimate.toLocaleString()} tokens pinned. Unpin some to reduce RAM pressure.</span>
                </div>
              )}
              {pinnedMessages.length === 0 ? (
                <div className="text-center py-12 text-neutral-400">
                  <Pin className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="text-xs">No pinned messages yet.</p>
                  <p className="text-xs mt-1 opacity-70">Pin any message to save it here.</p>
                </div>
              ) : (
                pinnedMessages.map(p => (
                  <div
                    key={p.msgId}
                    className="flex items-start gap-2 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
                  >
                    <Pin className="w-3.5 h-3.5 text-[#D4AA7D] shrink-0 mt-0.5" />
                    <p className="flex-1 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed line-clamp-4">
                      {p.content}
                    </p>
                    <button
                      onClick={() => onUnpin(p.chatId, p.msgId)}
                      className="text-neutral-300 hover:text-red-400 transition-colors shrink-0"
                      title="Unpin"
                    >
                      <PinOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Memos tab ── */}
          {tab === 'memos' && (
            <div className="p-4 space-y-2">
              <div className="flex flex-col gap-0.5 px-2.5 py-1.5 mb-2 bg-[#4A5D75]/8 dark:bg-[#4A5D75]/10 border border-[#4A5D75]/20 rounded-xl">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px]">🔍</span>
                  <span className="text-[10px] font-bold text-[#4A5D75] dark:text-[#899AB5]">Searched when relevant — retrieved by Knowledge Search</span>
                </div>
                <p className="text-[9px] text-neutral-400 pl-4">Deleting a memo removes it permanently from disk and from your agent's memory.</p>
              </div>
              <button
                onClick={onCompose}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 text-xs font-bold text-neutral-500 dark:text-neutral-400 hover:border-[#4A5D75] hover:text-[#4A5D75] transition-all mb-4"
              >
                <Pencil className="w-3.5 h-3.5" />
                New Memmo
              </button>

              {loadingFiles ? (
                <div className="text-center py-8 text-neutral-400 text-xs">Loading...</div>
              ) : memos.length === 0 ? (
                <div className="text-center py-8 text-neutral-400 space-y-2">
                  <FileText className="w-8 h-8 mx-auto opacity-30" />
                  <p className="text-xs font-bold">No memos yet.</p>
                  <p className="text-[10px] leading-relaxed opacity-80 px-2">
                    Memos are markdown notes saved to your Knowledge Core (<code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded">~/AgentForge/memory/</code>). Your agent can search them when Knowledge Search is enabled.
                  </p>
                  <p className="text-[10px] opacity-60">Use ⌘⇧M or type /memo in chat to write one.</p>
                </div>
              ) : (
                memos.map(f => (
                  <div key={f.path} className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleFile(f.path)}
                        className="flex-1 flex items-center gap-2 p-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors min-w-0"
                      >
                        {expandedFile === f.path
                          ? <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        }
                        <span className="flex-1 text-xs font-bold text-neutral-700 dark:text-neutral-300 truncate">
                          {f.name}
                        </span>
                      </button>
                      {onDeleteFile && (
                        pendingDelete === f.path ? (
                          <div className="flex items-center gap-1 mr-2 shrink-0">
                            <span className="text-[10px] font-bold text-red-400">Delete?</span>
                            <button
                              onClick={async () => {
                                setPendingDelete(null);
                                setMemos(prev => prev.filter(m => m.path !== f.path));
                                try { await onDeleteFile(f.path); } catch { loadMemos(); }
                              }}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                            >Yes</button>
                            <button
                              onClick={() => setPendingDelete(null)}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
                            >No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingDelete(f.path)}
                            className="p-2 mr-2 text-neutral-300 hover:text-red-400 transition-colors shrink-0"
                            title="Delete memo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                    {expandedFile === f.path && (
                      <div className="px-4 pb-3 pt-0">
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap font-mono">
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
              <div className="flex flex-col gap-0.5 px-2.5 py-1.5 bg-[#4A5D75]/8 dark:bg-[#4A5D75]/10 border border-[#4A5D75]/20 rounded-xl">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px]">🔍</span>
                  <span className="text-[10px] font-bold text-[#4A5D75] dark:text-[#899AB5]">Searched when relevant — shared across all agents</span>
                </div>
                <p className="text-[9px] text-neutral-400 pl-4">Deleting a file removes it permanently from disk and from all agents' memory.</p>
              </div>
              <KnowledgeDropZone
                agentForgePath={agentForgePath}
                onFileIngested={() => loadLibrary()}
                onError={msg => onToast(msg)}
              />

              {loadingFiles ? (
                <div className="text-center py-8 text-neutral-400 text-xs">Loading...</div>
              ) : library.length === 0 ? (
                <div className="text-center py-8 text-neutral-400">
                  <FolderOpen className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="text-xs">Library is empty.</p>
                  <p className="text-xs mt-1 opacity-70">Drop files above to ingest them.</p>
                </div>
              ) : (
                library.map(f => (
                  <div key={f.path} className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleFile(f.path)}
                        className="flex-1 flex items-center gap-2 p-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors min-w-0"
                      >
                        {expandedFile === f.path
                          ? <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        }
                        <FileText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        <span className="flex-1 text-xs font-bold text-neutral-700 dark:text-neutral-300 truncate">
                          {f.name}
                        </span>
                      </button>
                      {onDeleteFile && (
                        pendingDelete === f.path ? (
                          <div className="flex items-center gap-1 mr-2 shrink-0">
                            <span className="text-[10px] font-bold text-red-400">Delete?</span>
                            <button
                              onClick={async () => {
                                setPendingDelete(null);
                                setLibrary(prev => prev.filter(l => l.path !== f.path));
                                try { await onDeleteFile(f.path); } catch { loadLibrary(); }
                              }}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                            >Yes</button>
                            <button
                              onClick={() => setPendingDelete(null)}
                              className="px-2 py-0.5 text-[10px] font-black rounded-md bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
                            >No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingDelete(f.path)}
                            className="p-2 mr-2 text-neutral-300 hover:text-red-400 transition-colors shrink-0"
                            title="Delete file"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                    {expandedFile === f.path && (
                      <div className="px-4 pb-3 pt-0">
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap font-mono">
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

          {/* ── Archive tab ── */}
          {tab === 'archive' && (
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 mb-2 bg-[#C98A8A]/10 border border-[#C98A8A]/30 rounded-xl">
                <span className="text-[10px]">🗂️</span>
                <span className="text-[10px] font-bold text-[#C98A8A]">
                  Soft-deleted by Dream Cycle — purged after 7 days
                </span>
              </div>

              {loadingFiles ? (
                <div className="text-center py-8 text-neutral-400 text-xs">Loading...</div>
              ) : archiveFiles.length === 0 ? (
                <div className="text-center py-12 text-neutral-400">
                  <Archive className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="text-xs">Archive is empty.</p>
                  <p className="text-xs mt-1 opacity-70">Files archived by Dream Cycle appear here.</p>
                </div>
              ) : (
                archiveFiles.map(f => (
                  <div key={f.path} className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleFile(f.path)}
                        className="flex-1 flex items-center gap-2 p-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors min-w-0"
                      >
                        {expandedFile === f.path
                          ? <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        }
                        <span className="flex-1 text-xs font-bold text-neutral-500 dark:text-neutral-400 truncate">
                          {f.name}
                        </span>
                        <span className="text-[9px] text-neutral-400 shrink-0 ml-1">
                          {formatAge(f.modified_secs)}
                        </span>
                      </button>
                      {onRestoreArchive && (
                        <button
                          onClick={() => handleRestoreArchive(f.path)}
                          disabled={restoringPath === f.path}
                          className="p-2 mr-2 text-neutral-300 hover:text-emerald-500 transition-colors shrink-0 disabled:opacity-50"
                          title="Restore file"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${restoringPath === f.path ? 'animate-spin' : ''}`} />
                        </button>
                      )}
                    </div>
                    {expandedFile === f.path && (
                      <div className="px-4 pb-3 pt-0">
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap font-mono">
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
        </div>
      </div>
    </>
  );
}
