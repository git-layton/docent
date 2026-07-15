import { Brain, Globe, Database, BookOpen, ListTodo, Telescope, type LucideIcon } from 'lucide-react';

export interface SlashCommand {
  cmd: string;
  label: string;
  desc: string;
  icon: LucideIcon;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: 'think',     label: 'Deep Thinking',   desc: 'Enable deep reasoning for next message',  icon: Brain    },
  { cmd: 'search',    label: 'Web Search',       desc: 'Force a live internet search',            icon: Globe    },
  { cmd: 'research',  label: 'Deep Research',    desc: 'Launch an async background research job', icon: Telescope },
  { cmd: 'knowledge', label: 'Knowledge Base',       desc: "Search your Knowledge Base — memos, notes & saved files · ⌘⇧K", icon: Database },
  { cmd: 'memo',      label: 'New Memo',         desc: 'Open the memo compose panel',             icon: BookOpen },
  { cmd: 'plan',      label: 'Plan Mode',        desc: 'Agent responds with a structured plan',   icon: ListTodo },
];

interface Props {
  query: string;
  highlightIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onHighlight: (index: number) => void;
  enabledTools?: Record<string, boolean>;
}

const TOOL_GATE: Record<string, string> = {
  search:    'web_search',
  workspace: 'local_workspace',
};

export function SlashCommandPalette({ query, highlightIndex, onSelect, onHighlight, enabledTools }: Props) {
  const available = SLASH_COMMANDS.filter(c => {
    const gate = TOOL_GATE[c.cmd];
    return !gate || enabledTools?.[gate];
  });
  const filtered = available.filter(c =>
    c.cmd.startsWith(query.toLowerCase()) || c.label.toLowerCase().startsWith(query.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-3 z-[200]">
      <div className="mx-auto bg-panel-2 border border-edge rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-edge flex items-center gap-3 bg-inset">
          <span className="text-[10px] font-black uppercase tracking-widest text-accent">Commands</span>
          <span className="text-[9px] text-ink-3">↑↓ navigate · Enter select · Esc dismiss</span>
        </div>
        {filtered.map((cmd, idx) => {
          const Icon = cmd.icon;
          const isHighlighted = idx === highlightIndex % filtered.length;
          return (
            <button
              key={cmd.cmd}
              onMouseEnter={() => onHighlight(idx)}
              onClick={() => onSelect(cmd)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-l-2 ${
                isHighlighted
                  ? 'bg-accent-soft/40 border-l-accent'
                  : 'border-l-transparent hover:bg-wash'
              }`}
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${isHighlighted ? 'bg-accent text-on-accent' : 'bg-inset text-ink-3'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ink">/{cmd.cmd}</span>
                  <span className="text-[10px] text-ink-3 font-medium">{cmd.label}</span>
                </div>
                <span className="text-[11px] text-ink-2 truncate">{cmd.desc}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
