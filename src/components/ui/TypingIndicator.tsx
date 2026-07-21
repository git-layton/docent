import { useAgentActivityStore } from '../../store/useAgentActivityStore';

/**
 * The "agent is working" indicator.
 *
 * Bare bouncing dots used to run for the whole turn, which made a long turn look identical to a
 * hung one — the app read as slow even while it was busy. When the agent is applying actions we
 * now say which one, and how far along it is. The dots stay on their own for the genuinely
 * unknowable part (waiting on the model's first token), because inventing a label there would be
 * a lie about what's happening.
 */
export const TypingIndicator = ({ inline = false }: { inline?: boolean }) => {
  const label = useAgentActivityStore(s => s.label);
  const total = useAgentActivityStore(s => s.total);
  const done = useAgentActivityStore(s => s.done);

  return (
    <div className={`flex items-center gap-2.5 animate-in fade-in zoom-in duration-300 ${inline ? 'py-1 min-h-[24px]' : 'px-4 py-3 bg-panel-2 rounded-2xl w-fit shadow-sm border border-edge'}`}>
      <div className="flex items-center gap-1.5">
        {[0, 200, 400].map(delay => (
          <div key={delay} className="w-1.5 h-1.5 bg-accent rounded-full" style={{ animation: `typingBounce 1.4s infinite ${delay}ms` }} />
        ))}
      </div>
      {label && (
        <span className="text-[11px] font-medium text-ink-2 animate-in fade-in slide-in-from-left-1">
          {label}
          {total > 1 && <span className="text-ink-3"> · {Math.max(done, 1)} of {total}</span>}
        </span>
      )}
    </div>
  );
};
