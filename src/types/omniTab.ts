export type OmniTabType = 'home' | 'space-log' | 'web' | 'doc' | 'code-canvas' | 'tool';
export type ToolTabId = 'knowledge-graph' | 'planner' | 'inbox' | 'model-store' | 'calendar' | 'activity';

export interface OmniTab {
  id: string;
  type: OmniTabType;
  label: string;
  spaceId?: string;         // which Space owns this tab
  url?: string;             // for 'web' tabs
  toolId?: ToolTabId;       // for 'tool' tabs
  canvasContentId?: string; // for 'doc'/'code-canvas'
  isPinned?: boolean;       // pinned tabs have no close button
  isFavorite?: boolean;     // user-starred → surfaced in the sidebar FAVORITES section
}

/**
 * A Space is the unified container. A DM and a project Space are the same shape,
 * distinguished by `kind`:
 *  - 'dm'    → exactly one agent, one persistent ongoing thread, can still hold tabs
 *  - 'space' → a project: 1+ agents (group-capable), a fresh thread per space
 * Every container owns its own conversation thread (`chatId`) so selecting one
 * never bleeds another's messages in.
 */
export type SpaceKind = 'dm' | 'space';

export interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
  agentIds: string[];
  peopleIds: string[];
  tabIds: string[];
  chatId: string;        // this container's own conversation thread (in useChatStore)
  createdAt: number;
  updatedAt: number;
}
