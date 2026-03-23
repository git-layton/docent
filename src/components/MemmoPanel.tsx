import { useState, useEffect } from 'react';
import { X, Pin, PinOff, FileText, Pencil, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { KnowledgeDropZone } from './KnowledgeDropZone';

interface PinnedMessage {
  chatId: string;
  msgId: string;
  content: string;
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
}

type Tab = 'pins' | 'memos' | 'library';

interface FileEntry {
  name: string;
  path: string;
}

export function MemmoPanel({ isOpen, onClose, pinnedMessages, onUnpin, onCompose, agentForgePath, agentId, onToast }: Props) {
  const [tab, setTab] = useState<Tab>('pins');
  const [memos, setMemos] = useState<FileEntry[]>([]);
  const [library, setLibrary] = useState<FileEntry[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    if (isOpen && agentForgePath) {
      if (tab === 'memos') loadMemos();
      if (tab === 'library') loadLibrary();
    }
  }, [isOpen, tab, agentForgePath]);

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
          } else if (e.isDirectory) {
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

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'pins',    label: 'Pins',    count: pinnedMessages.length },
    { id: 'memos',   label: 'Memos'   },
    { id: 'library', label: 'Library' },
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
                    <button
                      onClick={() => toggleFile(f.path)}
                      className="w-full flex items-center gap-2 p-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                    >
                      {expandedFile === f.path
                        ? <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      }
                      <span className="flex-1 text-xs font-bold text-neutral-700 dark:text-neutral-300 truncate">
                        {f.name}
                      </span>
                    </button>
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
                    <button
                      onClick={() => toggleFile(f.path)}
                      className="w-full flex items-center gap-2 p-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
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
