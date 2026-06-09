export type OmniTabType = 'space-log' | 'web' | 'doc' | 'code-canvas' | 'tool';
export type ToolTabId = 'knowledge-graph' | 'planner' | 'inbox' | 'model-store';
export interface OmniTab { id: string; type: OmniTabType; label: string; spaceId?: string; url?: string; toolId?: ToolTabId; canvasContentId?: string; isPinned?: boolean; }
export interface Space { id: string; name: string; agentIds: string[]; peopleIds: string[]; tabIds: string[]; createdAt: number; updatedAt: number; }
