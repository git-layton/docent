import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import clsx from 'clsx';
import { useSpaceStore } from '../store/useSpaceStore';
import { useAgentStore } from '../store/useAgentStore';
import { BOT_COLORS } from './ui/AgentIcon';
import { TypeIcon, filterHiddenTabs } from './OmniTabBar';
import type { OmniTab } from '../types/omniTab';

interface TabOverflowMenuProps {
  /** The hidden (overflow) tabs that collapsed out of the visible strip. */
  tabs: OmniTab[];
}

/**
 * TabOverflowMenu — anchored at the end of the tab strip once a Space exceeds
 * the visible-tab threshold. Shows the hidden count and, when opened, a
 * searchable list of the hidden tabs. Tabs an agent opened are grouped under
 * that agent; the rest render ungrouped above.
 */
export function TabOverflowMenu({ tabs }: TabOverflowMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve agent metadata for the grouping headers (id → {name, color}).
  const assistants = useAgentStore(s => s.assistants);

  // Close on outside-click and Escape — mirrors the document-mousedown pattern
  // guarded by a ref used by the dropdowns in ChatInputBar.tsx.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Focus the search input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  const filtered = useMemo(() => filterHiddenTabs(tabs, query), [tabs, query]);

  // Partition the filtered results: ungrouped (no agent) vs. grouped-by-agent,
  // preserving original tab order within each group.
  const { ungrouped, groups } = useMemo(() => {
    const ungrouped: OmniTab[] = [];
    const groupMap = new Map<string, OmniTab[]>();
    const order: string[] = [];
    for (const t of filtered) {
      if (t.openedByAgentId) {
        if (!groupMap.has(t.openedByAgentId)) {
          groupMap.set(t.openedByAgentId, []);
          order.push(t.openedByAgentId);
        }
        groupMap.get(t.openedByAgentId)!.push(t);
      } else {
        ungrouped.push(t);
      }
    }
    const groups = order.map(agentId => {
      const agent = assistants.find((a: any) => a.id === agentId);
      const color = BOT_COLORS.find(c => c.id === agent?.avatar?.color);
      return {
        agentId,
        name: (agent?.name as string) ?? 'Agent',
        dotClass: color?.bg ?? 'bg-[#4A5D75]',
        tabs: groupMap.get(agentId)!,
      };
    });
    return { ungrouped, groups };
  }, [filtered, assistants]);

  const activate = (id: string) => {
    useSpaceStore.getState().setActiveTab(id);
    setOpen(false);
  };

  const renderRow = (tab: OmniTab) => (
    <button
      key={tab.id}
      type="button"
      onClick={() => activate(tab.id)}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs text-ink-2 hover:bg-wash hover:text-ink transition-colors"
    >
      <span className="shrink-0 text-ink-3"><TypeIcon tab={tab} /></span>
      <span className="truncate flex-1 min-w-0">{tab.label}</span>
    </button>
  );

  return (
    <div ref={wrapRef} className="relative shrink-0 mb-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        data-overflow-trigger
        className={clsx(
          'h-7 px-2 flex items-center gap-1 rounded-md text-[11px] font-medium transition-colors',
          open
            ? 'bg-[rgba(255,255,255,0.08)] text-white'
            : 'text-[rgba(255,255,255,0.45)] hover:text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.04)]',
        )}
        title={`${tabs.length} more tab${tabs.length === 1 ? '' : 's'}`}
      >
        <ChevronDown className="w-3 h-3" />
        <span>+{tabs.length}</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-panel-2 border border-edge rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-top-2 duration-150">
          {/* Search / filter */}
          <div className="p-2 border-b border-edge">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-wash rounded-xl">
              <Search className="w-3.5 h-3.5 shrink-0 text-ink-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search tabs…"
                className="flex-1 min-w-0 bg-transparent outline-none text-xs text-ink placeholder:text-ink-3"
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-72 overflow-y-auto p-1 space-y-0.5">
            {filtered.length === 0 ? (
              <div className="px-2.5 py-3 text-center text-[11px] text-ink-3">No matching tabs</div>
            ) : (
              <>
                {ungrouped.map(renderRow)}
                {groups.map(group => (
                  <div key={group.agentId} className={clsx(ungrouped.length > 0 && 'mt-1 pt-1 border-t border-edge-2')}>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-3">
                      <span className={clsx('w-2 h-2 rounded-full shrink-0', group.dotClass)} />
                      <span className="truncate">{group.name}</span>
                    </div>
                    {group.tabs.map(renderRow)}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
