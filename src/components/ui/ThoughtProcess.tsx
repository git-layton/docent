import { useState, useRef, useEffect } from 'react';
import { Loader2, Brain, ChevronDown } from 'lucide-react';

/**
 * A reasoning model's thinking, shown WHILE it thinks.
 *
 * This used to open collapsed and stay that way, so a local reasoning model — Gemma 4, Qwen3,
 * DeepSeek-R1 — would spend one to three minutes inside <think> while the user saw a box that said
 * "Thinking..." and nothing else. The tokens were streaming the whole time, into a panel hidden
 * behind a click nobody knew to make. Reported, fairly, as "it's not showing the tokens it's
 * producing" and as the app being hung.
 *
 * So: expanded while streaming, collapsed once the answer arrives. Watching it work is the point
 * during; a finished message wants to be tidy after. The one rule on top of that is that a manual
 * toggle always wins — a panel that springs open again after you close it is worse than one that
 * never opened.
 */
export const ThoughtProcess = ({ content, isStreaming }: any) => {
  // Open on arrival when streaming, so the first frame already shows work happening.
  const [expanded, setExpanded] = useState(!!isStreaming);
  // Once the user has an opinion, auto-behaviour stops. Tracked rather than inferred, because
  // "did they choose this or did we?" cannot be recovered from the boolean alone.
  const userDecided = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (userDecided.current) return;
    setExpanded(!!isStreaming);
  }, [isStreaming]);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, expanded]);

  // Even collapsed, show the tail of what it is thinking — a spinner alone is indistinguishable
  // from a hang, which is the complaint this component caused.
  const preview = String(content ?? '').replace(/\s+/g, ' ').trim().slice(-90);

  return (
    <div className={`mb-4 rounded-2xl border transition-all duration-500 overflow-hidden ${isStreaming ? 'border-accent/50 bg-panel-2 shadow-sm' : 'border-edge bg-panel-2'}`}>
      <button
        onClick={() => { userDecided.current = true; setExpanded(e => !e); }}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 p-3.5 text-[11px] font-black uppercase tracking-widest text-ink-3 hover:text-accent transition-colors outline-none bg-transparent"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {isStreaming ? <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" /> : <Brain className="w-4 h-4 text-success shrink-0" />}
          <span className={`shrink-0 ${isStreaming ? 'text-accent' : ''}`}>{isStreaming ? 'Thinking' : 'Thought Process'}</span>
          {isStreaming && !expanded && preview && (
            <span className="truncate normal-case tracking-normal font-medium text-ink-3/80">{preview}</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div ref={scrollRef} className="p-4 pt-1 text-sm text-ink-2 whitespace-pre-wrap leading-relaxed custom-scrollbar max-h-96 overflow-y-auto font-medium border-t border-transparent">
          {content}
          {isStreaming && <span className="inline-block w-2 h-4 ml-1 align-middle bg-ink-3 animate-pulse" />}
        </div>
      )}
    </div>
  );
};
