import { describe, it, expect } from 'vitest'
import {
  planResearch,
  shouldStop,
  nextQuestion,
  domainOf,
  diversityScore,
  isDominatedByOneDomain,
  describeOutcome,
  DEFAULT_BUDGET,
  ANGLES,
  type ResearchProgress,
} from '../../services/researchPlan'

const NOW = 1_800_000_000_000

const progress = (over: Partial<ResearchProgress> = {}): ResearchProgress => ({
  sourcesRead: 0,
  domains: [],
  groundedBlocks: 0,
  contestedFound: 0,
  asked: [],
  startedAt: NOW,
  now: NOW,
  ...over,
})

/** n sources across n distinct domains. */
const spread = (n: number) => Array.from({ length: n }, (_, i) => `site${i}.com`)

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

describe('planResearch', () => {
  it('produces angles built around the topic', () => {
    const plan = planResearch('prompt injection')
    expect(plan.questions.length).toBe(ANGLES.length)
    expect(plan.questions[0]).toContain('prompt injection')
  })

  it('fallback angles must generalise to ANY subject, not just products', () => {
    // The rejected-taxonomy trap, guarded: an earlier draft had "best practices" and "compared
    // to alternatives", which silently assumed the topic was a practice or a product and
    // produced nonsense like "grief best practices". Every fallback angle must read sensibly
    // for a feeling, an event, and a technology alike.
    for (const topic of ['grief', 'the French Revolution', 'prompt injection']) {
      for (const q of planResearch(topic).questions) {
        expect(q).not.toMatch(/best practices|compared to alternatives|recent developments/i)
        expect(q).toContain(topic)
      }
    }
  })

  it('ALWAYS includes a dissent angle', () => {
    // Without one, a run reads only sources that agree and `contested` provenance can never
    // be produced — the library would record every topic as settled.
    const plan = planResearch('prompt injection')
    expect(plan.questions.some(q => /criticism|limitations|problems/.test(q))).toBe(true)
  })

  it('prefers generated questions but still appends dissent', () => {
    // A model asked to research something reliably proposes angles that confirm it.
    const plan = planResearch('prompt injection', {
      questions: ['how do injection defenses work', 'who is researching this'],
    })
    expect(plan.questions).toContain('how do injection defenses work')
    expect(plan.questions.some(q => /criticism|limitations|problems/.test(q))).toBe(true)
  })

  it('deduplicates angles', () => {
    const plan = planResearch('x', { questions: ['same', 'SAME', 'other'] })
    expect(plan.questions.filter(q => q.toLowerCase() === 'same')).toHaveLength(1)
  })

  it('accepts a partial budget without losing the rest', () => {
    const plan = planResearch('x', { budget: { maxSources: 3 } })
    expect(plan.budget.maxSources).toBe(3)
    expect(plan.budget.minDistinctDomains).toBe(DEFAULT_BUDGET.minDistinctDomains)
  })
})

// ---------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------

describe('diversity', () => {
  it('extracts a domain and drops www', () => {
    expect(domainOf('https://www.Example.com/a/b?c=1')).toBe('example.com')
    expect(domainOf('not a url')).toBe('')
  })

  it('scores spread', () => {
    expect(diversityScore(['a.com', 'b.com', 'c.com'])).toBe(1)
    expect(diversityScore(['a.com', 'a.com', 'a.com'])).toBeCloseTo(1 / 3)
    expect(diversityScore([])).toBe(0)
  })

  it('detects one site dominating the run', () => {
    // The shape of retrieval collapse: reads as thorough, is a monoculture.
    expect(isDominatedByOneDomain(['a.com', 'a.com', 'a.com', 'b.com'])).toBe(true)
    expect(isDominatedByOneDomain(['a.com', 'b.com', 'c.com', 'd.com'])).toBe(false)
  })

  it('does not call domination on a run too small to judge', () => {
    expect(isDominatedByOneDomain(['a.com', 'a.com'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The stop predicate — decision ①
// ---------------------------------------------------------------------------

describe('shouldStop — ready is measured, not counted', () => {
  const plan = planResearch('prompt injection')

  it('continues while nothing has been read', () => {
    expect(shouldStop(plan, progress()).reason).toBe('continue')
  })

  it('is READY on enough sources, enough spread, and usable material', () => {
    const d = shouldStop(plan, progress({
      sourcesRead: 6, domains: spread(6), groundedBlocks: 6, asked: ['a'],
    }))
    expect(d.reason).toBe('ready')
    expect(d.detail).toContain('knowledge base on prompt injection is ready')
  })

  it('is NOT ready on source count alone when they all came from one place', () => {
    // Decision ②: diversity is a stop CONDITION, not a report line.
    const d = shouldStop(plan, progress({
      sourcesRead: 8,
      domains: ['a.com', 'a.com', 'a.com', 'a.com', 'a.com', 'a.com', 'b.com', 'c.com'],
      groundedBlocks: 8,
      asked: ['a'],
    }))
    expect(d.reason).not.toBe('ready')
  })

  it('is NOT ready when pages were read but nothing was quotable', () => {
    // A page count would report this as success. Ten pages digested into nothing is a failure.
    const d = shouldStop(plan, progress({
      sourcesRead: 8, domains: spread(8), groundedBlocks: 0, asked: ['a'],
    }))
    expect(d.reason).not.toBe('ready')
  })

  it('respects the source ceiling however unsatisfied it is', () => {
    const d = shouldStop(plan, progress({
      sourcesRead: DEFAULT_BUDGET.maxSources, domains: ['a.com'], groundedBlocks: 0,
    }))
    expect(d.reason).toBe('budget-sources')
    expect(d.stop).toBe(true)
  })

  it('respects the time ceiling', () => {
    const d = shouldStop(plan, progress({
      sourcesRead: 2, now: NOW + (DEFAULT_BUDGET.maxMinutes + 1) * 60000,
    }))
    expect(d.reason).toBe('budget-time')
  })

  it('reports exhaustion honestly rather than dressing it up as ready', () => {
    const d = shouldStop(plan, progress({
      sourcesRead: 2,
      domains: ['a.com', 'b.com'],
      groundedBlocks: 2,
      asked: plan.questions,
    }))
    expect(d.reason).toBe('exhausted')
    expect(d.detail).toContain('thinly covered')
  })

  it('flags exhaustion with enough sources but thin corroboration', () => {
    const d = shouldStop(plan, progress({
      sourcesRead: 7,
      domains: ['a.com', 'a.com', 'a.com', 'b.com', 'b.com', 'b.com', 'c.com'],
      groundedBlocks: 7,
      asked: plan.questions,
    }))
    expect(d.reason).toBe('exhausted')
    expect(d.detail).toContain('independent corroboration')
  })

  it('always terminates — every path either stops or has angles left', () => {
    const d = shouldStop(plan, progress({ sourcesRead: 1, asked: plan.questions, domains: ['a.com'] }))
    expect(d.stop).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Question sequencing
// ---------------------------------------------------------------------------

describe('nextQuestion', () => {
  const plan = planResearch('prompt injection')

  it('starts at the first angle', () => {
    expect(nextQuestion(plan, progress())).toBe(plan.questions[0])
  })

  it('skips angles already pursued, case-insensitively', () => {
    const next = nextQuestion(plan, progress({ asked: [plan.questions[0].toUpperCase()] }))
    expect(next).toBe(plan.questions[1])
  })

  it('returns null when the angles are spent', () => {
    expect(nextQuestion(plan, progress({ asked: plan.questions }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

describe('describeOutcome', () => {
  const plan = planResearch('prompt injection')

  it('leads with the stop reason', () => {
    const p = progress({ sourcesRead: 6, domains: spread(6), groundedBlocks: 6, asked: ['a'] })
    const out = describeOutcome(p, shouldStop(plan, p))
    expect(out).toContain('ready')
  })

  it('says when disagreement was found and kept', () => {
    const p = progress({ sourcesRead: 6, domains: spread(6), groundedBlocks: 6, contestedFound: 2, asked: ['a'] })
    expect(describeOutcome(p, shouldStop(plan, p))).toContain('contested')
  })

  it('warns when a "ready" verdict rests on repeated sources', () => {
    // Clears every `ready` bar — 8 sources, 4 distinct domains, no single site dominating —
    // yet half the reads are repeats. Ready, and worth a caveat.
    const p = progress({
      sourcesRead: 8,
      domains: ['a.com', 'a.com', 'b.com', 'b.com', 'c.com', 'c.com', 'd.com', 'd.com'],
      groundedBlocks: 8,
      asked: ['a'],
    })
    const decision = shouldStop(plan, p)
    expect(decision.reason).toBe('ready')
    expect(describeOutcome(p, decision)).toContain('same places')
  })

  it('reports sources that yielded nothing quotable', () => {
    const p = progress({ sourcesRead: 8, domains: spread(8), groundedBlocks: 6, asked: ['a'] })
    expect(describeOutcome(p, shouldStop(plan, p))).toContain('nothing quotable')
  })
})
