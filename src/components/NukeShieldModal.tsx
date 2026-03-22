import { ShieldCheck, AlertTriangle, RotateCcw, Check } from 'lucide-react';

interface Props {
  path: string;
  deletions: number;
  existingLines: number;
  diffStat: string;
  onApprove: () => void;
  onRollback: () => void;
}

export function NukeShieldModal({ path, deletions, existingLines, diffStat, onApprove, onRollback }: Props) {
  const pct = existingLines > 0 ? Math.round((deletions / existingLines) * 100) : 100;
  const filename = path.split('/').pop() ?? path;

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 border border-red-200 dark:border-red-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-xl">
              <ShieldCheck className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-black text-neutral-900 dark:text-white">Nuke Shield Triggered</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{filename}</p>
            </div>
          </div>

          <div className="bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-sm font-bold text-red-700 dark:text-red-400">
                Agent wants to delete <strong>{deletions} lines</strong> ({pct}% of file)
              </span>
            </div>
            <p className="text-xs text-red-600 dark:text-red-500 mt-1">
              The 40% rule was triggered. Review the diff before approving.
            </p>
          </div>

          {diffStat && (
            <pre className="text-xs font-mono bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 rounded-lg p-3 mb-5 overflow-x-auto whitespace-pre-wrap">
              {diffStat}
            </pre>
          )}

          <div className="flex gap-3">
            <button
              onClick={onRollback}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm font-bold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Rollback
            </button>
            <button
              onClick={onApprove}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-all shadow-lg"
            >
              <Check className="w-4 h-4" />
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
