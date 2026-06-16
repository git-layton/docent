import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Layers, FileText, Globe, Bot, Code, Wrench } from 'lucide-react';
import { useSpaceStore } from '../store/useSpaceStore';
import { useAgentStore } from '../store/useAgentStore';
import type { OmniTabType } from '../types/omniTab';

// ---------------------------------------------------------------------------
// CmdKPalette — global ⌘K command/search overlay. The "library net": with the
// sidebar kept lean (People/Tools/Favorites/Spaces only), everything else —
// every tab, doc, space, agent — is reachable by typing here. Self-sufficient;
// mounted once near the app modals.
// ---------------------------------------------------------------------------

type ResultKind = 'space' | 'tab' | 'agent';
interface Result {
  id: string;
  kind: ResultKind;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  onSelect: () => void;
}

function tabIcon(type: OmniTabType): React.ElementType {
  switch (type) {
    case 'web': return Globe;
    case 'doc': return FileText;
    case 'code-canvas': return Code;
    case 'tool': return Wrench;
    default: return Layers;
  }
}

export function CmdKPalette(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Query to pre-fill on the next open — set when the palette is launched from
  // elsewhere (e.g. the sidebar's top search box dispatches `forge:open-cmdk`).
  const seedRef = useRef('');

  const spaces = useSpaceStore(s => s.spaces);
  const omniTabs = useSpaceStore(s => s.omniTabs);
  const assistants = useAgentStore(s => s.assistants);

  // ⌘K / Ctrl+K to toggle; Esc to close; `forge:open-cmdk` to open from anywhere
  // (optionally seeded with a query, e.g. from the sidebar's top search box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpenEvent = (e: Event) => {
      const q = (e as CustomEvent).detail?.query;
      seedRef.current = typeof q === 'string' ? q : '';
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('forge:open-cmdk', onOpenEvent as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('forge:open-cmdk', onOpenEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (open) { setQuery(seedRef.current); seedRef.current = ''; setHighlight(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.toLowerCase().trim();
    const all: Result[] = [
      ...spaces.map(sp => ({
        id: sp.id, kind: 'space' as const, label: sp.name, sublabel: 'Space', icon: Layers,
        onSelect: () => useSpaceStore.getState().setActiveSpaceId(sp.id),
      })),
      ...omniTabs.map(t => ({
        id: t.id, kind: 'tab' as const, label: t.label, sublabel: t.url ?? t.type, icon: tabIcon(t.type),
        onSelect: () => useSpaceStore.getState().setActiveTab(t.id),
      })),
      ...assistants
        .filter((a: any) => a.id !== 'forge-guide' && a.id !== 'f-default')
        .map((a: any) => ({
          id: a.id, kind: 'agent' as const, label: a.name, sublabel: 'Agent', icon: Bot,
          onSelect: () => useAgentStore.getState().setActiveFolderId(a.id),
        })),
    ];
    if (!q) return all.slice(0, 30);
    // Prefix matches rank above substring matches; stable within each tier.
    const matched = all.filter(r => `${r.label} ${r.sublabel ?? ''}`.toLowerCase().includes(q));
    return matched
      .map((r, i) => ({ r, i, prefix: r.label.toLowerCase().startsWith(q) ? 0 : 1 }))
      .sort((a, b) => a.prefix - b.prefix || a.i - b.i)
      .map(x => x.r)
      .slice(0, 30);
  }, [query, spaces, omniTabs, assistants]);

  if (!open) return null;

  const choose = (r: Result) => { r.onSelect(); setOpen(false); };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[18vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[min(560px,calc(100%-2rem))] bg-panel-2 border border-edge-2 rounded-2xl shadow-[0_20px_70px_rgba(0,0,0,0.6)] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-edge">
          <Search className="w-4 h-4 text-ink-3 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter' && results[highlight]) { e.preventDefault(); choose(results[highlight]); }
            }}
            placeholder="Search spaces, tabs, agents…"
            className="flex-1 bg-transparent py-3.5 text-sm text-ink placeholder:text-ink-3 outline-none"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-ink-3">No matches</div>
          ) : (
            results.map((r, i) => {
              const Icon = r.icon;
              // When not searching, group results under a section header per kind.
              const showHeader = !query.trim() && (i === 0 || results[i - 1].kind !== r.kind);
              const sectionLabel = r.kind === 'space' ? 'Spaces' : r.kind === 'tab' ? 'Tabs' : 'Agents';
              return (
                <div key={`${r.kind}-${r.id}`}>
                  {showHeader && (
                    <div className="px-4 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-ink-3">
                      {sectionLabel}
                    </div>
                  )}
                  <button
                    onClick={() => choose(r)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === highlight ? 'bg-inset' : 'hover:bg-wash'}`}
                  >
                    <Icon className="w-4 h-4 text-ink-3 shrink-0" />
                    <span className="text-sm text-ink truncate flex-1">{r.label}</span>
                    {r.sublabel && <span className="text-[10px] text-ink-3 truncate max-w-[180px]">{r.sublabel}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-edge text-[10px] text-ink-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
