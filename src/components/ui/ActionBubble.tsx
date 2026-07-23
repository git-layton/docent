import { Check, Loader2 } from 'lucide-react';
import { useAgentActivityStore } from '../../store/useAgentActivityStore';

/**
 * What Docent is doing, while it does it.
 *
 * Three states used to be possible in a turn and all of them read as "stuck": bouncing dots with no
 * label, a one-line label that each action overwrote before you could read it, and — when the model
 * emitted a tool call the app couldn't run — a wall of raw JSON. Hiding the JSON was right, but on
 * its own it left an endless loading bubble and no evidence anything was happening.
 *
 * So: the same shape as a message bubble, listing every step of the turn with its own status. Done
 * steps keep their line instead of disappearing, which is what makes it readable rather than a
 * flicker — you can look up mid-turn and see what already happened, not just what is happening now.
 *
 * It is deliberately NOT the receipt trail. This is ephemeral and unpersisted; once the turn lands,
 * ActivityTrail takes over with the durable, undoable record. This is the "during", that is the
 * "after".
 */
export function ActionBubble() {
  const steps = useAgentActivityStore(s => s.steps);
  const total = useAgentActivityStore(s => s.total);
  const done = useAgentActivityStore(s => s.done);

  if (steps.length === 0) return null;

  // A long plan collapses from the top: the tail is what's live, and the finished head is the least
  // interesting part once there are more than a few.
  const MAX_VISIBLE = 4;
  const hidden = Math.max(0, steps.length - MAX_VISIBLE);
  const shown = hidden > 0 ? steps.slice(hidden) : steps;

  return (
    <div className="w-full max-w-[280px] rounded-[24px] rounded-bl-sm border border-edge/60 bg-panel/90 backdrop-blur-2xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/20">
          <div className="absolute inset-0 rounded-full border border-accent/40 animate-ping opacity-75" />
          <div className="h-1.5 w-1.5 rounded-full bg-accent" />
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-2">Thinking</span>
        {total > 1 && (
          <span className="ml-auto text-[9px] font-bold tracking-widest uppercase text-ink-3 px-1.5 py-0.5 rounded-md bg-inset border border-edge/50">
            {Math.min(done + 1, total)} / {total}
          </span>
        )}
      </div>

      {hidden > 0 && (
        <div className="text-[10px] text-ink-3 mb-2 pl-[26px] font-medium opacity-60">+{hidden} earlier steps</div>
      )}

      <ul className="flex flex-col gap-1.5">
        {shown.map((s, i) => (
          <li key={`${s.label}-${i}`} className="flex items-center gap-2.5">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center bg-inset rounded-full border border-edge/30">
              {s.status === 'done' ? (
                <Check className="h-2.5 w-2.5 text-success drop-shadow-sm" />
              ) : s.status === 'running' ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin text-accent" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-ink-3/30" />
              )}
            </span>
            <span
              className={`text-[11px] tracking-wide transition-colors ${
                s.status === 'done' ? 'text-ink-3' : s.status === 'running' ? 'text-ink font-bold' : 'text-ink-3/60 font-medium'
              }`}
            >
              {s.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
