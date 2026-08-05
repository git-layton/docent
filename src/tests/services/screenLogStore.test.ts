import { describe, it, expect } from 'vitest'
import {
  pruneEntries,
  withEntry,
  orphanedFrameIds,
  DEFAULT_MAX_AGE_MS,
} from '../../services/screenLogStore'
import type { ScreenLogEntry } from '../../services/screenLog'

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000

const e = (id: string, seenAt: number, over: Partial<ScreenLogEntry> = {}): ScreenLogEntry => ({
  id,
  app: 'Safari',
  windowTitle: 'a page',
  text: 'some recognised text from the screen',
  frameId: `frame-${id}`,
  seenAt,
  ...over,
})

describe('pruneEntries — retention is a hard bound', () => {
  it('keeps entries inside the window', () => {
    const kept = pruneEntries([e('a', NOW - 1 * DAY), e('b', NOW - 29 * DAY)], NOW)
    expect(kept.map(x => x.id).sort()).toEqual(['a', 'b'])
  })

  it('drops entries past the retention window', () => {
    const kept = pruneEntries([e('old', NOW - 31 * DAY), e('new', NOW - 1 * DAY)], NOW)
    expect(kept.map(x => x.id)).toEqual(['new'])
  })

  it('orders newest first', () => {
    const kept = pruneEntries([e('old', NOW - 5 * DAY), e('new', NOW - 1 * DAY), e('mid', NOW - 3 * DAY)], NOW)
    expect(kept.map(x => x.id)).toEqual(['new', 'mid', 'old'])
  })

  it('applies age BEFORE count, so a busy day cannot evict entries still in window', () => {
    // The user's expectation is "the last 30 days", not "the last N frames".
    const burst = Array.from({ length: 10 }, (_, i) => e(`burst${i}`, NOW - 1 * DAY))
    const older = e('older', NOW - 20 * DAY)
    const kept = pruneEntries([...burst, older], NOW, DEFAULT_MAX_AGE_MS, 11)
    expect(kept.map(x => x.id)).toContain('older')
  })

  it('enforces the absolute cap so a pathological day cannot unbound the store', () => {
    const many = Array.from({ length: 50 }, (_, i) => e(`x${i}`, NOW - i * 1000))
    expect(pruneEntries(many, NOW, DEFAULT_MAX_AGE_MS, 10)).toHaveLength(10)
  })

  it('discards malformed entries rather than storing them', () => {
    const kept = pruneEntries(
      [e('ok', NOW - 1000), { ...e('bad', NaN), seenAt: NaN }, null as unknown as ScreenLogEntry],
      NOW,
    )
    expect(kept.map(x => x.id)).toEqual(['ok'])
  })

  it('handles an empty log', () => {
    expect(pruneEntries([], NOW)).toEqual([])
  })
})

describe('withEntry', () => {
  it('prepends the new entry', () => {
    const out = withEntry([e('a', NOW - 5000)], e('b', NOW), NOW)
    expect(out.map(x => x.id)).toEqual(['b', 'a'])
  })

  it('replaces rather than stacks on a duplicate id', () => {
    const out = withEntry([e('a', NOW - 5000)], e('a', NOW, { text: 'updated text here' }), NOW)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('updated text here')
  })

  it('applies retention on write', () => {
    const out = withEntry([e('ancient', NOW - 90 * DAY)], e('fresh', NOW), NOW)
    expect(out.map(x => x.id)).toEqual(['fresh'])
  })
})

describe('orphanedFrameIds — no frame outlives its entry', () => {
  it('reports frames whose entries were pruned', () => {
    const before = [e('a', NOW), e('b', NOW - 1000)]
    const after = [e('a', NOW)]
    expect(orphanedFrameIds(before, after)).toEqual(['frame-b'])
  })

  it('reports everything when the log is cleared', () => {
    const before = [e('a', NOW), e('b', NOW - 1000)]
    expect(orphanedFrameIds(before, []).sort()).toEqual(['frame-a', 'frame-b'])
  })

  it('reports nothing when nothing was dropped', () => {
    const before = [e('a', NOW)]
    expect(orphanedFrameIds(before, before)).toEqual([])
  })

  it('does not orphan a frame still referenced by another entry', () => {
    // Two entries can share a frame; dropping one must not delete the image.
    const before = [e('a', NOW, { frameId: 'shared' }), e('b', NOW - 1000, { frameId: 'shared' })]
    const after = [e('a', NOW, { frameId: 'shared' })]
    expect(orphanedFrameIds(before, after)).toEqual([])
  })
})
