import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// AgentVisionToggle — master switch that reveals/hides AI marginalia on a
// doc/canvas. Focus Mode (off) = AI invisible; Review Mode (on) = comments show.
// ---------------------------------------------------------------------------

interface AgentVisionToggleProps {
  on: boolean;
  onToggle: (v: boolean) => void;
}

export function AgentVisionToggle({ on, onToggle }: AgentVisionToggleProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      title={on ? 'Agent Vision on — AI comments visible' : 'Agent Vision off — focus mode'}
      className={clsx(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border',
        on
          ? 'bg-[#4A5D75]/20 border-[#4A5D75]/50 text-[#9EADC8]'
          : 'bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)]'
      )}
    >
      {on ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      Agent Vision
    </button>
  );
}
