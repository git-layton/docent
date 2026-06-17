import { useState } from 'react';
import { Sparkles, X, Loader2, RotateCcw } from 'lucide-react';

export interface DreamItem {
  id: string;
  type: 'merged' | 'updated' | 'pruned' | 'noticed' | 'insight';
  description: string;
  // notice-specific
  notice_title?: string;
  notice_body?: string;
  notice_agent_id?: string;
  // memory op fields
  archive_paths: string[];
  original_paths: string[];
  target_file?: string;
  git_commits: string[];
  undone?: boolean;
}

export interface DreamLog {
  timestamp: string;
  dismissed: boolean;
  tokens_saved: number;
  items_count: number;
  items: DreamItem[];
}

interface Props {
  log: DreamLog;
  onClose: () => void;
  onUndo: (itemId: string) => Promise<void>;
}

const TYPE_STYLES = {
  merged: {
    badge: 'bg-warning-soft text-warning',
    label: 'Merged',
  },
  updated: {
    badge: 'bg-accent-soft text-accent-soft-ink',
    label: 'Updated',
  },
  pruned: {
    badge: 'bg-danger-soft text-danger',
    label: 'Pruned',
  },
  insight: {
    badge: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
    label: 'Insight',
  },
} as const;

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function DreamDigestModal({ log, onClose, onUndo }: Props) {
  const [undoingId, setUndoingId] = useState<string | null>(null);

  async function handleUndo(id: string) {
    setUndoingId(id);
    try {
      await onUndo(id);
    } finally {
      setUndoingId(null);
    }
  }

  const notices = log.items.filter(i => i.type === 'noticed');
  const grouped = {
    insight: log.items.filter(i => i.type === 'insight'),
    merged: log.items.filter(i => i.type === 'merged'),
    updated: log.items.filter(i => i.type === 'updated'),
    pruned: log.items.filter(i => i.type === 'pruned'),
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl mx-4 bg-panel-2 rounded-2xl shadow-2xl border border-edge flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-edge shrink-0">
          <span className="text-2xl mt-0.5">🌙</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-ink">Dream Digest</h2>
            <p className="text-xs text-ink-2 mt-0.5">
              {formatTimestamp(log.timestamp)}
              {log.tokens_saved > 0 && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold">
                  ~{log.tokens_saved.toLocaleString()} tokens saved
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {log.items.length === 0 && (
            <p className="text-sm text-ink-2 text-center py-8">
              No changes were recorded in this Dream Cycle.
            </p>
          )}

          {/* Notices — shown first, styled like agent messages */}
          {notices.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                  Noticed
                </span>
                <span className="text-xs text-ink-3">{notices.length}</span>
              </div>
              <div className="space-y-3">
                {notices.map(item => (
                  <div key={item.id} className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-4">
                    <div className="flex items-start gap-2.5">
                      <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        {item.notice_title && (
                          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200 mb-1">{item.notice_title}</p>
                        )}
                        {item.notice_body && (
                          <p className="text-sm text-indigo-800 dark:text-indigo-300 leading-relaxed">{item.notice_body}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(['insight', 'merged', 'updated', 'pruned'] as const).map(type => {
            const items = grouped[type];
            if (items.length === 0) return null;
            const style = TYPE_STYLES[type];
            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.badge}`}>
                    {style.label}
                  </span>
                  <span className="text-xs text-ink-3">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                        item.undone
                          ? 'border-edge bg-wash'
                          : 'border-edge bg-panel'
                      }`}
                    >
                      <p className={`flex-1 text-sm text-ink-2 min-w-0 leading-relaxed ${item.undone ? 'line-through opacity-50' : ''}`}>
                        {item.description}
                      </p>
                      {item.undone ? (
                        <span className="shrink-0 text-[10px] font-bold text-success bg-success-soft px-2 py-1 rounded-full border border-success/30">
                          Restored ✓
                        </span>
                      ) : item.archive_paths.length > 0 ? (
                        <button
                          onClick={() => handleUndo(item.id)}
                          disabled={undoingId === item.id}
                          className="shrink-0 flex items-center gap-1.5 text-[10px] font-semibold text-accent hover:text-ink border border-accent/30 hover:border-edge-2 px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                          title="Restore this file from archive"
                        >
                          {undoingId === item.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Undo
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge shrink-0">
          <p className="text-[10px] text-ink-3 text-center">
            Archived files are kept for 7 days before permanent deletion.
            View them in the <span className="font-semibold">Archive</span> tab of the Knowledge Tray.
          </p>
        </div>
      </div>
    </div>
  );
}
