import { X } from 'lucide-react';

interface DreamLog {
  timestamp: string;
  dismissed: boolean;
  tokens_saved: number;
  items_count: number;
  items: unknown[];
}

interface Props {
  log: DreamLog;
  onViewDigest: () => void;
  onDismiss: () => void;
}

export function MorningBriefingBanner({ log, onViewDigest, onDismiss }: Props) {
  const tokenStr = log.tokens_saved > 0
    ? `Saved ~${log.tokens_saved.toLocaleString()} tokens.`
    : '';

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-[#1E1B4B] border-b border-indigo-800/40 animate-in slide-in-from-top-2 fade-in duration-300">
      <span className="text-sm shrink-0">🌙</span>
      <p className="flex-1 text-xs text-indigo-200 min-w-0 truncate">
        <span className="font-semibold text-indigo-100">Dream Cycle Complete:</span>
        {' '}Consolidated {log.items_count} {log.items_count === 1 ? 'note' : 'notes'}.
        {tokenStr && ` ${tokenStr}`}
      </p>
      <button
        onClick={onViewDigest}
        className="shrink-0 text-xs font-semibold text-indigo-300 hover:text-white underline underline-offset-2 transition-colors"
      >
        View Digest
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
