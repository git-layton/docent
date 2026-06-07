import { describe, it, expect } from 'vitest'
import { routeToolForMessage, type ToolRouteInput } from '../../services/toolRouter'

// Helpers for DRY tool availability shapes
const allTools: ToolRouteInput['agentTools'] = {
  local_workspace: true,
  web_search: true,
  calendar_sync: true,
}
const noTools: ToolRouteInput['agentTools'] = {}

describe('routeToolForMessage', () => {
  // ── Knowledge Search ───────────────────────────────────────────────────────
  describe('knowledge search patterns', () => {
    it('routes "what did I note about the project goals" to Knowledge Search', () => {
      const result = routeToolForMessage({
        message: 'what did I note about the project goals',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Knowledge Search')
      expect(result.forced).toBe(false)
    })

    it('routes "recall my memories of last quarter" to Knowledge Search', () => {
      const result = routeToolForMessage({
        message: 'recall my memories of last quarter',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Knowledge Search')
      expect(result.forced).toBe(false)
    })

    it('routes "search my notes for the API decisions" to Knowledge Search', () => {
      const result = routeToolForMessage({
        message: 'search my notes for the API decisions',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Knowledge Search')
      expect(result.forced).toBe(false)
    })

    it('routes "do you remember what we decided on auth?" to Knowledge Search', () => {
      const result = routeToolForMessage({
        message: 'do you remember what we decided on auth?',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Knowledge Search')
      expect(result.forced).toBe(false)
    })

    it('does NOT route to Knowledge Search when local_workspace tool is absent', () => {
      const result = routeToolForMessage({
        message: 'check my notes for the roadmap',
        agentTools: { web_search: true, calendar_sync: true },
      })
      expect(result.tool).not.toBe('Knowledge Search')
    })
  })

  // ── Web Search ─────────────────────────────────────────────────────────────
  describe('web search patterns', () => {
    it('routes "what\'s the weather today in Austin" to Web Search', () => {
      const result = routeToolForMessage({
        message: "what's the weather today in Austin",
        agentTools: allTools,
      })
      expect(result.tool).toBe('Web Search')
      expect(result.forced).toBe(false)
    })

    it('routes "latest news about AI regulation" to Web Search', () => {
      const result = routeToolForMessage({
        message: 'latest news about AI regulation',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Web Search')
      expect(result.forced).toBe(false)
    })

    it('routes "current price of Bitcoin" to Web Search', () => {
      const result = routeToolForMessage({
        message: 'current price of Bitcoin',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Web Search')
      expect(result.forced).toBe(false)
    })

    it('routes "search for recent papers on transformers" to Web Search via hasResearchIntent', () => {
      const result = routeToolForMessage({
        message: 'search for recent papers on transformers',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Web Search')
      expect(result.forced).toBe(false)
    })

    it('does NOT route to Web Search when web_search tool is absent', () => {
      const result = routeToolForMessage({
        message: "what's the weather today in New York",
        agentTools: { local_workspace: true, calendar_sync: true },
      })
      expect(result.tool).not.toBe('Web Search')
    })
  })

  // ── Calendar ───────────────────────────────────────────────────────────────
  describe('calendar / schedule patterns', () => {
    it('routes "remind me to call Alice on Friday" to Calendar', () => {
      const result = routeToolForMessage({
        message: 'remind me to call Alice on Friday',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Calendar')
      expect(result.forced).toBe(false)
    })

    it('routes "schedule a meeting for next Monday" to Calendar', () => {
      const result = routeToolForMessage({
        message: 'schedule a meeting for next Monday',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Calendar')
      expect(result.forced).toBe(false)
    })

    it('routes "what\'s on my calendar this week" to Calendar', () => {
      const result = routeToolForMessage({
        message: "what's on my calendar this week",
        agentTools: allTools,
      })
      expect(result.tool).toBe('Calendar')
      expect(result.forced).toBe(false)
    })

    it('does NOT route to Calendar when calendar_sync tool is absent', () => {
      const result = routeToolForMessage({
        message: 'schedule a meeting for next Tuesday',
        agentTools: { local_workspace: true, web_search: true },
      })
      expect(result.tool).not.toBe('Calendar')
    })
  })

  // ── Forced override ────────────────────────────────────────────────────────
  describe('forced tool override', () => {
    it('forcedTool="workspace" routes to Knowledge Search regardless of message', () => {
      const result = routeToolForMessage({
        message: "what's the weather today",
        agentTools: allTools,
        forcedTool: 'workspace',
      })
      expect(result.tool).toBe('Knowledge Search')
      expect(result.forced).toBe(true)
      expect(result.reason).toMatch(/explicitly requested/)
    })

    it('forcedTool="search" routes to Web Search regardless of message', () => {
      const result = routeToolForMessage({
        message: 'remind me to call Bob',
        agentTools: allTools,
        forcedTool: 'search',
      })
      expect(result.tool).toBe('Web Search')
      expect(result.forced).toBe(true)
      expect(result.reason).toMatch(/explicitly requested/)
    })

    it('forcedTool="workspace" bypasses available-tools gate (no local_workspace)', () => {
      const result = routeToolForMessage({
        message: 'anything',
        agentTools: noTools,
        forcedTool: 'workspace',
      })
      expect(result.tool).toBe('Knowledge Search')
      expect(result.forced).toBe(true)
    })

    it('forcedTool="search" bypasses available-tools gate (no web_search)', () => {
      const result = routeToolForMessage({
        message: 'anything',
        agentTools: noTools,
        forcedTool: 'search',
      })
      expect(result.tool).toBe('Web Search')
      expect(result.forced).toBe(true)
    })

    it('unknown forcedTool value falls through to pattern matching', () => {
      const result = routeToolForMessage({
        message: 'current price of Ethereum',
        agentTools: allTools,
        forcedTool: 'unknown_tool',
      })
      // Falls through to web pattern — not forced
      expect(result.tool).toBe('Web Search')
      expect(result.forced).toBe(false)
    })
  })

  // ── Available-tools gate ───────────────────────────────────────────────────
  describe('available tools gate', () => {
    it('returns null tool when no tools are available and message matches a pattern', () => {
      const result = routeToolForMessage({
        message: 'remind me to send the report',
        agentTools: noTools,
      })
      expect(result.tool).toBeNull()
      expect(result.forced).toBe(false)
    })

    it('returns null tool when agentTools is omitted entirely', () => {
      const result = routeToolForMessage({
        message: 'what did I note about the budget',
      })
      expect(result.tool).toBeNull()
    })
  })

  // ── Ambiguous / neutral inputs ─────────────────────────────────────────────
  describe('ambiguous and neutral inputs', () => {
    it('returns null tool for a generic conversational message', () => {
      const result = routeToolForMessage({
        message: 'hello, how are you?',
        agentTools: allTools,
      })
      expect(result.tool).toBeNull()
      expect(result.reason).toBe('no tool route needed')
      expect(result.forced).toBe(false)
    })

    it('returns null tool for a math question', () => {
      const result = routeToolForMessage({
        message: 'what is 42 times 17?',
        agentTools: allTools,
      })
      expect(result.tool).toBeNull()
    })
  })

  // ── Edge cases ─────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('returns null tool for an empty string', () => {
      const result = routeToolForMessage({
        message: '',
        agentTools: allTools,
      })
      expect(result.tool).toBeNull()
      expect(result.forced).toBe(false)
    })

    it('handles whitespace-only message without throwing', () => {
      const result = routeToolForMessage({
        message: '   ',
        agentTools: allTools,
      })
      expect(result.tool).toBeNull()
    })

    it('is case-insensitive for knowledge patterns', () => {
      const result = routeToolForMessage({
        message: 'RECALL what we decided about deployment',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Knowledge Search')
    })

    it('is case-insensitive for calendar patterns', () => {
      const result = routeToolForMessage({
        message: 'SCHEDULE a team sync tomorrow',
        agentTools: allTools,
      })
      expect(result.tool).toBe('Calendar')
    })
  })
})
