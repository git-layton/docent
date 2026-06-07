import { Brain, Globe, Database, BookOpen, ListTodo, type LucideIcon } from 'lucide-react';

export interface SlashCommand {
  cmd: string;
  label: string;
  desc: string;
  icon: LucideIcon;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: 'think',     label: 'Deep Thinking',   desc: 'Enable deep reasoning for next message',  icon: Brain    },
  { cmd: 'search',    label: 'Web Search',       desc: 'Force a live internet search',            icon: Globe    },
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
      <div className="mx-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-3 bg-neutral-50 dark:bg-neutral-800/50">
          <span className="text-[10px] font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#899AB5]">Commands</span>
          <span className="text-[9px] text-neutral-400">↑↓ navigate · Enter select · Esc dismiss</span>
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
                  ? 'bg-[#F0F4F8] dark:bg-[#1E2B38]/40 border-l-[#4A5D75]'
                  : 'border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
              }`}
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${isHighlighted ? 'bg-[#4A5D75] text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-neutral-800 dark:text-neutral-100">/{cmd.cmd}</span>
                  <span className="text-[10px] text-neutral-400 font-medium">{cmd.label}</span>
                </div>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">{cmd.desc}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
