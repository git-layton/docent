import { Check, X } from 'lucide-react';
import clsx from 'clsx';
import type { Annotation } from '../store/useMarginaliaStore';

interface MarginaliaLayerProps {
  tabId: string;
  annotations: Annotation[];
  visible: boolean;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * Overlay of color-coded comment cards (marginalia) for a single tab.
 * Renders only the `open` annotations belonging to `tabId`. Each card shows
 * the agent's note, an optional suggested rewrite in a monospace block, an
 * [Apply Fix] button (only when a suggestion exists), and a [Dismiss] button.
 *
 * Returns null when hidden or when there is nothing to show — the parent
 * coordinator (App.tsx) owns the actual document mutation on accept.
 */
export function MarginaliaLayer({
  tabId,
  annotations,
  visible,
  onAccept,
  onDismiss,
}: MarginaliaLayerProps) {
  const open = annotations.filter(a => a.tabId === tabId && a.status === 'open');

  if (!visible || open.length === 0) return null;

  return (
    <div
      data-testid="marginalia-layer"
      className="pointer-events-none absolute inset-y-0 right-0 z-20 flex w-[19rem] max-w-[80vw] flex-col gap-2 overflow-y-auto p-3"
    >
      {open.map(ann => {
        const accent = ann.color || '#8A8F98';
        const hasFix = typeof ann.suggestedText === 'string' && ann.suggestedText.length > 0;
        return (
          <div
            key={ann.id}
            data-testid="marginalia-card"
            data-agent-id={ann.agentId}
            style={{ borderLeftColor: accent }}
            className={clsx(
              'pointer-events-auto rounded-lg border border-l-4 border-neutral-800',
              'bg-neutral-900/95 p-3 shadow-lg backdrop-blur-sm',
              'animate-[marginalia-in_180ms_ease-out]',
            )}
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: accent, boxShadow: `0 0 6px ${accent}88` }}
                aria-hidden="true"
              />
              <span
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: accent }}
              >
                {ann.agentId}
              </span>
            </div>

            <p className="whitespace-pre-wrap text-[12px] leading-snug text-neutral-200">
              {ann.body}
            </p>

            {hasFix && (
              <pre
                data-testid="marginalia-suggestion"
                className="mt-2 max-h-40 overflow-auto rounded-md border border-neutral-800 bg-neutral-950/80 p-2 font-mono text-[11px] leading-snug text-neutral-300"
              >
                {ann.suggestedText}
              </pre>
            )}

            <div className="mt-2.5 flex items-center justify-end gap-2">
              {hasFix && (
                <button
                  type="button"
                  onClick={() => onAccept(ann.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-[#1E2B38] px-2 py-1 text-[11px] font-semibold text-[#8FB5DA] transition-colors hover:bg-[#27384a]"
                >
                  <Check className="h-3 w-3" />
                  Apply Fix
                </button>
              )}
              <button
                type="button"
                onClick={() => onDismiss(ann.id)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
              >
                <X className="h-3 w-3" />
                Dismiss
              </button>
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes marginalia-in {
          from { opacity: 0; transform: translateX(8px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

export default MarginaliaLayer;
