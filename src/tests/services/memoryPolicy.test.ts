import { describe, it, expect } from 'vitest'
import {
  assessConversationMemory,
  validateConversationMemoryAssessment,
  type ConversationMemoryAssessment,
} from '../../services/memoryPolicy'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid assessment for validateConversationMemoryAssessment tests */
const makeAssessment = (overrides: Partial<ConversationMemoryAssessment> = {}): ConversationMemoryAssessment => ({
  shouldSave: false,
  level: 'skip',
  notification: 'none',
  reason: 'trivial acknowledgement',
  tags: ['conversation', 'agent-memory'],
  score: -5,
  ...overrides,
})

// ---------------------------------------------------------------------------
// assessConversationMemory
// ---------------------------------------------------------------------------

describe('assessConversationMemory', () => {
  // ── trivial / skip path ──────────────────────────────────────────────────

  it('should return skip for a trivial acknowledgement (ok)', () => {
    const result = assessConversationMemory({ question: 'ok', answer: 'Sure thing.' })
    expect(result.shouldSave).toBe(false)
    expect(result.level).toBe('skip')
    expect(result.notification).toBe('none')
    expect(result.reason).toBe('trivial acknowledgement')
  })

  it('should return skip for "thanks" with a short answer', () => {
    const result = assessConversationMemory({ question: 'thanks', answer: 'No problem.' })
    expect(result.shouldSave).toBe(false)
    expect(result.level).toBe('skip')
  })

  it('should return skip for "sounds good" with a short answer', () => {
    const result = assessConversationMemory({ question: 'sounds good', answer: 'Great.' })
    expect(result.shouldSave).toBe(false)
    expect(result.level).toBe('skip')
  })

  it('should return skip when score is below 3 with no special signals', () => {
    // Short, no-signal question; short answer — total score stays below 3
    const result = assessConversationMemory({ question: 'hi there', answer: 'Hello!' })
    expect(result.shouldSave).toBe(false)
    expect(result.level).toBe('skip')
    expect(result.reason).toBe('not enough durable signal')
  })

  it('should return skip for a silly/casual exchange (lol)', () => {
    const result = assessConversationMemory({
      question: 'lol that was funny',
      answer: 'Ha yes pretty funny indeed.',
    })
    expect(result.shouldSave).toBe(false)
    expect(result.level).toBe('skip')
    expect(result.reason).toBe('low-value casual exchange')
  })

  it('should not return skip for trivial question when answer is long (≥80 words) and has durable signal', () => {
    // trivial guard: hasAny(q, trivialPatterns) && aWords < 80 && !hasAttachments
    // With aWords ≥ 80, trivial=false. We also need enough score to save:
    // "implemented" in answer (+2) + 180-word bonus (+1) = 3 → background
    const longAnswer = `implemented the feature. ${Array(182).fill('word').join(' ')}`
    const result = assessConversationMemory({ question: 'ok', answer: longAnswer })
    expect(result.level).not.toBe('skip')
    expect(result.shouldSave).toBe(true)
  })

  it('should strip <think> blocks from answer word count', () => {
    // The think block has 200+ words; visible answer is short.  No durable signal.
    const thinkBlock = `<think>${Array(200).fill('internal thought').join(' ')}</think>`
    const result = assessConversationMemory({
      question: 'hi',
      answer: `${thinkBlock} Sure.`,
    })
    // Visible word count is tiny, no durable signal → skip
    expect(result.level).toBe('skip')
  })

  // ── background path ──────────────────────────────────────────────────────

  it('should return background for a moderate durable user signal without being notable', () => {
    // "i prefer" (+2) + "implemented" durableAnswerPattern (+2) = 4 → background (< 7, not notable)
    const result = assessConversationMemory({
      question: 'i prefer dark mode',
      answer: 'I implemented dark mode support.',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('background')
    expect(result.notification).toBe('none')
    expect(result.tags).toContain('memory-background')
    expect(result.tags).toContain('durable-user-signal')
  })

  it('should return background for a project-related exchange', () => {
    // "project" hits durableUserPatterns (+3); "implemented" hits durableAnswerPatterns (+2) → score 5 → background
    const result = assessConversationMemory({
      question: 'how is the project going?',
      answer: 'I implemented the feature successfully.',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('background')
    expect(result.notification).toBe('none')
  })

  // ── notable path ─────────────────────────────────────────────────────────

  it('should return notable when score ≥ 7 without explicit memory keyword', () => {
    // "i prefer" (+3) + "implemented" (+2) + channel kind (+1) + "multi-agent" (+3) = 9 → notable
    const result = assessConversationMemory({
      question: 'i prefer this workflow',
      answer: 'implemented and pushed the changes.',
      chatKind: 'channel',
      contributions: ['agent-b'],
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('notable')
    expect(result.notification).toBe('toast')
    expect(result.tags).toContain('memory-notable')
  })

  it('should return notable with score ≥ 7 via attachment + durable signals', () => {
    // "i prefer" (+2) + image attachment (+4) + channel kind (+1) = 7 → notable
    const result = assessConversationMemory({
      question: 'i prefer this layout',
      answer: 'Here is the screenshot.',
      attachments: [{ isImage: true }],
      chatKind: 'channel',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('notable')
    expect(result.tags).toContain('multimodal-input')
  })

  // ── explicit path ─────────────────────────────────────────────────────────

  it('should return explicit for "remember this" in the question', () => {
    const result = assessConversationMemory({
      question: 'remember this: always use tabs for indentation',
      answer: 'Got it, I will remember.',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('explicit')
    expect(result.notification).toBe('toast')
    expect(result.tags).toContain('explicit-memory')
    expect(result.tags).toContain('memory-explicit')
  })

  it('should return explicit for "save this" keyword', () => {
    const result = assessConversationMemory({
      question: 'save this for later reference',
      answer: 'Saved.',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('explicit')
  })

  it('should return explicit for "don\'t forget" keyword', () => {
    const result = assessConversationMemory({
      question: "don't forget my API key expires on Monday",
      answer: 'Noted.',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('explicit')
    expect(result.tags).toContain('explicit-memory')
  })

  it('should return explicit for "always remember" behavioural instruction', () => {
    const result = assessConversationMemory({
      question: 'always remember to use TypeScript strict mode',
      answer: 'Will do.',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('explicit')
  })

  it('should return explicit even if silly patterns are present when explicitMemory is true', () => {
    // "lol" would normally cause silly score penalty, but explicit overrides
    const result = assessConversationMemory({
      question: 'lol remember this important note about the API',
      answer: 'Sure.',
    })
    expect(result.shouldSave).toBe(true)
    expect(result.level).toBe('explicit')
  })

  // ── tag generation ────────────────────────────────────────────────────────

  it('should always include "conversation" tag', () => {
    const result = assessConversationMemory({ question: 'ok', answer: 'yes' })
    expect(result.tags).toContain('conversation')
  })

  it('should include "agent-memory" tag for default dm chatKind', () => {
    const result = assessConversationMemory({ question: 'ok', answer: 'yes' })
    expect(result.tags).toContain('agent-memory')
    expect(result.tags).not.toContain('channel-memory')
  })

  it('should include "channel-memory" tag for channel chatKind', () => {
    const result = assessConversationMemory({
      question: 'remember this',
      answer: 'Noted.',
      chatKind: 'channel',
    })
    expect(result.tags).toContain('channel-memory')
    expect(result.tags).not.toContain('agent-memory')
  })

  it('should include "multi-agent" tag when contributions are provided', () => {
    const result = assessConversationMemory({
      question: 'remember this decision',
      answer: 'Noted.',
      contributions: ['agent-a', 'agent-b'],
    })
    expect(result.tags).toContain('multi-agent')
  })

  it('should produce deduplicated tags — no duplicate entries', () => {
    // Trigger many paths that could overlap
    const result = assessConversationMemory({
      question: 'remember this: i prefer tabs, project setup, api key',
      answer: 'implemented and verified.',
      contributions: ['agent-x'],
      attachments: [{ isImage: false }],
    })
    const tagSet = new Set(result.tags)
    expect(tagSet.size).toBe(result.tags.length)
  })

  // ── score word-count bonuses ───────────────────────────────────────────────

  it('should grant +1 score bonus when question has ≥18 words', () => {
    // Short question (< 18 words) with "i prefer" gets score 3.
    // Same content padded to exactly 18 words should get score 4 (the +1 bonus).
    // "i prefer dark mode" = 4 words (score 3, no word-count bonus)
    // Adding 14 filler words brings it to 18 (score 4, +1 bonus applied)
    const shortQ = 'i prefer dark mode'
    const longQ = 'i prefer dark mode over light mode as it is much easier on my eyes all day long'
    // Verify word count: i(1) prefer(2) dark(3) mode(4) over(5) light(6) mode(7) as(8) it(9) is(10)
    //                    much(11) easier(12) on(13) my(14) eyes(15) all(16) day(17) long(18)
    const short = assessConversationMemory({ question: shortQ, answer: 'ok' })
    const long = assessConversationMemory({ question: longQ, answer: 'ok' })
    expect(long.score).toBe(short.score + 1)
  })

  it('should grant +1 when answer has ≥180 words', () => {
    const longAnswer = `I implemented the feature. ${Array(180).fill('word').join(' ')}`
    // "implemented" (+2) + 180 words (+1) = 3 → background
    const result = assessConversationMemory({ question: 'how did it go?', answer: longAnswer })
    expect(result.shouldSave).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(3)
  })

  it('should grant +2 when answer has ≥450 words (180 bonus + 450 bonus)', () => {
    const veryLongAnswer = `plan and architecture here. ${Array(455).fill('word').join(' ')}`
    // "plan" (+2) + 180-word bonus (+1) + 450-word bonus (+1) = 4 → background
    const result = assessConversationMemory({ question: 'explain everything', answer: veryLongAnswer })
    expect(result.shouldSave).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(4)
  })

  // ── attachment handling ────────────────────────────────────────────────────

  it('should add "attached-context" tag for non-image attachments', () => {
    const result = assessConversationMemory({
      question: 'i prefer this document format',
      answer: 'Noted.',
      attachments: [{ isImage: false }],
    })
    expect(result.tags).toContain('attached-context')
    expect(result.tags).not.toContain('multimodal-input')
  })

  it('should add "multimodal-input" tag for image attachments', () => {
    const result = assessConversationMemory({
      question: 'i prefer this layout',
      answer: 'Here you go.',
      attachments: [{ isImage: true }],
    })
    expect(result.tags).toContain('multimodal-input')
    expect(result.tags).not.toContain('attached-context')
  })

  it('should prevent trivial guard when attachments are present', () => {
    // "ok" would normally be trivial, but attachment disables the trivial check
    const result = assessConversationMemory({
      question: 'ok',
      answer: 'Done.',
      attachments: [{ isImage: false }],
    })
    // "ok" + attachment means trivial=false (hasAttachments prevents it).
    // score: attached-context (+3) = 3 → background
    expect(result.level).not.toBe('skip')
    expect(result.shouldSave).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validateConversationMemoryAssessment
// ---------------------------------------------------------------------------

describe('validateConversationMemoryAssessment', () => {
  it('should return no errors for a valid skip assessment', () => {
    const assessment = makeAssessment()
    expect(validateConversationMemoryAssessment(assessment)).toEqual([])
  })

  it('should return no errors for a valid background save', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'background',
      notification: 'none',
      reason: 'durable user/project signal',
      tags: ['conversation', 'agent-memory', 'durable-user-signal', 'memory-background'],
      score: 3,
    })
    expect(validateConversationMemoryAssessment(assessment)).toEqual([])
  })

  it('should return no errors for a valid notable save', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'notable',
      notification: 'toast',
      reason: 'multi-agent collaboration',
      tags: ['conversation', 'agent-memory', 'multi-agent', 'memory-notable'],
      score: 7,
    })
    expect(validateConversationMemoryAssessment(assessment)).toEqual([])
  })

  it('should return no errors for a valid explicit save', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'explicit',
      notification: 'toast',
      reason: 'explicit memory request',
      tags: ['conversation', 'agent-memory', 'explicit-memory', 'memory-explicit'],
      score: 10,
    })
    expect(validateConversationMemoryAssessment(assessment)).toEqual([])
  })

  it('should error on unknown level', () => {
    const assessment = makeAssessment({ level: 'unknown' as any })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Unknown memory level'))).toBe(true)
  })

  it('should error on unknown notification', () => {
    const assessment = makeAssessment({ notification: 'sms' as any })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Unknown memory notification'))).toBe(true)
  })

  it('should error when score is not finite (NaN)', () => {
    const assessment = makeAssessment({ score: NaN })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Score must be finite'))).toBe(true)
  })

  it('should error when score is Infinity', () => {
    const assessment = makeAssessment({ score: Infinity })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Score must be finite'))).toBe(true)
  })

  it('should error when reason is empty', () => {
    const assessment = makeAssessment({ reason: '   ' })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Reason is required'))).toBe(true)
  })

  it('should error when tags array is empty', () => {
    const assessment = makeAssessment({ tags: [] })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('At least one tag is required'))).toBe(true)
  })

  it('should error when tags contain duplicates', () => {
    const assessment = makeAssessment({ tags: ['conversation', 'conversation'] })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Tags must be unique'))).toBe(true)
  })

  it('should error when a tag contains whitespace', () => {
    const assessment = makeAssessment({ tags: ['conversation', 'bad tag'] })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('non-empty slug tokens'))).toBe(true)
  })

  it('should error when a tag is an empty string', () => {
    const assessment = makeAssessment({ tags: ['conversation', ''] })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('non-empty slug tokens'))).toBe(true)
  })

  it('should error when shouldSave is false but level is not skip', () => {
    const assessment = makeAssessment({ shouldSave: false, level: 'background' })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Skipped memories must use level "skip"'))).toBe(true)
  })

  it('should error when shouldSave is false but notification is toast', () => {
    const assessment = makeAssessment({ shouldSave: false, level: 'skip', notification: 'toast' })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Skipped memories must not notify'))).toBe(true)
  })

  it('should error when shouldSave is false but tags include a memory- level tag', () => {
    const assessment = makeAssessment({ tags: ['conversation', 'memory-background'] })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Skipped memories must not include persisted memory level tags'))).toBe(true)
  })

  it('should error when shouldSave is true but level is skip', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'skip',
      notification: 'none',
      tags: ['conversation', 'agent-memory'],
    })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Saved memories cannot use level "skip"'))).toBe(true)
  })

  it('should error when saved memory is missing its memory-level tag', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'background',
      notification: 'none',
      tags: ['conversation', 'agent-memory'],
      score: 3,
    })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('memory-background'))).toBe(true)
  })

  it('should error when background save uses toast notification', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'background',
      notification: 'toast',
      tags: ['conversation', 'agent-memory', 'memory-background'],
      score: 3,
    })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Background saves must be silent'))).toBe(true)
  })

  it('should error when notable save uses none notification', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'notable',
      notification: 'none',
      tags: ['conversation', 'agent-memory', 'memory-notable'],
      score: 7,
    })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Explicit and notable saves must use a toast notification'))).toBe(true)
  })

  it('should error when explicit save is missing explicit-memory tag', () => {
    const assessment = makeAssessment({
      shouldSave: true,
      level: 'explicit',
      notification: 'toast',
      tags: ['conversation', 'agent-memory', 'memory-explicit'],
      score: 10,
    })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.some(e => e.includes('Explicit memories must include explicit-memory tag'))).toBe(true)
  })

  it('should return multiple errors at once when several fields are invalid', () => {
    const assessment = makeAssessment({
      level: 'unknown' as any,
      notification: 'sms' as any,
      score: NaN,
      reason: '',
      tags: [],
    })
    const errors = validateConversationMemoryAssessment(assessment)
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })
})
