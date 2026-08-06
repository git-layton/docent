import { describe, it, expect } from 'vitest'
import {
  assessSufficiency,
  shouldOfferToRead,
  contentTerms,
  COVERAGE_FLOOR,
} from '../../services/sufficiency'
import type { Block } from '../../services/provenance'

const read = (text: string, sourcePath: string): Block =>
  ({ origin: 'read', text, sourcePath, quote: text.slice(0, 40) })

const generated = (text: string): Block => ({ origin: 'generated', text })

const observed = (text: string): Block =>
  ({ origin: 'observed', text, frameId: 'f1', seenAt: 1_800_000_000_000 })

// ---------------------------------------------------------------------------
// The strongest signal: nothing to stand on
// ---------------------------------------------------------------------------

describe('assessSufficiency — nothing grounded', () => {
  it('is insufficient when every passage is model output', () => {
    // The documented failure: context RAISES confidence, so a model handed ungrounded
    // context hallucinates more than one handed none.
    const v = assessSufficiency({
      query: 'what does our trust model say about untrusted content',
      passages: [
        generated('The trust model escalates writes when untrusted content is ingested.'),
        generated('Untrusted content includes viewed pages and received mail.'),
      ],
    })
    expect(v.level).toBe('insufficient')
    expect(v.groundedPassages).toBe(0)
    expect(shouldOfferToRead(v)).toBe(true)
  })

  it('is insufficient with no passages at all', () => {
    expect(assessSufficiency({ query: 'prompt injection defenses', passages: [] }).level)
      .toBe('insufficient')
  })

  it('does NOT count observed passages as standing ground', () => {
    // Seeing a page is evidence of what you looked at, never that it is true.
    const v = assessSufficiency({
      query: 'prompt injection defenses',
      passages: [observed('prompt injection defenses overview page')],
    })
    expect(v.level).toBe('insufficient')
    expect(v.groundedPassages).toBe(0)
  })

  it('tells the model to label its own knowledge rather than pass it off as sourced', () => {
    const v = assessSufficiency({ query: 'capability security', passages: [] })
    expect(v.directive).toContain('INSUFFICIENT')
    expect(v.directive.toLowerCase()).toContain('your own general knowledge')
  })
})

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe('assessSufficiency — term coverage', () => {
  it('is insufficient when retrieval missed the subject entirely', () => {
    const v = assessSufficiency({
      query: 'flash attention quantization throughput on metal',
      passages: [read('The trust model escalates writes after untrusted input.', 'trust.md')],
    })
    expect(v.termCoverage).toBeLessThan(COVERAGE_FLOOR)
    expect(v.level).toBe('insufficient')
  })

  it('treats a query with no content words as fully covered', () => {
    // "thanks" asks for nothing, so nothing is missing — coverage 0 would be a false alarm.
    const v = assessSufficiency({
      query: 'thanks!',
      passages: [read('Some grounded passage here about things.', 'a.md'), read('Another one.', 'b.md')],
    })
    expect(v.termCoverage).toBe(1)
    expect(v.level).toBe('sufficient')
  })

  it('ignores stopwords when computing coverage', () => {
    expect(contentTerms('what is the deal with the prompt injection thing'))
      .toEqual(expect.arrayContaining(['deal', 'prompt', 'injection', 'thing']))
    expect(contentTerms('what is the')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Thin
// ---------------------------------------------------------------------------

describe('assessSufficiency — thin', () => {
  it('flags a single-source answer as thin, not settled', () => {
    const v = assessSufficiency({
      query: 'prompt injection escalation',
      passages: [read('Prompt injection escalation happens when untrusted content is ingested.', 'trust.md')],
    })
    expect(v.level).toBe('thin')
    expect(v.distinctSources).toBe(1)
    expect(v.directive).toContain('single-source')
  })

  it('flags entities the map does not hold, and names them', () => {
    const v = assessSufficiency({
      query: 'how does prompt injection relate to capability security',
      passages: [
        read('Prompt injection relates to how untrusted content reaches a model.', 'trust.md'),
        read('Injection escalates writes to approval in this design.', 'agentc.md'),
      ],
      entitiesMissing: ['capability security'],
    })
    expect(v.level).toBe('thin')
    expect(v.detail).toContain('capability security')
    expect(v.directive).toContain('capability security')
  })

  it('tells the model to name the gap rather than fill it', () => {
    const v = assessSufficiency({
      query: 'prompt injection escalation',
      passages: [read('Prompt injection escalation is covered by the trust model.', 'trust.md')],
    })
    expect(v.directive).toContain('THIN')
    expect(v.directive.toLowerCase()).toContain('say what is missing')
  })
})

// ---------------------------------------------------------------------------
// Sufficient
// ---------------------------------------------------------------------------

describe('assessSufficiency — sufficient', () => {
  it('passes when several sources cover the question', () => {
    const v = assessSufficiency({
      query: 'prompt injection escalation approval',
      passages: [
        read('Prompt injection escalation forces approval on writes.', 'trust.md'),
        read('Approval gates cover escalation for injection cases.', 'agentc.md'),
        read('Escalation and approval are the two halves of the injection defense.', 'owasp.md'),
      ],
    })
    expect(v.level).toBe('sufficient')
    expect(v.distinctSources).toBe(3)
    expect(shouldOfferToRead(v)).toBe(false)
  })

  it('still tells the model not to backfill uncovered parts from memory', () => {
    const v = assessSufficiency({
      query: 'prompt injection escalation approval',
      passages: [
        read('Prompt injection escalation forces approval on writes.', 'trust.md'),
        read('Approval gates cover escalation for injection cases.', 'agentc.md'),
      ],
    })
    expect(v.directive.toLowerCase()).toContain('rather than supplying it from memory')
  })

  it('counts distinct sources, not passages', () => {
    const v = assessSufficiency({
      query: 'prompt injection escalation approval',
      passages: [
        read('Prompt injection escalation forces approval.', 'trust.md'),
        read('Approval covers injection escalation too.', 'trust.md'),
      ],
    })
    expect(v.groundedPassages).toBe(2)
    expect(v.distinctSources).toBe(1)
    expect(v.level).toBe('thin')
  })
})

// ---------------------------------------------------------------------------
// Every verdict must be actionable
// ---------------------------------------------------------------------------

describe('assessSufficiency — contract', () => {
  it('always emits a non-empty directive, because a verdict nothing reads is decoration', () => {
    const cases: Array<Parameters<typeof assessSufficiency>[0]> = [
      { query: 'x y z', passages: [] },
      { query: 'prompt injection', passages: [read('Prompt injection is a risk.', 'a.md')] },
      { query: 'prompt injection', passages: [read('Prompt injection is a risk.', 'a.md'), read('Injection prompt risk.', 'b.md')] },
    ]
    for (const c of cases) {
      const v = assessSufficiency(c)
      expect(v.directive.length).toBeGreaterThan(20)
      expect(v.detail.length).toBeGreaterThan(0)
    }
  })

  it('never throws on malformed input', () => {
    expect(() => assessSufficiency({ query: '', passages: [] })).not.toThrow()
    expect(() => assessSufficiency({
      query: undefined as unknown as string,
      passages: undefined as unknown as Block[],
    })).not.toThrow()
  })
})
