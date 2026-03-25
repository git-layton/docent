import { useState, useRef, useEffect } from 'react';
import { Loader2, Brain, ChevronDown } from 'lucide-react';

export const ThoughtProcess = ({ content, isStreaming }: any) => {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, expanded]);

  return (
    <div className={`mb-4 rounded-2xl border transition-all duration-500 overflow-hidden ${isStreaming ? 'border-[#6A829E]/50 bg-neutral-50 dark:bg-neutral-800/50 shadow-sm' : 'border-neutral-200 dark:border-[#2C3E50] bg-neutral-50 dark:bg-[#1E2B38]'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3.5 text-[11px] font-black uppercase tracking-widest text-neutral-500 hover:text-[#6A829E] transition-colors outline-none bg-transparent"
      >
        <div className="flex items-center gap-2.5">
          {isStreaming ? <Loader2 className="w-4 h-4 animate-spin text-[#6A829E]" /> : <Brain className="w-4 h-4 text-[#9FBBAF]" />}
          <span className={isStreaming ? 'animate-pulse text-[#6A829E]' : ''}>{isStreaming ? 'Thinking...' : 'Thought Process'}</span>
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div ref={scrollRef} className="p-4 pt-1 text-sm text-neutral-600 dark:text-[#899AB5] whitespace-pre-wrap leading-relaxed custom-scrollbar max-h-96 overflow-y-auto font-medium border-t border-transparent">
          {content}
          {isStreaming && <span className="inline-block w-2 h-4 ml-1 align-middle bg-neutral-400 dark:bg-neutral-500 animate-pulse" />}
        </div>
      )}
    </div>
  );
};
