import { useState } from 'react';
import { Globe, FileText, ChevronDown, ChevronUp, BadgeCheck } from 'lucide-react';
import { useSpaceStore } from '../store/useSpaceStore';
import type { ToolTabId } from '../types/omniTab';

interface Source {
  title: string;
  url?: string;
  path?: string;
  snippet?: string;
  /** Answer receipt: this answer was grounded in an open local panel (mail/notes/…). */
  local?: boolean;
  kind?: string; // useToolContextStore source id, e.g. 'mail' | 'notes' | 'messages' | 'tasks' | 'calendar'
}

interface Props {
  sources: Source[];
  onOpenFile?: (path: string) => void;
}

/** Tool-context source id → the tool tab that shows it. */
export const LOCAL_SOURCE_TOOL: Record<string, ToolTabId> = {
  mail: 'inbox',
  messages: 'messages',
  notes: 'notes',
  tasks: 'planner',
  calendar: 'calendar',
};

const LOCAL_SOURCE_LABEL: Record<string, string> = {
  mail: 'Local Mail',
  messages: 'Messages',
  notes: 'Apple Notes',
  tasks: 'Reminders',
  calendar: 'Calendar',
};

/** Focus (or reopen) the tool tab a local receipt points at. */
function openLocalSource(kind: string | undefined) {
  const toolId = kind ? LOCAL_SOURCE_TOOL[kind] : undefined;
  if (!toolId) return;
  const st = useSpaceStore.getState();
  const existing = st.omniTabs.find(t => t.type === 'tool' && t.toolId === toolId && t.spaceId === (st.activeSpaceId ?? undefined));
  if (existing) st.setActiveTab(existing.id);
  else st.openTab({ type: 'tool', toolId, label: LOCAL_SOURCE_LABEL[kind!] ?? 'Tool' });
}

export function SourcesTray({ sources, onOpenFile }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const localSources = sources.filter(s => s.local);
  const webSources = sources.filter(s => s.url && !s.local);
  const fileSources = sources.filter(s => s.path && !s.url && !s.local);

  if (sources.length === 0) return null;

  return (
    <div className="mt-5 pt-4 border-t border-edge flex flex-col gap-3">
      {/* Answer receipts — the answer was grounded in something the user can reopen and check. */}
      {localSources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {localSources.map((src, idx) => (
            <button
              key={`${src.kind}-${idx}`}
              onClick={() => openLocalSource(src.kind)}
              title={`Open ${src.title}`}
              className="group/rcpt flex items-center gap-2 px-2.5 py-1.5 bg-inset border border-edge rounded-xl hover:border-success hover:bg-wash transition-all max-w-[240px] shadow-sm text-left"
            >
              <BadgeCheck className="w-3.5 h-3.5 text-success shrink-0" />
              <span className="text-[10px] font-bold text-ink-2 truncate">
                Grounded in {LOCAL_SOURCE_LABEL[src.kind ?? ''] ?? 'your workspace'}
                {src.title ? ` — ${src.title}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      {/* Web sources */}
      {webSources.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-ink-3 flex items-center gap-1.5">
            <Globe className="w-3 h-3" /> Sources Referenced
          </span>
          <div className="flex flex-wrap gap-2">
            {webSources.map((src, idx) => (
              <a
                key={src.url || idx}
                href={src.url}
                target="_blank"
                rel="noreferrer"
                className="group/src flex items-center gap-2 p-1.5 px-2.5 bg-inset border border-edge rounded-xl hover:border-accent hover:bg-wash transition-all max-w-[200px] shadow-sm hover:shadow-md"
              >
                <img
                  src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(src.url!)}`}
                  className="w-4 h-4 rounded-sm object-cover bg-white"
                  alt=""
                />
                <span className="text-[10px] font-bold text-ink-2 truncate group-hover/src:text-accent">
                  {src.title.replace('Wiki: ', '')}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Local file sources */}
      {fileSources.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-ink-3 flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> From Your Knowledge Core
          </span>
          <div className="flex flex-col gap-1.5">
            {fileSources.map((src, idx) => {
              const isExpanded = expandedIdx === idx;
              const stem = src.path?.split('/').pop()?.replace('.md', '') ?? src.title;
              return (
                <div key={src.path || idx}>
                  <button
                    onClick={() => { setExpandedIdx(isExpanded ? null : idx); if (!isExpanded && onOpenFile && src.path) onOpenFile(src.path); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-inset border border-edge hover:border-accent hover:bg-wash transition-all text-left max-w-xs cursor-pointer"
                  >
                    <FileText className="w-3 h-3 text-accent shrink-0" />
                    <span className="text-[10px] font-bold text-ink-2 truncate flex-1">
                      {src.title || stem}
                    </span>
                    {isExpanded
                      ? <ChevronUp className="w-3 h-3 text-ink-3 shrink-0" />
                      : <ChevronDown className="w-3 h-3 text-ink-3 shrink-0" />
                    }
                  </button>
                  {isExpanded && src.snippet && (
                    <div className="mt-1 ml-2 p-3 rounded-xl bg-inset border border-edge text-[11px] text-ink-2 font-mono whitespace-pre-wrap leading-relaxed max-w-sm">
                      {src.snippet}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
