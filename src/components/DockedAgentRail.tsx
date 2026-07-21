import { X, Maximize2, Minimize2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { db } from '../services/database';

// One shared chrome for every docked agent rail so they look + behave identically wherever they appear:
// the co-pilot rail beside Notes/Browser/Canvas (App.tsx) and the Team group-chat rail in Code
// (AgentForgeCodePanel). Only the CONTENTS differ — which icon, what header sits beside it, and which
// conversation the body (a <ChatPanel>) is pointed at. The collapsed state, panel width, borders, header
// bar, and the hide/show toggle are defined ONCE here. Keep new rails on this component, not a fresh one.

// Every rail shares ONE persisted width — it's the same surface docked in different places, so
// resizing it anywhere resizes it everywhere (applied on next mount for already-open rails).
const RAIL_WIDTH_KEY = 'agentRailWidth';
const RAIL_MIN = 280;
const RAIL_MAX = 640;
const RAIL_DEFAULT = 360;
const clampWidth = (w: number) => Math.min(RAIL_MAX, Math.max(RAIL_MIN, w));

interface DockedAgentRailProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Leading icon — used both in the header and on the collapsed reopen strip (Bot, Users, …). */
  icon: LucideIcon;
  /** Header content beside the icon — e.g. an agent <select>, or a title + subtitle. Filled flex-1. */
  header: ReactNode;
  /** Tooltip on the collapsed strip's reopen button. */
  collapsedTitle: string;
  /** Tooltip on the in-header hide button (defaults to "Hide"). */
  hideTitle?: string;
  /** The rail body — typically a <ChatPanel mode="inline" />. */
  children: ReactNode;
}

export function DockedAgentRail({
  open,
  onToggle,
  
  header,
  
  hideTitle = 'Hide',
  children,
}: DockedAgentRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  // widthRef mirrors width so the mouseup persist sees the final drag value, not a stale closure.
  const widthRef = useRef(RAIL_DEFAULT);
  const [width, setWidth] = useState(RAIL_DEFAULT);
  const [isExpanded, setIsExpanded] = useState(false);


  useEffect(() => {
    db.get(RAIL_WIDTH_KEY, RAIL_DEFAULT)
      .then((v: any) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          widthRef.current = clampWidth(n);
          setWidth(widthRef.current);
        }
      })
      .catch(() => {});
  }, []);

  const handleResizeDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => {
      const rect = railRef.current?.getBoundingClientRect();
      if (!rect) return;
      // The rail hugs the right edge, so dragging the handle left grows it.
      widthRef.current = clampWidth(rect.right - ev.clientX);
      setWidth(widthRef.current);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      void db.set(RAIL_WIDTH_KEY, widthRef.current);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) {
    return null;
  }
  return (
    <div
      ref={railRef}
      // data-ambient on the RAIL, not just on the ChatPanel inside it. The header strip below is
      // the rail's own, so it sits outside the panel's ambient subtree — which left its title and
      // buttons resolving --af-ink from the THEME (near-white #f1f0ec) while the body correctly
      // used the sky ramp (#2a2c2a on a bright sky). White icons on a bright-sky glass panel are
      // the "all the icons are blank" report: they were painted, just invisible.
      data-ambient="true"
      style={isExpanded ? {} : { width }}
      // NO glass on the rail itself — it is a frame (border + shadow + rounding), not a surface.
      // The body it wraps is a <ChatPanel>, which paints its own sky-adaptive glass. When the rail
      // painted glass too, the two identical layers stacked: 0.20 over 0.20 is an effective 0.36
      // tint and blur(24px) applied twice (~34px), which is the milky "white sheet" look rather
      // than clear glass. Same deferral App.tsx already does via `primaryIsAmbient`. Only the
      // header strip below — which sits OUTSIDE the ChatPanel — carries its own glass.
      className={`relative flex flex-col rounded-xl border border-edge/50 shadow-lg overflow-hidden transition-all ${
        isExpanded ? 'absolute inset-0 z-[100] m-2' : 'shrink-0'
      }`}
    >
      <div
        onMouseDown={handleResizeDrag}
        className="absolute left-0 top-0 bottom-0 w-1 z-10 cursor-col-resize hover:bg-accent transition-colors"
        title="Drag to resize"
      />
      {/* Carries the glass for the header strip only: it lives above the ChatPanel, so without a
          fill of its own it would float on the bare wallpaper once the rail stopped painting one. */}
      <div className="h-9 flex items-center gap-2 px-3 border-b border-edge shrink-0 glass-sky">
        <div className="flex-1 min-w-0 flex items-center gap-2">{header}</div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 rounded-md text-ink-3 hover:text-ink hover:bg-inset transition-colors"
          title={isExpanded ? "Collapse" : "Expand to full screen"}
        >
          {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => {
            if (isExpanded) setIsExpanded(false);
            onToggle(false);
          }}
          className="p-1 rounded-md text-ink-3 hover:text-ink hover:bg-inset transition-colors"
          title={hideTitle}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
