import { useMemo } from 'react';

export const ContextMeter = ({ messages, systemPromptLen, limit }: any) => {
  const used = useMemo(() => messages.reduce((n: number, m: any) => n + String(m.content ?? '').length, 0) + systemPromptLen, [messages, systemPromptLen]);
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = pct > 95 ? 'bg-[#C98A8A]' : pct > 80 ? 'bg-[#D4AA7D]' : 'bg-[#9FBBAF]';
  return (
    <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-800 shrink-0" title={`Context: ${used.toLocaleString()} / ${limit.toLocaleString()} chars`}>
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
};
