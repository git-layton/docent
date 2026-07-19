import { X, type LucideIcon } from 'lucide-react';
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
  icon: Icon,
  header,
  collapsedTitle,
  hideTitle = 'Hide',
  children,
}: DockedAgentRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  // widthRef mirrors width so the mouseup persist sees the final drag value, not a stale closure.
  const widthRef = useRef(RAIL_DEFAULT);
  const [width, setWidth] = useState(RAIL_DEFAULT);

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
    return (
      <button
        onClick={() => onToggle(true)}
        className="shrink-0 w-9 flex flex-col items-center pt-3 border-l border-edge bg-panel text-ink-3 hover:text-ink hover:bg-wash transition-colors"
        title={collapsedTitle}
      >
        <Icon className="w-4 h-4" />
      </button>
    );
  }
  return (
    <div
      ref={railRef}
      style={{ width }}
      className="relative shrink-0 flex flex-col m-3 rounded-2xl shadow-2xl ring-1 ring-white/10 bg-panel overflow-hidden"
    >
      <div
        onMouseDown={handleResizeDrag}
        className="absolute left-0 top-0 bottom-0 w-1 z-10 cursor-col-resize hover:bg-accent transition-colors"
        title="Drag to resize"
      />
      <div className="h-9 flex items-center gap-2 px-3 border-b border-edge shrink-0">
        <div className="flex-1 min-w-0 flex items-center gap-2">{header}</div>
        <button
          onClick={() => onToggle(false)}
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
