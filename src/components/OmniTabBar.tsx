import React, { useCallback, useEffect, useRef } from 'react';
import { Globe, MessageSquare, FileText, Code, Cpu, X, Plus, Home, Star, SplitSquareHorizontal } from 'lucide-react';
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
    case 'home':
      return <Home className={cls} />;
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
      data-active={isActive}
      onClick={() => useSpaceStore.getState().setActiveTab(tab.id)}
      draggable={!tab.isPinned}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={clsx(
        // Chrome-style sizing: each tab prefers ~168px but will shrink down to a
        // favicon-only sliver (min-w) as more tabs crowd in; past that the strip scrolls.
        'group h-8 rounded-t-lg px-3 text-[11px] font-medium grow-0 shrink basis-[168px] max-w-[220px] min-w-[44px] flex items-center gap-1.5 overflow-hidden transition-colors',
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
  // "+" opens the OS-style Home/start page. If the active Space already has a
  // Home tab, focus it rather than spawning a duplicate.
  const openHome = useCallback(() => {
    const { omniTabs, activeSpaceId, setActiveTab, openTab } = useSpaceStore.getState();
    const existing = omniTabs.find(t => t.type === 'home' && t.spaceId === (activeSpaceId ?? undefined));
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    openTab({ type: 'home', label: 'Home' });
  }, []);

  return (
    <button
      type="button"
      onClick={openHome}
      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors mb-1"
      title="New tab — Home"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
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

  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible as the strip shrinks / scrolls (e.g. after
  // opening a new tab at the end, or activating one that's scrolled off-screen).
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeOmniTabId, spaceTabs.length]);

  // Once tabs overflow they can't shrink further, so let a vertical wheel /
  // trackpad gesture scroll the strip horizontally (no visible scrollbar).
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
  }, []);

  return (
    <div className="h-10 flex items-end bg-[#0a0b0e] border-b border-[rgba(255,255,255,0.05)] shrink-0 relative z-20">
      <div
        ref={stripRef}
        onWheel={handleWheel}
        className="flex-1 min-w-0 flex items-end px-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
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
    </div>
  );
}
