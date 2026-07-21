import { Moon, X, Loader2 } from 'lucide-react';

interface Props {
  fileCount: number;
  isRunning: boolean;
  onRun: () => void;
  onDismiss: () => void;
}

/** One-time invite to run a first Dream Cycle. Shares the top strip with
 *  MorningBriefingBanner — App only ever renders one of the two. */
export function FirstDreamPrompt({ fileCount, isRunning, onRun, onDismiss }: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-[#1E1B4B] border-b border-indigo-800/40 animate-in slide-in-from-top-2 fade-in duration-300">
      <Moon className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
      <p className="flex-1 text-xs text-indigo-200 min-w-0 truncate">
        <span className="font-semibold text-indigo-100">
          Your assistant has {fileCount} memories now.
        </span>{' '}
        A Dream Cycle can tidy them and flag anything left hanging.
      </p>
      <button
        onClick={onRun}
        disabled={isRunning}
        className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-white underline underline-offset-2 transition-colors disabled:opacity-50 disabled:no-underline"
      >
        {isRunning ? <><Loader2 className="w-3 h-3 animate-spin" /> Dreaming…</> : 'Run once'}
      </button>
      <button
        onClick={onDismiss}
        className="shrink-0 p-0.5 text-indigo-400 hover:text-indigo-200 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
