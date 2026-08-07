import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, charBudget } from '../../services/llm'

// ─── Seam ③: realistic-size inputs ────────────────────────────────────────────
//
// Every section of the system prompt was individually reasonable and the TOTAL was never
// checked. That is how "Attached documents exceed the context limit" appeared on a correctly
// configured 32K model: the artifact went in uncapped, on top of profile, tasks, memory, graph,
// tool context and browser context, and the prompt alone outgrew the window before the user had
// typed anything.
//
// The invariant is not "each part is small". It is THE SYSTEM PROMPT MUST LEAVE ROOM FOR THE
// CONVERSATION. A prompt that fills the window is useless however well-formed each section is.

/** The prompt is scaffolding — the conversation is the point. Half the window is generous. */
const MAX_SHARE_OF_WINDOW = 0.5

const long = (n: number) => 'lorem ipsum dolor sit amet '.repeat(Math.ceil(n / 27)).slice(0, n)

/** Everything populated at sizes a real, heavy user would actually produce. */
const heavyInputs = (contextLimit: number) => ({
  contextLimit,
  agent: {
    name: 'Docent',
    prompt: long(3_000),
    drive: long(800),
    tools: { web_search: true, local_workspace: true, calendar: true },
    trainingDocs: [],
  },
  profile: long(4_000),
  userName: 'Alex',
  tasks: Array.from({ length: 60 }, (_, i) => ({
    id: `t${i}`, title: `Task number ${i} with a reasonably descriptive title`, completed: false,
    dueDate: '2026-08-20',
  })),
  recurringEvents: Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, title: `Recurring ${i}`, start: '2026-08-20' })),
  canvasContent: { title: 'A long working document', content: long(400_000) },
  mode: 'text',
  appSettings: { userName: 'Alex' },
  browserContext: { title: 'A page being read', url: 'https://example.com/a', pageContent: long(20_000) },
  ambientContext: { weather: 'clear', time: 'evening' },
  toolContext: { label: 'Inbox', text: long(15_000), source: 'mail' },
  memorySummary: long(6_000),
  relevantMemory: long(8_000),
  graphContext: long(2_000),
  knownProcedures: long(3_000),
  webRecall: long(5_000),
  goal: long(500),
  projectContext: long(4_000),
  voiceProfile: { tone: 'plain' },
})

describe('system prompt budget — the prompt must leave room for the conversation', () => {
  // 32K is the floor the app actually ships (bundled llama-server launches there; every
  // catalog model is registered at 32K or above).
  it.each([32_768, 200_000])(
    'stays under half the window at %i tokens, with everything populated',
    (contextLimit) => {
      const prompt = buildSystemPrompt(heavyInputs(contextLimit))
      expect(prompt.length).toBeLessThan(charBudget(contextLimit) * MAX_SHARE_OF_WINDOW)
    },
  )

  it('degrades rather than overflowing on an 8K window', () => {
    // Honest limit, not a target. The FIXED instruction scaffolding is ~11k chars on its own,
    // so half of an 8K window (16k chars) is not reachable while keeping the agent coherent.
    // What must hold is that the prompt never exceeds the window outright — the failure that
    // made every message error.
    const prompt = buildSystemPrompt(heavyInputs(8_192))
    expect(prompt.length).toBeLessThan(charBudget(8_192))
  })

  it('a huge open artifact alone cannot fill a small window', () => {
    // The exact shipped failure, isolated: nothing but the canvas.
    const prompt = buildSystemPrompt({
      agent: { prompt: 'be useful', tools: {} },
      tasks: [],
      contextLimit: 32_768,
      canvasContent: { title: 'Big note', content: long(500_000) },
    })
    expect(prompt.length).toBeLessThan(charBudget(32_768) * MAX_SHARE_OF_WINDOW)
  })

  it('grows with the window rather than being a fixed cap', () => {
    // A 200K model should be allowed to see far more of its artifact than a 8K one.
    const small = buildSystemPrompt(heavyInputs(8_192)).length
    const large = buildSystemPrompt(heavyInputs(200_000)).length
    expect(large).toBeGreaterThan(small)
  })

  it('a realistic prompt is not so trimmed that it loses its own instructions', () => {
    // The opposite failure: capping so hard the agent forgets who it is. The agent's own
    // prompt is never the thing to sacrifice.
    const prompt = buildSystemPrompt({ ...heavyInputs(32_768), agent: { name: 'Docent', prompt: 'MARKER_AGENT_IDENTITY', tools: {}, trainingDocs: [] } })
    expect(prompt.length).toBeGreaterThan(2_000)
    expect(prompt).toContain('MARKER_AGENT_IDENTITY')
  })

})

describe('system prompt must never throw — a crash here blocks every message', () => {
  const base = { agent: { prompt: 'be useful', tools: {} }, tasks: [], contextLimit: 32_768 }

  it('survives a browser tab whose page has not extracted yet', () => {
    // Reachable in normal use: browserContext is built from browserActiveTab whenever a tab is
    // active, but `content` is empty until extraction finishes. This used to reach .slice on
    // undefined and throw, so the user could not send ANY message while a page was loading.
    expect(() => buildSystemPrompt({
      ...base, browserContext: { title: 'Loading', url: 'https://example.com', pageContent: undefined },
    })).not.toThrow()
  })

  it('survives every optional context being null or malformed', () => {
    expect(() => buildSystemPrompt({
      ...base,
      canvasContent: null, toolContext: null, ambientContext: null, browserContext: null,
      memorySummary: null, relevantMemory: null, graphContext: null, knownProcedures: null,
      webRecall: null, goal: null, projectContext: null, voiceProfile: null,
      profile: null, userName: null, recurringEvents: null,
    })).not.toThrow()
  })

  it('omits an empty page rather than fencing an empty untrusted block', () => {
    const p = buildSystemPrompt({ ...base, browserContext: { title: 'T', url: 'u', pageContent: '   ' } })
    expect(p).not.toContain('UNTRUSTED_WEB_CONTENT')
  })
})
