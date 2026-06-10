import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Globe, MessageSquare, FileText, Code, Cpu, X, Plus, Calendar, Star, SplitSquareHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { useSpaceStore } from '../store/useSpaceStore';
import { useUIStore } from '../store/useUIStore';
import type { OmniTab } from '../types/omniTab';

// ---------------------------------------------------------------------------
// TabFavicon — copied from BrowserWindowApp.tsx
// ---------------------------------------------------------------------------
function TabFavicon({ url }: { url: string }) {
  const [err, setErr] = React.useState(false);
  if (err || !url) return <Globe className="w-3 h-3 shrink-0 opacity-40" />;
  try {
    const origin = new URL(url).origin;
    return (
      <img
        src={`${origin}/favicon.ico`}
        width={12}
        height={12}
        onError={() => setErr(true)}
        className="w-3 h-3 shrink-0 object-contain"
        alt=""
      />
    );
  } catch {
    return <Globe className="w-3 h-3 shrink-0 opacity-40" />;
  }
}

// ---------------------------------------------------------------------------
// TypeIcon — maps OmniTabType to a lucide icon
// ---------------------------------------------------------------------------
function TypeIcon({ tab }: { tab: OmniTab }) {
  const cls = 'w-3 h-3 shrink-0';
  switch (tab.type) {
    case 'web':
      return tab.url ? <TabFavicon url={tab.url} /> : <Globe className={cls} />;
    case 'space-log':
      return <MessageSquare className={cls} />;
    case 'doc':
      return <FileText className={cls} />;
    case 'code-canvas':
      return <Code className={cls} />;
    case 'tool':
      return <Cpu className={cls} />;
    default:
      return <Globe className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// TabPill
// ---------------------------------------------------------------------------
interface TabPillProps {
  tab: OmniTab;
  isActive: boolean;
  isSplit: boolean;
  index: number;
}

function TabPill({ tab, isActive, isSplit, index }: TabPillProps) {
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    },
    [index],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const fromIdx = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isNaN(fromIdx) && fromIdx !== index) {
        useSpaceStore.getState().moveTab(fromIdx, index);
      }
    },
    [index],
  );

  return (
    <button
      type="button"
      onClick={() => useSpaceStore.getState().setActiveTab(tab.id)}
      draggable={!tab.isPinned}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={clsx(
        'group h-8 rounded-t-lg px-3 text-[11px] font-medium max-w-[200px] min-w-[80px] shrink-0 flex items-center gap-1.5 transition-colors',
        isActive
          ? 'bg-[#12141a] border border-b-0 border-[rgba(255,255,255,0.08)] text-white'
          : 'text-[rgba(255,255,255,0.45)] hover:text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.04)]',
      )}
    >
      <TypeIcon tab={tab} />
      <span className="truncate flex-1 min-w-0">{tab.label}</span>
      {/* Star — pins this tab into the sidebar FAVORITES section */}
      <span
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          useSpaceStore.getState().toggleFavorite(tab.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            useSpaceStore.getState().toggleFavorite(tab.id);
          }
        }}
        className={clsx(
          'transition-opacity shrink-0',
          tab.isFavorite
            ? 'opacity-100 text-[#C9A227] hover:text-[#E0B530]'
            : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[rgba(255,255,255,0.6)]',
        )}
        title={tab.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className={clsx('w-3 h-3', tab.isFavorite && 'fill-current')} />
      </span>
      {/* Split — show this tab beside the active one */}
      {!isActive && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            const cur = useUIStore.getState().splitTabId;
            useUIStore.getState().setSplitTabId(cur === tab.id ? null : tab.id);
          }}
          className={clsx(
            'transition-opacity shrink-0',
            isSplit
              ? 'opacity-100 text-[#9EADC8] hover:text-white'
              : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[rgba(255,255,255,0.6)]',
          )}
          title={isSplit ? 'Close split' : 'Open beside current tab'}
        >
          <SplitSquareHorizontal className="w-3 h-3" />
        </span>
      )}
      {!tab.isPinned && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            useSpaceStore.getState().closeTab(tab.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              useSpaceStore.getState().closeTab(tab.id);
            }
          }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0"
          title="Close tab"
        >
          <X className="w-3 h-3" />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// NewTabButton
// ---------------------------------------------------------------------------
function NewTabButton() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const openTab = useCallback(
    (type: 'web' | 'doc' | 'code-canvas' | 'calendar') => {
      setOpen(false);
      switch (type) {
        case 'web':
          useSpaceStore.getState().openTab({ type: 'web', label: 'New Tab', url: 'https://duckduckgo.com' });
          break;
        case 'doc':
          useSpaceStore.getState().openTab({ type: 'doc', label: 'Untitled Doc' });
          break;
        case 'code-canvas':
          useSpaceStore.getState().openTab({ type: 'code-canvas', label: 'Untitled Canvas' });
          break;
        case 'calendar':
          useSpaceStore.getState().openTab({ type: 'tool', toolId: 'calendar', label: 'Calendar' });
          break;
      }
    },
    [],
  );

  return (
    <div ref={containerRef} className="relative mb-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-7 h-7 flex items-center justify-center rounded-md text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
        title="New tab"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-44 bg-[#1c1f26] border border-[rgba(255,255,255,0.08)] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden z-50 py-1">
          <button
            type="button"
            onClick={() => openTab('web')}
            className="w-full text-left px-3 py-2 text-xs text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.06)] flex items-center gap-2 transition-colors"
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            Web Browser
          </button>
          <button
            type="button"
            onClick={() => openTab('doc')}
            className="w-full text-left px-3 py-2 text-xs text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.06)] flex items-center gap-2 transition-colors"
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            Document
          </button>
          <button
            type="button"
            onClick={() => openTab('code-canvas')}
            className="w-full text-left px-3 py-2 text-xs text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.06)] flex items-center gap-2 transition-colors"
          >
            <Code className="w-3.5 h-3.5 shrink-0" />
            Code Canvas
          </button>
          <button
            type="button"
            onClick={() => openTab('calendar')}
            className="w-full text-left px-3 py-2 text-xs text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.06)] flex items-center gap-2 transition-colors"
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            Calendar
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OmniTabBar — public export
// ---------------------------------------------------------------------------
export function OmniTabBar(): React.JSX.Element {
  const allTabs = useSpaceStore(s => s.omniTabs);
  const activeOmniTabId = useSpaceStore(s => s.activeOmniTabId);
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);
  const splitTabId = useUIStore(s => s.splitTabId);

  // Only show tabs belonging to the active Space — this IS the Space context
  const spaceTabs = allTabs.filter(t => t.spaceId === activeSpaceId);

  return (
    <div className="h-10 flex items-end px-2 bg-[#0a0b0e] border-b border-[rgba(255,255,255,0.05)] shrink-0 relative z-20">
      {spaceTabs.map((tab) => {
        // Pass the global index so moveTab operates on the full omniTabs array correctly
        const globalIdx = allTabs.findIndex(t => t.id === tab.id);
        return (
          <TabPill
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeOmniTabId}
            isSplit={tab.id === splitTabId}
            index={globalIdx}
          />
        );
      })}
      <NewTabButton />
    </div>
  );
}
