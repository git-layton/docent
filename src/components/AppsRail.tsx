// A narrow rail of apps down the side of the conversation.
//
// The Start grid puts twelve saturated tiles in front of you before you have asked for anything —
// which is the "overwhelming to start" problem. This is the same catalog with the emphasis
// inverted: the conversation is the page, and the apps sit beside it at icon size, reachable in one
// click and quiet until then. Tools when you need tools.
//
// Same APPS registry the Start page reads, so the two can never drift into offering different
// things. Nothing here knows what any app IS — that stays in appRegistry.
import React from 'react';
import { APPS } from '../data/appRegistry';
import { useSpaceStore } from '../store/useSpaceStore';

export const AppsRail: React.FC = () => {
  const activeTab = useSpaceStore(s => s.omniTabs.find(t => t.id === s.activeOmniTabId));

  return (
    <nav
      aria-label="Apps"
      className="flex flex-col items-center gap-1 py-2 px-1.5 shrink-0 overflow-y-auto"
    >
      {APPS.map((app) => {
        const Icon = app.icon;
        // A tool tab already open for this app reads as selected, so the rail reflects where you
        // are rather than only where you can go.
        const isOpen = activeTab?.type === 'tool' && activeTab?.toolId === app.id;
        return (
          <button
            key={app.id}
            type="button"
            onClick={() => app.open(activeTab?.id)}
            title={app.useWhen ? `${app.label} — ${app.useWhen}` : app.label}
            aria-label={app.label}
            aria-current={isOpen ? 'page' : undefined}
            className={[
              'group relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
              'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
              isOpen ? 'bg-accent/15 text-accent' : 'text-ink-3 hover:text-ink hover:bg-inset',
            ].join(' ')}
          >
            <Icon className="w-[18px] h-[18px]" />
            {/* The label on hover rather than always: twelve words stacked down the edge is the
                tile grid again, just narrower. */}
            <span
              className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md whitespace-nowrap
                         text-[11px] font-medium bg-panel-2 text-ink border border-edge shadow-sm
                         opacity-0 group-hover:opacity-100 transition-opacity z-20"
            >
              {app.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
