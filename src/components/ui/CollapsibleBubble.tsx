import { useState } from 'react';
import { Brain, ChevronDown, Database, Globe, Sparkles } from 'lucide-react';

const icons: Record<string, any> = {
  thinking: Brain,
  action: Sparkles,
  research: Globe,
  memory_suggestion: Database,
};

export function CollapsibleBubble({ title, subtitle, type = 'thinking', defaultOpen = false, children }: any) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = icons[type] ?? Sparkles;

  return (
    <div className="my-3 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v: boolean) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white dark:hover:bg-neutral-800 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-[#6A829E] shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-neutral-600 dark:text-neutral-300 truncate">{title}</div>
            {subtitle && <div className="text-[9px] font-bold text-neutral-400 truncate">{subtitle}</div>}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-neutral-200 dark:border-neutral-800 text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
