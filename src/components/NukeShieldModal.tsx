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
  const pct = existingLines > 0 ? Math.round((deletions / existingLines) * 100) : 0;
  const filename = path.split('/').pop() ?? path;

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-panel-2 border border-danger/30 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-danger-soft rounded-xl">
              <ShieldCheck className="w-6 h-6 text-danger" />
            </div>
            <div>
              <h2 className="text-sm font-black text-ink">Nuke Shield Triggered</h2>
              <p className="text-xs text-ink-2">{filename}</p>
            </div>
          </div>

          <div className="bg-danger-soft border border-danger/30 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
              <span className="text-sm font-bold text-danger">
                Agent wants to delete <strong>{deletions} lines</strong> ({pct}% of file)
              </span>
            </div>
            <p className="text-xs text-danger mt-1">
              The 40% rule was triggered. Review the diff before approving.
            </p>
          </div>

          {diffStat && (
            <pre className="text-xs font-mono bg-inset text-ink-2 rounded-lg p-3 mb-5 overflow-x-auto whitespace-pre-wrap">
              {diffStat}
            </pre>
          )}

          <div className="flex gap-3">
            <button
              onClick={onRollback}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-edge-2 text-sm font-bold text-ink-2 hover:bg-wash transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Rollback
            </button>
            <button
              onClick={onApprove}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-danger text-danger-soft text-sm font-bold hover:opacity-90 transition-all shadow-lg"
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
