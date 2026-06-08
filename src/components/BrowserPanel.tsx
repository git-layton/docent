import { useState, KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Bot, X } from 'lucide-react';
import clsx from 'clsx';
import { useProactiveCommentary } from '../services/proactiveCommentary';

export interface BrowserPanelProps {
  currentUrl?: string;
  pageTitle?: string;
  pageContent?: string;
  proactiveEnabled?: boolean;
}

interface ProactiveChipProps {
  comment: string;
  onDismiss: () => void;
}

function ProactiveChip({ comment, onDismiss }: ProactiveChipProps) {
  return (
    <div
      className={clsx(
        'absolute bottom-4 right-4 z-30',
        'flex items-start gap-2.5 max-w-xs',
        'bg-white dark:bg-neutral-900',
        'border border-neutral-200 dark:border-neutral-700',
        'rounded-xl shadow-lg px-3.5 py-3',
        'animate-in slide-in-from-bottom-3 fade-in duration-300',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-md bg-[#4A5D75] flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-white" />
      </div>
      <p className="flex-1 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">{comment}</p>
      <button
        onClick={onDismiss}
        className="shrink-0 mt-0.5 p-0.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function BrowserPanel({
  currentUrl = '',
  pageTitle = '',
  pageContent = '',
  proactiveEnabled = false,
}: BrowserPanelProps) {
  const [url, setUrl] = useState(currentUrl);
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(false);

  const { comment, dismiss } = useProactiveCommentary(url, pageTitle, pageContent, proactiveEnabled);

  const navigate = () => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setUrl(trimmed);
    setTimeout(() => setIsLoading(false), 600);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigate();
  };

  return (
    <div className="relative flex flex-col h-full w-full bg-white dark:bg-neutral-900">
      <div className="h-12 flex items-center gap-1.5 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <button
          className={clsx('p-1.5 rounded-lg transition-colors text-neutral-400', 'hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200')}
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          className={clsx('p-1.5 rounded-lg transition-colors text-neutral-400', 'hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200')}
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={navigate}
          className={clsx('p-1.5 rounded-lg transition-colors text-neutral-400', 'hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200', isLoading && 'animate-spin')}
          title="Reload"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        <input
          type="text"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search or enter URL..."
          className={clsx(
            'flex-1 min-w-0 h-8 px-3 rounded-lg text-xs font-medium outline-none',
            'bg-neutral-100 dark:bg-neutral-800',
            'text-neutral-900 dark:text-neutral-100',
            'placeholder:text-neutral-400',
            'focus:ring-1 ring-[#6A829E]/30',
          )}
        />

        <button
          className={clsx('flex items-center gap-1.5 px-3 h-8 rounded-lg transition-colors shrink-0', 'bg-[#4A5D75] hover:bg-[#3D4D61] text-white', 'text-[10px] font-black uppercase tracking-widest')}
          title="Save page to Knowledge Base"
        >
          <Globe className="w-3.5 h-3.5" />
          Save to KB
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="text-center space-y-2">
          <Globe className="w-10 h-10 text-neutral-300 dark:text-neutral-700 mx-auto" />
          <p className="text-sm font-bold text-neutral-400 dark:text-neutral-600">
            Browser coming soon — WebView wiring in progress
          </p>
          {url && (
            <p className="text-xs text-neutral-400 dark:text-neutral-600 font-mono truncate max-w-xs">{url}</p>
          )}
        </div>
      </div>

      {comment && <ProactiveChip comment={comment} onDismiss={dismiss} />}
    </div>
  );
}

export default BrowserPanel;
