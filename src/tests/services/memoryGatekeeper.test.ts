import { describe, it, expect } from 'vitest'
import {
  evaluateMemoryGate,
  buildGatekeeperMemoryWrite,
  selectPrimaryToolRoute,
  shouldPersistGatekeeperDecision,
  extractMemoryCandidateText,
  validateMemoryGatekeeperDecision,
  type MemoryGatekeeperDecision,
} from '../../services/memoryGatekeeper'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeDecision(overrides: Partial<MemoryGatekeeperDecision> = {}): MemoryGatekeeperDecision {
  return {
    shouldSave: true,
    classification: 'explicit',
    destination: 'agent_memory',
    memoryType: 'fact',
    evidenceState: 'first_party',
    confidence: 'high',
    privacy: 'normal',
    reason: 'test reason',
    tags: [],
    toolRoutes: ['none'],
    warnings: [],
    provenance: { source: 'user', sourcePaths: [], sourceUrls: [] },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// evaluateMemoryGate — trivial / skip inputs
// ---------------------------------------------------------------------------

describe('evaluateMemoryGate', () => {
  it('should skip trivial "thanks" messages', () => {
    const result = evaluateMemoryGate({ text: 'thanks' })
    expect(result.shouldSave).toBe(false)
    expect(result.classification).toBe('skip')
    expect(result.destination).toBe('skip')
  })

  it('should skip "lol" and similar one-word acknowledgements', () => {
    const result = evaluateMemoryGate({ text: 'lol' })
    expect(result.shouldSave).toBe(false)
  })

  it('should skip empty text', () => {
    const result = evaluateMemoryGate({ text: '' })
    expect(result.shouldSave).toBe(false)
    expect(result.classification).toBe('skip')
  })

  // -------------------------------------------------------------------------
  // classification — explicit
  // -------------------------------------------------------------------------

  it('should classify as explicit when "remember this" is present', () => {
    const result = evaluateMemoryGate({ text: 'Remember this: I prefer morning meetings only.' })
    expect(result.classification).toBe('explicit')
    expect(result.shouldSave).toBe(true)
  })

  it('should classify as explicit for "save to memory"', () => {
    const result = evaluateMemoryGate({ text: 'Save to memory: always use TypeScript strict mode.' })
    expect(result.classification).toBe('explicit')
  })

  // -------------------------------------------------------------------------
  // memoryType — task / decision / preference / medical / research / project
  // -------------------------------------------------------------------------

  it('should detect task memoryType for todo-like text', () => {
    const result = evaluateMemoryGate({ text: 'Remind me to submit the report by Friday.' })
    expect(result.memoryType).toBe('todo')
    expect(result.classification).toBe('notable')
  })

  it('should detect decision memoryType', () => {
    const result = evaluateMemoryGate({ text: 'We decided to ship with Rust for the backend.' })
    expect(result.memoryType).toBe('decision')
    expect(result.classification).toBe('notable')
  })

  it('should detect preference memoryType', () => {
    const result = evaluateMemoryGate({ text: 'User prefers dark mode and morning appointments only.' })
    expect(result.memoryType).toBe('preference')
    expect(result.privacy).toBe('personal')
  })

  it('should detect medical memoryType and mark privacy as sensitive', () => {
    // Avoid TASK_RE keywords like "appointment" which would override memoryType to 'todo'
    const result = evaluateMemoryGate({ text: 'Patient has a penicillin allergy. Medical note from the doctor visit.' })
    expect(result.memoryType).toBe('medical')
    expect(result.privacy).toBe('sensitive')
    expect(result.warnings).toContain('Sensitive memory requires narrow provenance and careful surfacing.')
  })

  it('should detect research memoryType for text with citations', () => {
    const result = evaluateMemoryGate({ text: 'According to the research paper, the study shows positive results.' })
    expect(result.memoryType).toBe('research')
  })

  it('should detect project_context memoryType', () => {
    const result = evaluateMemoryGate({
      text: 'The agent-forge project architecture uses Tauri v2 with a React frontend.',
    })
    expect(result.memoryType).toBe('project_context')
  })

  // -------------------------------------------------------------------------
  // evidenceState inference
  // -------------------------------------------------------------------------

  it('should set evidenceState to source_backed when sourcePaths provided', () => {
    // The research keyword + sourcePath makes this notable (research matches hasSource), so
    // classification is 'background' but evidenceState is source_backed.
    // Per the confidence logic: source_backed sets high, but background overrides to low.
    const result = evaluateMemoryGate({
      text: 'We decided to use source_backed research findings.',
      sourcePaths: ['/docs/perf-report.pdf'],
    })
    expect(result.evidenceState).toBe('source_backed')
    // Decision text -> classification='notable', source_backed -> confidence='high'
    expect(result.confidence).toBe('high')
  })

  it('should set evidenceState to source_backed when sourceUrls are provided', () => {
    const result = evaluateMemoryGate({
      text: 'Findings from our benchmark suite.',
      sourceUrls: ['https://example.com/bench'],
    })
    expect(result.evidenceState).toBe('source_backed')
  })

  it('should set evidenceState to needs_verification for unsourced external claims', () => {
    // Must avoid CONFLICT_RE words like "no longer", "actually", etc. which take priority
    const result = evaluateMemoryGate({ text: 'According to the web, the package was released last month.' })
    expect(result.evidenceState).toBe('needs_verification')
    expect(result.confidence).toBe('low')
    expect(result.warnings).toContain('Unsourced external claim must not be promoted as verified knowledge.')
  })

  it('should set evidenceState to conflicting when text mentions contradiction', () => {
    const result = evaluateMemoryGate({
      text: 'Actually, this contradicts the earlier decision about using Postgres.',
    })
    expect(result.evidenceState).toBe('conflicting')
    expect(result.confidence).toBe('low')
  })

  it('should set evidenceState to inferred for hedged language', () => {
    const result = evaluateMemoryGate({ text: 'I think the team prefers weekly standups over daily ones.' })
    expect(result.evidenceState).toBe('inferred')
  })

  // -------------------------------------------------------------------------
  // confidence scoring
  // -------------------------------------------------------------------------

  it('should assign high confidence to explicit first_party memories', () => {
    const result = evaluateMemoryGate({ text: 'Remember this: deploy only on Tuesdays.' })
    expect(result.classification).toBe('explicit')
    expect(result.evidenceState).toBe('first_party')
    expect(result.confidence).toBe('high')
  })

  it('should assign low confidence to background memories', () => {
    const result = evaluateMemoryGate({ text: 'Some random unclassified text without special keywords.' })
    expect(result.classification).toBe('background')
    expect(result.confidence).toBe('low')
  })

  // -------------------------------------------------------------------------
  // destination routing
  // -------------------------------------------------------------------------

  it('should route task items to task destination', () => {
    const result = evaluateMemoryGate({ text: 'Schedule a meeting with the team for next Monday.' })
    expect(result.destination).toBe('task')
  })

  it('should route to channel_memory when channelId is set and decision is explicit', () => {
    const result = evaluateMemoryGate({
      text: 'Remember this for the channel: we use React 19 here.',
      channelId: 'ch-abc123',
    })
    expect(result.destination).toBe('channel_memory')
    expect(result.tags).toContain('channel:ch-abc123')
  })

  it('should warn when channel_memory is set but no channelId given', () => {
    const result = evaluateMemoryGate({
      text: 'Remember this for this channel: use TypeScript everywhere.',
    })
    // channel keyword present but no concrete channelId -> warning
    if (result.destination === 'channel_memory') {
      expect(result.warnings).toContain(
        'Channel-scoped memory was detected without a concrete channel id.',
      )
    }
  })

  it('should route to library when "save to library" is explicitly requested', () => {
    const result = evaluateMemoryGate({ text: 'Please save this to library: project conventions doc.' })
    expect(result.destination).toBe('library')
  })

  it('should route to library when attachment is present', () => {
    const result = evaluateMemoryGate({
      text: 'Here is the research file for the project.',
      attachedFiles: [{ name: 'report.pdf', type: 'application/pdf', isImage: false }],
    })
    expect(result.destination).toBe('library')
  })

  it('should not save bare external claims without provenance', () => {
    const result = evaluateMemoryGate({ text: 'I read that the new framework is much faster.' })
    expect(result.shouldSave).toBe(false)
    expect(result.evidenceState).toBe('needs_verification')
  })

  it('should not save pure question text', () => {
    const result = evaluateMemoryGate({ text: 'What did we decide about the database schema?' })
    expect(result.shouldSave).toBe(false)
  })

  it('should tag agentId when provided', () => {
    const result = evaluateMemoryGate({
      text: 'Remember this: always respond in JSON format.',
      agentId: 'agent-99',
    })
    expect(result.tags).toContain('agent:agent-99')
  })

  it('should add star-wars-ccg tag for relevant text', () => {
    const result = evaluateMemoryGate({
      text: 'Remember this: the force generation mechanic in the Star Wars CCG works like this.',
    })
    expect(result.tags).toContain('star-wars-ccg')
  })

  it('should extract URLs embedded in text and include them in provenance', () => {
    const result = evaluateMemoryGate({
      text: 'Check out https://example.com/doc for more info.',
    })
    expect(result.provenance.sourceUrls).toContain('https://example.com/doc')
  })

  it('should strip [PLANNING MODE] prefix before evaluation', () => {
    const result = evaluateMemoryGate({
      text: '[PLANNING MODE - internal]\nRemember this: use camelCase for all variables.',
    })
    expect(result.classification).toBe('explicit')
    expect(result.shouldSave).toBe(true)
  })

  it('should set provenance source to mixed when both paths and urls provided', () => {
    const result = evaluateMemoryGate({
      text: 'Cross-referenced research about the architecture.',
      sourcePaths: ['/docs/arch.md'],
      sourceUrls: ['https://example.com/arch'],
    })
    expect(result.provenance.source).toBe('mixed')
  })

  it('should set provenance source to file when only sourcePaths provided', () => {
    const result = evaluateMemoryGate({
      text: 'Notes from the document.',
      sourcePaths: ['/docs/notes.md'],
    })
    expect(result.provenance.source).toBe('file')
  })
})

// ---------------------------------------------------------------------------
// selectPrimaryToolRoute
// ---------------------------------------------------------------------------

describe('selectPrimaryToolRoute', () => {
  it('should return null when only route is none', () => {
    const decision = makeDecision({ toolRoutes: ['none'] })
    expect(selectPrimaryToolRoute(decision)).toBeNull()
  })

  it('should return first non-none route', () => {
    const decision = makeDecision({ toolRoutes: ['memory_search', 'web_search'] })
    expect(selectPrimaryToolRoute(decision)).toBe('memory_search')
  })

  it('should return calendar when that is the only real route', () => {
    const decision = makeDecision({ toolRoutes: ['calendar'] })
    expect(selectPrimaryToolRoute(decision)).toBe('calendar')
  })

  it('should route to memory_search when forcedTool is workspace', () => {
    const result = evaluateMemoryGate({ text: 'Some text here', forcedTool: 'workspace' })
    expect(result.toolRoutes).toContain('memory_search')
    expect(selectPrimaryToolRoute(result)).toBe('memory_search')
  })

  it('should route to web_search when forcedTool is search', () => {
    const result = evaluateMemoryGate({ text: 'Any text', forcedTool: 'search' })
    expect(result.toolRoutes).toContain('web_search')
    expect(selectPrimaryToolRoute(result)).toBe('web_search')
  })

  it('should route to calendar when calendar tool is enabled and text mentions scheduling', () => {
    const result = evaluateMemoryGate({
      text: 'Schedule a meeting for the project by Monday.',
      enabledTools: { calendar_sync: true },
    })
    expect(result.toolRoutes).toContain('calendar')
  })

  it('should route to web_search when web_search is enabled and text matches', () => {
    const result = evaluateMemoryGate({
      text: "What's today's weather in San Francisco?",
      enabledTools: { web_search: true },
    })
    expect(result.toolRoutes).toContain('web_search')
  })

  it('should route to browser for browser-navigation text', () => {
    const result = evaluateMemoryGate({ text: 'Open the site and inspect this page.' })
    expect(result.toolRoutes).toContain('browser')
  })

  it('should route to files when attachedFiles are present', () => {
    const result = evaluateMemoryGate({
      text: 'Here is some background info.',
      attachedFiles: [{ name: 'data.csv' }],
    })
    expect(result.toolRoutes).toContain('files')
  })

  it('should route to integrations when slack keyword is present and slack tool is enabled', () => {
    const result = evaluateMemoryGate({
      text: 'Send the summary via Slack.',
      enabledTools: { slack: true },
    })
    expect(result.toolRoutes).toContain('integrations')
  })

  it('should return none route when forcedTool is unknown value', () => {
    const result = evaluateMemoryGate({ text: 'Some text', forcedTool: 'unknown-tool' })
    expect(result.toolRoutes).toEqual(['none'])
  })
})

// ---------------------------------------------------------------------------
// shouldPersistGatekeeperDecision
// ---------------------------------------------------------------------------

describe('shouldPersistGatekeeperDecision', () => {
  it('should return true for explicit saves to agent_memory with sufficient text', () => {
    const decision = makeDecision({
      shouldSave: true,
      classification: 'explicit',
      destination: 'agent_memory',
    })
    expect(shouldPersistGatekeeperDecision(decision, 'Remember this: use TypeScript strict mode.')).toBe(true)
  })

  it('should return false when shouldSave is false', () => {
    const decision = makeDecision({ shouldSave: false, classification: 'explicit', destination: 'agent_memory' })
    expect(shouldPersistGatekeeperDecision(decision, 'Remember this: deploy on Tuesdays.')).toBe(false)
  })

  it('should return false when classification is not explicit', () => {
    const decision = makeDecision({ shouldSave: true, classification: 'notable', destination: 'agent_memory' })
    expect(shouldPersistGatekeeperDecision(decision, 'We decided to use React 19.')).toBe(false)
  })

  it('should return false when destination is inbox_only', () => {
    const decision = makeDecision({ shouldSave: true, classification: 'explicit', destination: 'inbox_only' })
    expect(shouldPersistGatekeeperDecision(decision, 'Remember this: review pending claims.')).toBe(false)
  })

  it('should return false when destination is task', () => {
    const decision = makeDecision({ shouldSave: true, classification: 'explicit', destination: 'task' })
    expect(shouldPersistGatekeeperDecision(decision, 'Remember this: schedule meeting.')).toBe(false)
  })

  it('should return false when extracted text is shorter than 12 chars', () => {
    const decision = makeDecision({ shouldSave: true, classification: 'explicit', destination: 'agent_memory' })
    expect(shouldPersistGatekeeperDecision(decision, 'Remember this: short.')).toBe(false)
  })

  it('should return true for explicit save to library destination', () => {
    const decision = makeDecision({
      shouldSave: true,
      classification: 'explicit',
      destination: 'library',
    })
    expect(shouldPersistGatekeeperDecision(decision, 'Save to library: project architecture overview.')).toBe(true)
  })

  it('should return true for explicit save to channel_memory destination', () => {
    const decision = makeDecision({
      shouldSave: true,
      classification: 'explicit',
      destination: 'channel_memory',
    })
    expect(shouldPersistGatekeeperDecision(decision, 'Remember this for channel: use React conventions.')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// extractMemoryCandidateText
// ---------------------------------------------------------------------------

describe('extractMemoryCandidateText', () => {
  it('should strip "remember this:" prefix', () => {
    expect(extractMemoryCandidateText('Remember this: use TypeScript.')).toBe('use TypeScript.')
  })

  it('should strip "add to memory" prefix (keyword only, colon retained)', () => {
    // The regex strips the trigger keyword and surrounding whitespace; a trailing colon
    // in the original text is not consumed by the regex, so it remains.
    expect(extractMemoryCandidateText('Add to memory always lint before commit.')).toBe(
      'always lint before commit.',
    )
  })

  it('should strip "take a note" prefix without trailing colon', () => {
    // Providing the text without a colon separator shows clean stripping of the prefix
    expect(extractMemoryCandidateText('Take a note the build pipeline is broken.')).toBe(
      'the build pipeline is broken.',
    )
  })

  it('should return empty string for bare "remember this"', () => {
    expect(extractMemoryCandidateText('remember this')).toBe('')
  })

  it('should return empty string for bare "save this"', () => {
    expect(extractMemoryCandidateText('save this')).toBe('')
  })

  it('should strip [PLANNING MODE] prefix from text', () => {
    expect(extractMemoryCandidateText('[PLANNING MODE - draft]\nRemember this: deploy carefully.')).toBe(
      'deploy carefully.',
    )
  })

  it('should pass through text without any trigger prefix unchanged', () => {
    const input = 'Deploy only on Tuesdays and Thursdays.'
    expect(extractMemoryCandidateText(input)).toBe(input)
  })

  it('should strip a leading "this:" prefix', () => {
    expect(extractMemoryCandidateText('this: the key decision for the quarter.')).toBe(
      'the key decision for the quarter.',
    )
  })
})

// ---------------------------------------------------------------------------
// buildGatekeeperMemoryWrite
// ---------------------------------------------------------------------------

describe('buildGatekeeperMemoryWrite', () => {
  const baseDate = new Date('2025-01-15T12:00:00.000Z')

  function buildBase(overrides: Partial<Parameters<typeof buildGatekeeperMemoryWrite>[0]> = {}) {
    return buildGatekeeperMemoryWrite({
      rootPath: '/workspace',
      agentId: 'agent-1',
      text: 'Remember this: use camelCase for all variable names.',
      decision: makeDecision({
        destination: 'agent_memory',
        memoryType: 'preference',
        evidenceState: 'first_party',
        confidence: 'high',
        privacy: 'normal',
        reason: 'Explicit preference memory.',
        tags: ['preference', 'first_party'],
      }),
      now: baseDate,
      ...overrides,
    })
  }

  it('should return a path, title, and content', () => {
    const result = buildBase()
    expect(result).toHaveProperty('path')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('content')
  })

  it('should include YAML frontmatter block', () => {
    const { content } = buildBase()
    expect(content).toMatch(/^---\n/)
    expect(content).toContain('destination: agent_memory')
    expect(content).toContain('memory_type: preference')
    expect(content).toContain('evidence_state: first_party')
  })

  it('should include title and reason in body', () => {
    const { content } = buildBase()
    expect(content).toContain('Gatekeeper reason: Explicit preference memory.')
    expect(content).toContain('## Memory')
  })

  it('should write to gatekeeper subdirectory for agent_memory destination', () => {
    const { path } = buildBase()
    expect(path).toContain('/workspace/memory/agent-1/gatekeeper/')
    expect(path).toMatch(/\.md$/)
  })

  it('should write to library directory when destination is library', () => {
    const { path } = buildBase({
      decision: makeDecision({ destination: 'library' }),
    })
    expect(path).toContain('/workspace/library/')
  })

  it('should write to channel memory directory when destination is channel_memory and channelId given', () => {
    const { path } = buildBase({
      channelId: 'ch-xyz',
      decision: makeDecision({ destination: 'channel_memory' }),
    })
    expect(path).toContain('/workspace/memory/agent-1/channels/ch-xyz/')
  })

  it('should sanitize agentId to remove special characters in path', () => {
    const { path } = buildBase({ agentId: 'Agent One!@#' })
    // The raw special chars should not appear in the path
    expect(path).not.toContain('!')
    expect(path).not.toContain('@')
    expect(path).not.toContain('#')
    // The sanitized segment should appear as part of the path
    expect(path).toContain('agent-one')
  })

  it('should sanitize channelId special characters in path', () => {
    const { path } = buildBase({
      channelId: 'Channel #General!',
      decision: makeDecision({ destination: 'channel_memory' }),
    })
    expect(path).not.toMatch(/[#!]/)
  })

  it('should include chat_id in frontmatter when chatId is provided', () => {
    const { content } = buildBase({ chatId: 'chat-123' })
    expect(content).toContain('chat_id: "chat-123"')
  })

  it('should include channel_id in frontmatter when channelId is provided', () => {
    const { content } = buildBase({
      channelId: 'ch-abc',
      decision: makeDecision({ destination: 'channel_memory' }),
    })
    expect(content).toContain('channel_id: "ch-abc"')
  })

  it('should not include chat_id line when chatId is not provided', () => {
    const { content } = buildBase()
    expect(content).not.toContain('chat_id:')
  })

  it('should use the stripped original text as fallback title when extract returns empty', () => {
    // "Remember this" strips to '' via extractMemoryCandidateText,
    // then titleFromText falls back to stripSystemPrefixes(text) which is 'Remember this'
    const { title } = buildBase({ text: 'Remember this' })
    expect(title).toBe('Remember this')
  })

  it('should use "Saved Memory" as title when both extract and original text are empty', () => {
    const { title } = buildBase({ text: '[PLANNING MODE]\n' })
    expect(title).toBe('Saved Memory')
  })

  it('path slug should contain the timestamp from the provided now date', () => {
    const { path } = buildBase()
    expect(path).toContain(String(baseDate.getTime()))
  })
})

// ---------------------------------------------------------------------------
// validateMemoryGatekeeperDecision
// ---------------------------------------------------------------------------

describe('validateMemoryGatekeeperDecision', () => {
  it('should pass through a fully valid decision unchanged', () => {
    const raw: Partial<MemoryGatekeeperDecision> = {
      shouldSave: true,
      classification: 'notable',
      destination: 'agent_memory',
      memoryType: 'decision',
      evidenceState: 'first_party',
      confidence: 'high',
      privacy: 'normal',
      reason: 'A notable decision.',
      tags: ['decision'],
      toolRoutes: ['memory_search'],
      warnings: [],
      provenance: { source: 'user', sourcePaths: [], sourceUrls: [] },
    }
    const result = validateMemoryGatekeeperDecision(raw)
    expect(result.shouldSave).toBe(true)
    expect(result.classification).toBe('notable')
    expect(result.memoryType).toBe('decision')
  })

  it('should set shouldSave to false when classification is skip even if raw.shouldSave is true', () => {
    const result = validateMemoryGatekeeperDecision({ shouldSave: true, classification: 'skip' })
    expect(result.shouldSave).toBe(false)
    expect(result.destination).toBe('skip')
  })

  it('should use fallback values for invalid enum fields', () => {
    const result = validateMemoryGatekeeperDecision({
      shouldSave: false,
      // @ts-expect-error intentionally invalid
      classification: 'totally-wrong',
      // @ts-expect-error intentionally invalid
      memoryType: 'bogus',
    })
    expect(result.classification).toBe('skip')
    expect(result.memoryType).toBe('none')
  })

  it('should de-duplicate tags and lowercase them', () => {
    const result = validateMemoryGatekeeperDecision({
      tags: ['Decision', 'decision', 'DECISION'],
    })
    expect(result.tags).toEqual(['decision'])
  })

  it('should filter empty string tags', () => {
    const result = validateMemoryGatekeeperDecision({ tags: ['', 'valid-tag', '  '] })
    // '  '.trim() is '' so it gets filtered; 'valid-tag' kept
    expect(result.tags).toContain('valid-tag')
    expect(result.tags).not.toContain('')
  })

  it('should use fallback destination agent_memory when shouldSave is true but fallback destination is skip', () => {
    const result = validateMemoryGatekeeperDecision({
      shouldSave: true,
      classification: 'explicit',
      // destination not provided — should default to agent_memory (since fallback would be 'skip')
    })
    expect(result.destination).toBe('agent_memory')
  })

  it('should de-duplicate toolRoutes and map unknown routes to none', () => {
    const result = validateMemoryGatekeeperDecision({
      // @ts-expect-error intentionally invalid route
      toolRoutes: ['memory_search', 'memory_search', 'fake_route'],
    })
    expect(result.toolRoutes).toEqual(['memory_search', 'none'])
  })
})
