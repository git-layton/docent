import React from 'react';
import { Check, X } from 'lucide-react';
import type { Annotation } from '../store/useMarginaliaStore';

// ---------------------------------------------------------------------------
// MarginaliaLayer — overlays AI comment cards on a doc/canvas when Agent Vision
// is on. Each card shows the agent's note (color-coded) and, when a rewrite is
// suggested, an [Apply Fix] button. v1 renders cards in a right-edge column;
// precise text-range anchoring is a follow-up the leaf worker will deepen.
// ---------------------------------------------------------------------------

interface MarginaliaLayerProps {
  tabId: string;
  annotations: Annotation[];
  visible: boolean;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function MarginaliaLayer({ annotations, visible, onAccept, onDismiss }: MarginaliaLayerProps): React.ReactElement | null {
  if (!visible || annotations.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 w-72 pointer-events-none">
      {annotations.map(an => (
        <div
          key={an.id}
          className="pointer-events-auto rounded-xl bg-[#12141a] border shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-3 animate-in slide-in-from-right-4 duration-200"
          style={{ borderColor: an.color }}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: an.color }} />
            <p className="text-xs text-neutral-200 leading-relaxed flex-1">{an.body}</p>
          </div>
          {an.suggestedText && (
            <div className="mt-2 text-[11px] text-neutral-400 bg-[rgba(255,255,255,0.04)] rounded-lg px-2 py-1.5 font-mono leading-relaxed">
              {an.suggestedText}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            {an.suggestedText && (
              <button
                onClick={() => onAccept(an.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2C3E35]/40 hover:bg-[#2C3E35]/70 text-[#7A9E8D] text-[10px] font-bold uppercase tracking-wide transition-colors"
              >
                <Check className="w-3 h-3" /> Apply Fix
              </button>
            )}
            <button
              onClick={() => onDismiss(an.id)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-neutral-500 hover:text-neutral-300 text-[10px] font-bold uppercase tracking-wide transition-colors"
            >
              <X className="w-3 h-3" /> Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
