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
    <div className="my-3 rounded-2xl border border-edge bg-panel-2 overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v: boolean) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-wash transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-accent shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-ink-2 truncate">{title}</div>
            {subtitle && <div className="text-[9px] font-bold text-ink-3 truncate">{subtitle}</div>}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-edge text-sm text-ink-2 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
