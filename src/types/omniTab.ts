export type OmniTabType = 'space-log' | 'web' | 'doc' | 'code-canvas' | 'tool';
export type ToolTabId = 'knowledge-graph' | 'planner' | 'inbox' | 'model-store' | 'calendar';

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

export interface Space {
  id: string;
  name: string;
  agentIds: string[];
  peopleIds: string[];
  tabIds: string[];
  createdAt: number;
  updatedAt: number;
}
