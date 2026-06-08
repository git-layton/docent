/**
 * BrowserPanel — minimal stub created by Unit 6 (proactive commentary).
 *
 * TODO (future units): add a real webview / iframe, navigation controls,
 * page-text extraction, and wire useBrowserStore once it is created.
 *
 * This file provides just enough structure so that the proactive commentary
 * chip has a home. The parent is expected to pass the current page URL,
 * title, and a text snippet as props (or derive them from useBrowserStore
 * once available).
 */

import { Bot, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useProactiveCommentary } from '../services/proactiveCommentary';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrowserPanelProps {
  /** URL currently loaded in the browser panel. */
  currentUrl?: string;
  /** Page title. */
  pageTitle?: string;
  /** First ~3000 chars of visible page text used for AI context. */
  pageContent?: string;
  /**
   * Whether proactive commentary is enabled for this session.
   * Defaults to true so it is opt-out once a real settings toggle exists.
   */
  proactiveEnabled?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// ProactiveChip — floating comment card
// ---------------------------------------------------------------------------

interface ProactiveChipProps {
  comment: string;
  onDismiss: () => void;
}

function ProactiveChip({ comment, onDismiss }: ProactiveChipProps) {
  return (
    <div
      className={cn(
        // Positioning — bottom-right corner of the content area
        'absolute bottom-4 right-4 z-30',
        // Card style matching app conventions
        'flex items-start gap-2.5 max-w-xs',
        'bg-white dark:bg-neutral-900',
        'border border-neutral-200 dark:border-neutral-700',
        'rounded-xl shadow-lg px-3.5 py-3',
        // Slide-in animation
        'animate-in slide-in-from-bottom-3 fade-in duration-300',
      )}
      role="status"
      aria-live="polite"
    >
      {/* Agent icon */}
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-md bg-[#4A5D75] flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-white" />
      </div>

      {/* Comment text */}
      <p className="flex-1 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
        {comment}
      </p>

      {/* Dismiss button */}
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

// ---------------------------------------------------------------------------
// BrowserPanel
// ---------------------------------------------------------------------------

export function BrowserPanel({
  currentUrl = '',
  pageTitle = '',
  pageContent = '',
  proactiveEnabled = true,
  className,
}: BrowserPanelProps) {
  const { comment, dismiss } = useProactiveCommentary(
    currentUrl,
    pageTitle,
    pageContent,
    proactiveEnabled,
  );

  return (
    <div className={cn('relative flex flex-col w-full h-full overflow-hidden', className)}>
      {/*
       * TODO: Replace this placeholder with a real webview/iframe once the
       * browser panel is fully implemented in a later unit.
       */}
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm select-none">
        {currentUrl ? (
          <span className="truncate px-4">{currentUrl}</span>
        ) : (
          <span>Browser panel — coming soon</span>
        )}
      </div>

      {/* Proactive commentary chip */}
      {comment && (
        <ProactiveChip comment={comment} onDismiss={dismiss} />
      )}
    </div>
  );
}

export default BrowserPanel;
