import { describe, it, expect } from 'vitest'
import {
  assessKnowledgeHealth,
  READ_STALE_MS,
  DRIFT_ATTENTION_PCT,
  type KnowledgeHealthInput,
} from '../../services/knowledgeHealth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000

/** Baseline: a well-grounded library, read from recently, nothing wrong. */
const makeInput = (overrides: Partial<KnowledgeHealthInput> = {}): KnowledgeHealthInput => ({
  conceptCount: 20,
  groundedBlocks: 70,
  generatedBlocks: 25,
  contestedBlocks: 5,
  distinctSources: 12,
  singleSourceConcepts: 4,
  staleCitations: 0,
  facetsFromRetiredModels: 0,
  lastReadAt: NOW - 2 * 24 * 60 * 60 * 1000, // 2 days ago
  previous: null,
  now: NOW,
  ...overrides,
})

// ---------------------------------------------------------------------------
// Status tiers
// ---------------------------------------------------------------------------

describe('assessKnowledgeHealth — status tiers', () => {
  it('reports healthy when most of the library is grounded and diverse', () => {
    const h = assessKnowledgeHealth(makeInput())
    expect(h.status).toBe('healthy')
    expect(h.headline).toBe('Healthy')
    expect(h.recommendations).toHaveLength(0)
  })

  it('reports exploring — not attention — for a thin but actively-read library', () => {
    // Low grounding is what learning something NEW looks like. It must not be
    // reported as a problem, or the meter nags exactly when someone is doing
    // the right thing.
    const h = assessKnowledgeHealth(makeInput({
      groundedBlocks: 12,
      generatedBlocks: 38,
      contestedBlocks: 0,
      lastReadAt: NOW - 60 * 60 * 1000, // read an hour ago
    }))
    expect(h.status).toBe('exploring')
    expect(h.headline).toBe('Exploring')
    expect(h.detail).toContain('new territory')
  })

  it('reports healthy for an empty library rather than judging it', () => {
    const h = assessKnowledgeHealth(makeInput({
      conceptCount: 0,
      groundedBlocks: 0,
      generatedBlocks: 0,
      contestedBlocks: 0,
      distinctSources: 0,
      singleSourceConcepts: 0,
      lastReadAt: null,
    }))
    expect(h.status).toBe('healthy')
    expect(h.detail).toContain('Nothing in the library yet')
  })
})

// ---------------------------------------------------------------------------
// Drift — the closed-loop signal the collapse research is about
// ---------------------------------------------------------------------------

describe('assessKnowledgeHealth — drift', () => {
  it('flags a falling grounded share while the library grows', () => {
    const h = assessKnowledgeHealth(makeInput({
      conceptCount: 30,
      groundedBlocks: 40,
      generatedBlocks: 60,
      contestedBlocks: 0,
      previous: { groundedPct: 70, conceptCount: 20, at: NOW - 7 * 24 * 60 * 60 * 1000 },
    }))
    expect(h.status).toBe('attention')
    expect(h.recommendations[0].id).toBe('drifting')
    expect(h.driftPct).toBeLessThanOrEqual(-DRIFT_ATTENTION_PCT)
  })

  it('does NOT flag a falling share when the library did not grow', () => {
    // Same ratio change, but no new concepts — that's re-measurement or cleanup,
    // not generation outpacing reading.
    const h = assessKnowledgeHealth(makeInput({
      conceptCount: 20,
      groundedBlocks: 40,
      generatedBlocks: 60,
      contestedBlocks: 0,
      previous: { groundedPct: 70, conceptCount: 20, at: NOW - 7 * 24 * 60 * 60 * 1000 },
    }))
    expect(h.recommendations.some(r => r.id === 'drifting')).toBe(false)
  })

  it('reports null drift on a first reading', () => {
    const h = assessKnowledgeHealth(makeInput({ previous: null }))
    expect(h.driftPct).toBeNull()
  })

  it('returns a snapshot that can be fed back in as previous', () => {
    const first = assessKnowledgeHealth(makeInput())
    const second = assessKnowledgeHealth(makeInput({ previous: first.snapshot }))
    expect(second.driftPct).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Erosion signals
// ---------------------------------------------------------------------------

describe('assessKnowledgeHealth — erosion signals', () => {
  it('flags a starved library only when nothing new has been read', () => {
    const starved = assessKnowledgeHealth(makeInput({
      groundedBlocks: 5,
      generatedBlocks: 45,
      contestedBlocks: 0,
      lastReadAt: NOW - (READ_STALE_MS + 1),
    }))
    expect(starved.status).toBe('attention')
    expect(starved.recommendations.some(r => r.id === 'read-more')).toBe(true)
  })

  it('treats a never-read library with content as starved', () => {
    const h = assessKnowledgeHealth(makeInput({
      groundedBlocks: 2,
      generatedBlocks: 48,
      contestedBlocks: 0,
      lastReadAt: null,
    }))
    expect(h.recommendations.some(r => r.id === 'read-more')).toBe(true)
  })

  it('flags thin source diversity even when the grounded share looks fine', () => {
    // This is the subtle one: 100% grounded, but everything traces to two pages.
    // Reads as healthy on a ratio alone; is not.
    const h = assessKnowledgeHealth(makeInput({
      conceptCount: 40,
      groundedBlocks: 100,
      generatedBlocks: 0,
      contestedBlocks: 0,
      distinctSources: 2,
    }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.some(r => r.id === 'diversify')).toBe(true)
    expect(h.sourceLoad).toBe(20)
  })

  it('flags citations that no longer match their source', () => {
    const h = assessKnowledgeHealth(makeInput({ staleCitations: 3 }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.some(r => r.id === 'reverify')).toBe(true)
  })

  it('flags single-source concepts without calling the library unhealthy', () => {
    // Corroboration is advice, not erosion — it shouldn't trip 'attention' alone.
    const h = assessKnowledgeHealth(makeInput({
      conceptCount: 10,
      singleSourceConcepts: 9,
    }))
    expect(h.recommendations.some(r => r.id === 'corroborate')).toBe(true)
    expect(h.status).not.toBe('attention')
  })
})

// ---------------------------------------------------------------------------
// Moving to local models
// ---------------------------------------------------------------------------

describe('assessKnowledgeHealth — retired models', () => {
  it('offers to regenerate passages written by a model no longer in use', () => {
    const h = assessKnowledgeHealth(makeInput({ facetsFromRetiredModels: 12 }))
    expect(h.recommendations.some(r => r.id === 'regenerate-weak')).toBe(true)
  })

  it('makes clear that regenerating loses nothing, because generated never grounded', () => {
    const h = assessKnowledgeHealth(makeInput({ facetsFromRetiredModels: 1 }))
    const rec = h.recommendations.find(r => r.id === 'regenerate-weak')!
    expect(rec.text).toContain('nothing is lost')
  })

  it('does not call a library unhealthy merely for having old-model passages', () => {
    const h = assessKnowledgeHealth(makeInput({ facetsFromRetiredModels: 40 }))
    expect(h.status).not.toBe('attention')
  })
})

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

describe('assessKnowledgeHealth — arithmetic', () => {
  it('excludes contested blocks from the grounded share', () => {
    const h = assessKnowledgeHealth(makeInput({
      groundedBlocks: 50,
      generatedBlocks: 25,
      contestedBlocks: 25,
    }))
    expect(h.groundedPct).toBe(50)
  })

  it('does not divide by zero when there are no sources', () => {
    const h = assessKnowledgeHealth(makeInput({
      conceptCount: 5,
      distinctSources: 0,
      groundedBlocks: 0,
      generatedBlocks: 10,
      contestedBlocks: 0,
      lastReadAt: NOW,
    }))
    expect(Number.isFinite(h.sourceLoad)).toBe(true)
    expect(h.groundedPct).toBe(0)
  })
})
