import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';

interface AgentVisionToggleProps {
  on: boolean;
  onToggle: (v: boolean) => void;
}

/**
 * Pill toggle that reveals ("Review") or hides ("Focus") the AI marginalia
 * layer. On = Review Mode (cards visible); Off = Focus Mode (cards hidden).
 */
export function AgentVisionToggle({ on, onToggle }: AgentVisionToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Agent Vision"
      title={on ? 'Agent Vision: Review Mode (showing notes)' : 'Agent Vision: Focus Mode (notes hidden)'}
      onClick={() => onToggle(!on)}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors select-none',
        on
          ? 'border-accent/30 bg-accent-soft/70 text-accent-soft-ink hover:bg-accent-soft'
          : 'border-edge-2 bg-inset text-ink-3 hover:bg-wash hover:text-ink-2',
      )}
    >
      {on ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      <span>{on ? 'Review' : 'Focus'}</span>
    </button>
  );
}

export default AgentVisionToggle;
