import { describe, it, expect } from 'vitest'
import {
  assessContextHealth,
  DREAM_OVERDUE_MS,
  type ContextHealthInput,
} from '../../services/contextHealth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000

/** Baseline: 32k-char window, light usage, pipeline healthy, dreamed recently */
const makeInput = (overrides: Partial<ContextHealthInput> = {}): ContextHealthInput => ({
  usedChars: 8_000,
  limitChars: 32_000,
  systemChars: 2_000,
  pinsChars: 500,
  docsChars: 0,
  browserChars: 0,
  rotating: false,
  memoryPipelineActive: true,
  lastDreamAt: NOW - 60 * 60 * 1000, // 1h ago
  now: NOW,
  ...overrides,
})

// ---------------------------------------------------------------------------
// Status tiers
// ---------------------------------------------------------------------------

describe('assessContextHealth — status tiers', () => {
  it('reports healthy when usage is light and nothing is wrong', () => {
    const h = assessContextHealth(makeInput())
    expect(h.status).toBe('healthy')
    expect(h.recommendations).toHaveLength(0)
    expect(h.fillPct).toBeCloseTo(25, 0)
  })

  it('reports optimized (not a crisis) when the window is full but self-managing', () => {
    const h = assessContextHealth(makeInput({ usedChars: 32_000, rotating: true }))
    expect(h.status).toBe('optimized')
    expect(h.headline).toBe('Optimized')
    expect(h.recommendations).toHaveLength(0)
  })

  it('reports optimized when filling past steady-state even before rotation starts', () => {
    const h = assessContextHealth(makeInput({ usedChars: 24_000, rotating: false }))
    expect(h.status).toBe('optimized')
  })

  it('never exceeds 100% fill', () => {
    const h = assessContextHealth(makeInput({ usedChars: 64_000, rotating: true }))
    expect(h.fillPct).toBe(100)
  })

  it('handles a zero/invalid limit without dividing by zero', () => {
    const h = assessContextHealth(makeInput({ limitChars: 0 }))
    expect(Number.isFinite(h.fillPct)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Structural signals
// ---------------------------------------------------------------------------

describe('assessContextHealth — structural signals', () => {
  it('flags pin bloat past 25% of the window', () => {
    const h = assessContextHealth(makeInput({ pinsChars: 9_000 }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.map(r => r.id)).toContain('unpin')
  })

  it('flags doc bloat past 35% of the window', () => {
    const h = assessContextHealth(makeInput({ docsChars: 12_000 }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.map(r => r.id)).toContain('trim-docs')
  })

  it('flags oversized instructions past 25% of the window', () => {
    const h = assessContextHealth(makeInput({ systemChars: 9_000 }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.map(r => r.id)).toContain('trim-instructions')
  })

  it('flags a squeezed live window even when no single category crosses its threshold', () => {
    // 24% pins + 24% system + 30% docs = 78% overhead, 22% live — all under
    // their individual thresholds
    const h = assessContextHealth(makeInput({
      pinsChars: 7_680,
      systemChars: 7_680,
      docsChars: 9_600,
    }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.length).toBeGreaterThan(0)
  })

  it('flags rotation without a working memory pipeline as real loss', () => {
    const h = assessContextHealth(makeInput({ rotating: true, memoryPipelineActive: false, usedChars: 32_000 }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.map(r => r.id)).toContain('enable-memory')
  })

  it('puts the top recommendation in the detail line', () => {
    const h = assessContextHealth(makeInput({ pinsChars: 9_000 }))
    expect(h.detail).toBe(h.recommendations[0].text)
  })
})

// ---------------------------------------------------------------------------
// Dream Cycle signal
// ---------------------------------------------------------------------------

describe('assessContextHealth — dream consolidation', () => {
  it('recommends a Dream Cycle when rotating and never dreamed', () => {
    const h = assessContextHealth(makeInput({ rotating: true, usedChars: 32_000, lastDreamAt: null }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.map(r => r.id)).toContain('dream')
  })

  it('recommends a Dream Cycle when the last one is overdue', () => {
    const h = assessContextHealth(makeInput({
      rotating: true,
      usedChars: 32_000,
      lastDreamAt: NOW - DREAM_OVERDUE_MS - 1,
    }))
    expect(h.status).toBe('attention')
    expect(h.recommendations.map(r => r.id)).toContain('dream')
  })

  it('does not nag about dreams when one ran recently', () => {
    const h = assessContextHealth(makeInput({ rotating: true, usedChars: 32_000 }))
    expect(h.status).toBe('optimized')
    expect(h.recommendations.map(r => r.id)).not.toContain('dream')
  })

  it('does not recommend dreams before the conversation outgrows the window', () => {
    const h = assessContextHealth(makeInput({ rotating: false, lastDreamAt: null }))
    expect(h.recommendations.map(r => r.id)).not.toContain('dream')
  })

  it('does not recommend dreams when no pipeline can run them', () => {
    const h = assessContextHealth(makeInput({ rotating: true, memoryPipelineActive: false, lastDreamAt: null }))
    expect(h.recommendations.map(r => r.id)).not.toContain('dream')
  })
})
