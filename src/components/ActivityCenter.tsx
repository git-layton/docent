import { useEffect } from 'react';
import { useJobStore } from '../store/useJobStore';
import { useReceiptStore } from '../services/receipts';
import { useUIStore } from '../store/useUIStore';
import { Activity, X, Play, Loader2, AlertCircle, CheckCircle, Undo2, RotateCcw } from 'lucide-react';

function receiptTime(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ActivityCenter() {
  const { jobs, isActivityCenterOpen, toggleActivityCenter, resumeJob, dismissJob, cancelJob } = useJobStore();
  const receipts = useReceiptStore(s => s.receipts);
  const isUndoable = useReceiptStore(s => s.isUndoable);

  // Load persisted receipt history the first time the panel opens.
  useEffect(() => {
    if (isActivityCenterOpen) useReceiptStore.getState().hydrate().catch(() => {});
  }, [isActivityCenterOpen]);

  const undoReceipt = async (id: string) => {
    try {
      await useReceiptStore.getState().undo(id);
      useUIStore.getState().showToast('↩︎ Undone');
    } catch (e: any) {
      useUIStore.getState().showToast(e?.message ?? 'Could not undo that.');
    }
  };

  if (!isActivityCenterOpen) return null;

  return (
    <div className="absolute top-12 right-4 w-80 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden flex flex-col max-h-[80vh]">
      <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          <span className="font-medium text-sm text-black/80 dark:text-white/80">Activity Center</span>
        </div>
        <button onClick={toggleActivityCenter} className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded-md">
          <X className="w-4 h-4 text-black/50 dark:text-white/50" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {jobs.length === 0 ? (
          <div className="text-center p-4 text-sm text-black/50 dark:text-white/50">
            No active jobs
          </div>
        ) : (
          jobs.map(job => (
            <div key={job.id} className="p-3 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {job.status === 'InProgress' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                  {job.status === 'Completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                  {job.status === 'Interrupted' && <AlertCircle className="w-4 h-4 text-yellow-500" />}
                  {(job.status === 'PausedError' || job.status === 'Cancelled') && <X className="w-4 h-4 text-red-500" />}
                  <span className="font-medium text-sm text-black/90 dark:text-white/90">{job.name}</span>
                </div>
                <div className="flex gap-1">
                  {job.status === 'Interrupted' && (
                    <button onClick={() => resumeJob(job.id)} className="p-1 hover:bg-blue-500/20 text-blue-500 rounded" title="Resume">
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {job.status === 'InProgress' && (
                    <button onClick={() => cancelJob(job.id)} className="p-1 hover:bg-red-500/20 text-red-500 rounded" title="Cancel">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {job.status !== 'InProgress' && (
                    <button onClick={() => dismissJob(job.id)} className="p-1 hover:bg-black/10 dark:hover:bg-white/10 text-black/50 dark:text-white/50 rounded" title="Dismiss">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              
              <div className="text-xs text-black/60 dark:text-white/60 font-mono">
                {job.logs.length > 0 ? job.logs[job.logs.length - 1] : 'Initializing...'}
              </div>
              
              {job.status === 'Interrupted' && (
                <div className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                  Docent restarted while this job was running.
                </div>
              )}
            </div>
          ))
        )}

        {/* Receipt ledger — what agents did, with a working undo while one is available. */}
        {receipts.length > 0 && (
          <>
            <div className="px-1 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-black/40 dark:text-white/40">
              Agent actions
            </div>
            {receipts.slice(0, 30).map(r => (
              <div key={r.id} className="p-3 bg-black/5 dark:bg-white/5 rounded-lg border border-black/5 dark:border-white/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={
                      r.status === 'undone'
                        ? 'text-sm text-black/40 dark:text-white/40 line-through truncate'
                        : 'text-sm font-medium text-black/90 dark:text-white/90 truncate'
                    }>
                      {r.action}
                    </div>
                    <div className="text-xs text-black/60 dark:text-white/60 mt-0.5 break-words">{r.summary}</div>
                    <div className="text-[10px] text-black/40 dark:text-white/40 mt-1">
                      {r.status === 'undone' ? 'Undone · ' : ''}{receiptTime(r.ts)}
                    </div>
                  </div>
                  {r.status === 'done' && isUndoable(r.id) && (
                    <button
                      onClick={() => undoReceipt(r.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-blue-500 hover:bg-blue-500/15 shrink-0"
                      title={`Undo: ${r.action}`}
                    >
                      <Undo2 className="w-3 h-3" /> Undo
                    </button>
                  )}
                  {r.status === 'undone' && <RotateCcw className="w-3.5 h-3.5 text-black/30 dark:text-white/30 shrink-0" />}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
