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
    <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-edge/50 glass-sky px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-ink-3">Working</span>
        {total > 1 && (
          <span className="text-[10px] font-medium text-ink-3">
            {Math.min(done + 1, total)} of {total}
          </span>
        )}
      </div>

      {hidden > 0 && (
        <div className="text-[10px] text-ink-3 mb-1 pl-[18px]">+{hidden} earlier</div>
      )}

      <ul className="flex flex-col gap-1">
        {shown.map((s, i) => (
          <li key={`${s.label}-${i}`} className="flex items-center gap-2">
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {s.status === 'done' ? (
                <Check className="h-3 w-3 text-success" />
              ) : s.status === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin text-accent" />
              ) : (
                // Pending: a dot, not a spinner. Only one thing is actually happening at a time and
                // showing several spinners would imply otherwise.
                <span className="h-1.5 w-1.5 rounded-full bg-ink-3/40" />
              )}
            </span>
            <span
              className={`text-[11px] leading-tight ${
                s.status === 'done' ? 'text-ink-3' : s.status === 'running' ? 'text-ink font-medium' : 'text-ink-3'
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
