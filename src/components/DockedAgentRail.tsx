import { X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// One shared chrome for every docked agent rail so they look + behave identically wherever they appear:
// the co-pilot rail beside Notes/Browser/Canvas (App.tsx) and the Team group-chat rail in Code
// (AgentForgeCodePanel). Only the CONTENTS differ — which icon, what header sits beside it, and which
// conversation the body (a <ChatPanel>) is pointed at. The collapsed state, panel width, borders, header
// bar, and the hide/show toggle are defined ONCE here. Keep new rails on this component, not a fresh one.
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
    <div className="relative shrink-0 w-[360px] min-w-[300px] flex flex-col border-l border-edge bg-panel">
      <div className="h-9 flex items-center gap-2 px-3 border-b border-edge shrink-0">
        <Icon className="w-4 h-4 text-accent shrink-0" />
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
