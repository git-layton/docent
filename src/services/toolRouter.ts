import { hasResearchIntent } from './research';

export type RoutedTool = 'Knowledge Search' | 'Web Search' | 'Calendar';

export interface ToolRouteDecision {
  tool: RoutedTool | null;
  reason: string;
  forced: boolean;
}

export interface ToolRouteInput {
  message: string;
  agentTools?: Record<string, any>;
  forcedTool?: string | null;
}

const knowledgePattern = /\b(notes?|memos?|memory|knowledge base|goals?|decisions?|research|workspace|saved|wrote|remember|recall|pinned|what did we decide|what have we tried)\b/i;
const webPattern = /\b(search for|look up|google|current (weather|news|price|score)|today.s (weather|news)|latest (news|update)|breaking news|weather (in|for)|stock (price|market)|news about|what.s happening)\b/i;
const calendarPattern = /\b(schedule|remind|calendar|appointment|meeting|add.*event|plan.*for|set.*reminder)\b/i;

export const routeToolForMessage = ({
  message,
  agentTools = {},
  forcedTool = null,
}: ToolRouteInput): ToolRouteDecision => {
  const text = String(message || '');

  if (forcedTool === 'workspace') {
    return { tool: 'Knowledge Search', reason: 'workspace search was explicitly requested', forced: true };
  }

  if (forcedTool === 'search') {
    return { tool: 'Web Search', reason: 'web search was explicitly requested', forced: true };
  }

  if (agentTools.local_workspace && knowledgePattern.test(text)) {
    return { tool: 'Knowledge Search', reason: 'message asks about saved memory or workspace context', forced: false };
  }

  if (agentTools.web_search && (hasResearchIntent(text) || webPattern.test(text))) {
    return { tool: 'Web Search', reason: 'message asks for current, sourced, or web-verifiable facts', forced: false };
  }

  if (agentTools.calendar_sync && calendarPattern.test(text)) {
    return { tool: 'Calendar', reason: 'message asks to schedule or remember a dated item', forced: false };
  }

  return { tool: null, reason: 'no tool route needed', forced: false };
};
