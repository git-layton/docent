import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, MessageSquare, MessageCircle, FileText, Code, Cpu, X, Plus, Home, Star, SplitSquareHorizontal, Share2, CheckSquare, Mail, CalendarDays, StickyNote, Images, Monitor, Activity, Layers, Settings } from 'lucide-react';
import clsx from 'clsx';
import { useSpaceStore } from '../store/useSpaceStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMessagesStore } from '../store/useMessagesStore';

import type { OmniTab } from '../types/omniTab';
import { TabOverflowMenu } from './TabOverflowMenu';

// ---------------------------------------------------------------------------
// Overflow threshold — past this many tabs, the surplus collapse into a
// searchable dropdown anchored at the end of the strip.
// ---------------------------------------------------------------------------
export const MAX_VISIBLE_TABS = 8;

// ---------------------------------------------------------------------------
// partitionTabs — PURE. Splits a Space's tabs into the visible set (Chrome-style
// pills) and the overflow set (collapsed into the dropdown). The active tab is
// never hidden: if it would land in overflow it's swapped into the last visible
// slot. Visible tabs keep their original order; overflow tabs keep theirs too.
// ---------------------------------------------------------------------------
export function partitionTabs(
  tabs: OmniTab[],
  activeId: string | null,
  maxVisible: number = MAX_VISIBLE_TABS,
): { visible: OmniTab[]; overflow: OmniTab[] } {
  if (tabs.length <= maxVisible) return { visible: tabs, overflow: tabs.slice(maxVisible) };

  const visible = tabs.slice(0, maxVisible);
  const overflow = tabs.slice(maxVisible);

  // Active tab is never hidden — if it's in overflow, swap it into the last
  // visible slot so the strip always shows where the user currently is.
  if (activeId != null && overflow.some(t => t.id === activeId)) {
    const activeIdx = overflow.findIndex(t => t.id === activeId);
    const lastVisibleIdx = visible.length - 1;
    const demoted = visible[lastVisibleIdx];
    visible[lastVisibleIdx] = overflow[activeIdx];
    overflow[activeIdx] = demoted;
  }

  return { visible, overflow };
}

// ---------------------------------------------------------------------------
// filterHiddenTabs — PURE. Case-insensitive filter of overflow tabs by `label`
// and (for `web` tabs) `url`. An empty/whitespace query returns the input as-is.
// ---------------------------------------------------------------------------
export function filterHiddenTabs(tabs: OmniTab[], query: string): OmniTab[] {
  const q = query.trim().toLowerCase();
  if (!q) return tabs;
  return tabs.filter(t => {
    if (t.label.toLowerCase().includes(q)) return true;
    if (t.type === 'web' && t.url && t.url.toLowerCase().includes(q)) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// TabFavicon — copied from BrowserWindowApp.tsx
// ---------------------------------------------------------------------------
export function TabFavicon({ url }: { url: string }) {
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
export function TypeIcon({ tab }: { tab: OmniTab }) {
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
      switch (tab.toolId) {
        case 'knowledge-graph':
          return <Share2 className={cls} />;
        case 'planner':
          return <CheckSquare className={cls} />;
        case 'inbox':
          return <Mail className={cls} />;
        case 'messages':
          return <MessageCircle className={cls} />;
        case 'notes':
          return <StickyNote className={cls} />;
        case 'calendar':
          return <CalendarDays className={cls} />;
        case 'activity':
          return <Activity className={cls} />;
        case 'gallery':
          return <Images className={cls} />;
        case 'desktop':
          return <Monitor className={cls} />;
        case 'settings':
          return <Settings className={cls} />;
        default:
          return <Cpu className={cls} />;
      }
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
}

function TabPill({ tab, isActive, isSplit }: TabPillProps) {
  // Activity bubble: unread iMessage count on the Messages tab.
  const unread = useMessagesStore(s => s.unread);
  const showUnread = tab.type === 'tool' && tab.toolId === 'messages' && unread > 0;
  // Activity bubble: new background-work results (routines) on the Inbox tab — same Slack-style
  // signal as Messages, cleared when the Inbox is opened.
  const inboxAlerts = useUIStore(s => s.inboxAlerts);
  const showInboxAlerts = tab.type === 'tool' && tab.toolId === 'inbox' && inboxAlerts > 0;

  // Pointer-based reorder. WKWebView (Tauri's macOS webview) doesn't reliably fire HTML5
  // drag-and-drop events, so we drive reordering with pointer events instead: drag a tab over
  // another and they swap live (by their position in the global omniTabs array); the new order
  // persists on release. `didDrag` swallows the click-to-activate that fires on pointer-up.
  const didDrag = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (tab.isPinned || e.button !== 0) return;
      // Don't start a reorder from the star/split/close controls (they're role="button" spans).
      if ((e.target as HTMLElement).closest('[role="button"]')) return;

      const startX = e.clientX;
      didDrag.current = false;

      const onMove = (ev: PointerEvent) => {
        if (!didDrag.current && Math.abs(ev.clientX - startX) < 5) return;
        didDrag.current = true;
        const overEl = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)
          ?.closest('[data-tab-id]') as HTMLElement | null;
        const overId = overEl?.getAttribute('data-tab-id');
        if (!overId || overId === tab.id) return;
        const tabs = useSpaceStore.getState().omniTabs;
        const from = tabs.findIndex(t => t.id === tab.id);
        const to = tabs.findIndex(t => t.id === overId);
        if (from !== -1 && to !== -1 && from !== to) useSpaceStore.getState().moveTab(from, to);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (didDrag.current) useSpaceStore.getState().persist();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [tab.id, tab.isPinned],
  );

  return (
    <button
      type="button"
      data-active={isActive}
      data-tab-id={tab.id}
      onPointerDown={handlePointerDown}
      onClick={() => {
        // Swallow the click that follows a drag-reorder; otherwise activate the tab.
        if (didDrag.current) { didDrag.current = false; return; }
        useSpaceStore.getState().setActiveTab(tab.id);
      }}
      className={clsx(
        // Chrome-style sizing: each tab prefers ~168px but will shrink down to a
        // favicon-only sliver (min-w) as more tabs crowd in; past that the strip scrolls.
        'group h-8 rounded-t-lg px-3 text-[11px] font-medium grow-0 shrink basis-[168px] max-w-[220px] min-w-[44px] flex items-center gap-1.5 overflow-hidden transition-colors',
        isActive
          ? 'bg-panel border border-b-0 border-edge-2 text-ink shadow-[inset_0_2px_0_0_var(--af-accent)]'
          : 'text-ink-3 hover:text-ink-2 hover:bg-wash',
      )}
    >
      <TypeIcon tab={tab} />
      <span className="truncate flex-1 min-w-0">{tab.label}</span>
      {showInboxAlerts && (
        <span
          className="shrink-0 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-on-accent text-[9px] font-bold flex items-center justify-center leading-none"
          title={`${inboxAlerts} new item${inboxAlerts !== 1 ? 's' : ''} from your routines`}
        >
          {inboxAlerts > 99 ? '99+' : inboxAlerts}
        </span>
      )}
      {showUnread && (
        <span
          className="shrink-0 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-on-accent text-[9px] font-bold flex items-center justify-center leading-none"
          title={`${unread} unread message${unread !== 1 ? 's' : ''}`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
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
            ? 'opacity-100 text-warning'
            : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-ink-2',
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
              ? 'opacity-100 text-accent hover:text-accent-strong'
              : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-ink-2',
          )}
          title={isSplit ? 'Close split' : 'Open beside current tab'}
        >
          <SplitSquareHorizontal className="w-3 h-3" />
        </span>
      )}
      {/* The agent Chat (space-log) is the home base — it can't be closed. */}
      {!tab.isPinned && tab.type !== 'space-log' && (
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
  // "+" = new tab. Home IS the new-tab page (the permanent pinned launcher): focus it — it
  // always exists — and everything launched from it opens as a fresh tab beside it.
  const openHome = useCallback(() => {
    const st = useSpaceStore.getState();
    st.setActiveTab(st.ensureHomeTab());
  }, []);

  return (
    <button
      type="button"
      onClick={openHome}
      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-ink-3 hover:text-ink hover:bg-wash transition-colors mb-1"
      title="New tab — Start"
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
  const spaces = useSpaceStore(s => s.spaces);
  const activeOmniTabId = useSpaceStore(s => s.activeOmniTabId);
  const activeSpaceId = useSpaceStore(s => s.activeSpaceId);
  const splitTabId = useUIStore(s => s.splitTabId);
  const [showSpaceMenu, setShowSpaceMenu] = useState(false);

  // Poll the iMessage unread count so the Messages tab's activity bubble (and the Home card) stay
  // fresh. OmniTabBar is always mounted, so this is the app-wide heartbeat for that count. Held off
  // until the user has completed Messages setup so we don't probe (and fail) before access exists.
  const imessageReady: boolean = useSettingsStore(s => (s.integrations as any).imessage?.setupComplete) ?? false;
  const refreshUnread = useMessagesStore(s => s.refreshUnread);
  useEffect(() => {
    if (!imessageReady) return;
    refreshUnread();
    const t = setInterval(refreshUnread, 15_000);
    return () => clearInterval(t);
  }, [imessageReady, refreshUnread]);

  // Only show tabs belonging to the active Space — this IS the Space context
  const spaceTabs = allTabs.filter(t => t.spaceId === activeSpaceId);

  // Past the threshold, the surplus collapses into the overflow dropdown.
  // The active tab is never hidden (partitionTabs swaps it in if needed).
  const { visible: visibleTabs, overflow: overflowTabs } = partitionTabs(spaceTabs, activeOmniTabId);

  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible as the strip shrinks / scrolls (e.g. after
  // opening a new tab at the end, or activating one that's scrolled off-screen).
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeOmniTabId, visibleTabs.length]);

  // Once tabs overflow they can't shrink further, so let a vertical wheel /
  // trackpad gesture scroll the strip horizontally (no visible scrollbar).
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
  }, []);

  return (
    <div className="h-10 flex items-center justify-between bg-panel border-b border-edge px-4 shrink-0 relative z-20">
      <div className="relative flex items-center gap-2 pr-3 border-r border-edge mr-3">
        <button
          onClick={() => setShowSpaceMenu(!showSpaceMenu)}
          className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors"
          title="Switch Space"
        >
          <Layers className="w-4 h-4" />
        </button>
        {/* The active Space, named, right beside its switcher. */}
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-3 truncate max-w-[9rem]" title="Active Space">
          {spaces.find(s => s.id === activeSpaceId)?.name ?? 'Personal'}
        </span>
        {showSpaceMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowSpaceMenu(false)} />
            <div className="absolute top-full left-0 mt-2 w-64 z-50 overflow-hidden rounded-2xl border border-edge-2 bg-black/95 backdrop-blur-xl shadow-xl">
              <div className="px-3 pt-3 pb-2 text-[10px] font-bold text-ink-3 tracking-widest uppercase">SPACES</div>
              <div className="flex flex-col py-1">
                {spaces.filter(s => s.kind === 'space').map(space => (
                  <button
                    key={space.id}
                    onClick={() => { useSpaceStore.getState().setActiveSpaceId(space.id); setShowSpaceMenu(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${activeSpaceId === space.id ? 'bg-wash text-ink' : 'text-ink-2 hover:bg-wash'}`}
                  >
                    <div className={`w-3 h-3 rounded-full shrink-0 ${activeSpaceId === space.id ? 'bg-accent' : 'bg-ink-3'}`} />
                    <span className="text-sm font-semibold truncate">{space.name}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-edge my-1" />
              <button
                onClick={() => { useUIStore.getState().openSpaceWizard(); setShowSpaceMenu(false); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors text-ink-2 hover:bg-wash"
              >
                <Plus className="w-4 h-4 text-ink-3" />
                <span className="text-sm font-semibold">New space</span>
              </button>
            </div>
          </>
        )}
      </div>
      <div
        ref={stripRef}
        onWheel={handleWheel}
        className="flex-1 min-w-0 flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visibleTabs.map((tab) => (
          <TabPill
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeOmniTabId}
            isSplit={tab.id === splitTabId}
          />
        ))}
        <NewTabButton />
      </div>
      {/* Overflow dropdown is pinned outside the scrolling strip so its panel
          (which drops below the bar) isn't clipped by the strip's overflow. */}
      {overflowTabs.length > 0 && (
        <div className="shrink-0 pl-2">
          <TabOverflowMenu tabs={overflowTabs} />
        </div>
      )}
    </div>
  );
}
