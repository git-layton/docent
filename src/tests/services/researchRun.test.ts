import { describe, it, expect, vi } from 'vitest'
import {
  runResearch,
  preferUnseenDomains,
  MAX_PER_QUESTION,
  type FoundSource,
  type ResearchDeps,
} from '../../services/researchRun'

const src = (url: string, title = url): FoundSource => ({ url, title })

/** A searcher that returns n fresh sources per angle, each on its own domain. */
const spreadSearch = (perAngle = MAX_PER_QUESTION) => {
  let n = 0
  return async () => Array.from({ length: perAngle }, () => {
    n += 1
    return src(`https://site${n}.com/page`)
  })
}

const okDigest = async () => ({ groundedBlocks: 3, text: 'prompt injection x grief the French Revolution' })

const deps = (over: Partial<ResearchDeps> = {}): ResearchDeps => ({
  search: spreadSearch(),
  digest: okDigest,
  ...over,
})

// ---------------------------------------------------------------------------
// Diversity ordering
// ---------------------------------------------------------------------------

describe('preferUnseenDomains', () => {
  it('puts unseen domains first', () => {
    const out = preferUnseenDomains(
      [src('https://a.com/1'), src('https://new.com/1'), src('https://a.com/2')],
      ['a.com'],
    )
    expect(out.map(s => s.url)).toEqual([
      'https://new.com/1', 'https://a.com/1', 'https://a.com/2',
    ])
  })

  it('is stable within each group — a good result is deferred, never buried', () => {
    const out = preferUnseenDomains(
      [src('https://b.com/1'), src('https://c.com/1')],
      [],
    )
    expect(out.map(s => s.url)).toEqual(['https://b.com/1', 'https://c.com/1'])
  })

  it('survives junk urls', () => {
    expect(() => preferUnseenDomains([src('not a url')], [])).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

describe('runResearch', () => {
  it('reaches READY on a healthy run', async () => {
    const out = await runResearch('prompt injection', deps())
    expect(out.decision.reason).toBe('ready')
    expect(out.report).toContain('ready')
    expect(out.progress.sourcesRead).toBeGreaterThanOrEqual(6)
  })

  it('never reads the same URL twice, even across angles', async () => {
    // Two angles returning the identical page must not count it twice — double counting
    // inflates every stop condition at once.
    const out = await runResearch('x', deps({
      search: async () => [src('https://same.com/page'), src('https://other.com/p')],
    }))
    const urls = out.read.map(s => s.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('enforces the source ceiling INSIDE a question, not just between angles', async () => {
    // One generous search must not overshoot by three or four reads.
    const out = await runResearch('x', deps({
      search: async () => Array.from({ length: 50 }, (_, i) => src(`https://s${i}.com/p`)),
    }), { budget: { maxSources: 5, minSources: 99 } })
    expect(out.progress.sourcesRead).toBe(5)
  })

  it('caps how much it takes from any single angle', async () => {
    const search = vi.fn(async () => Array.from({ length: 20 }, (_, i) => src(`https://q${i}.com/p`)))
    await runResearch('x', deps({ search }), { budget: { minSources: 99, maxSources: 99 } })
    // Angle count × cap, not 20 from the first angle.
    expect(search).toHaveBeenCalledTimes(3)
  })

  it('counts a page that fails to digest as READ but not grounded', async () => {
    // It consumed budget and produced nothing. Recording it is what lets the report say
    // "produced nothing quotable" instead of pretending it was never opened.
    const out = await runResearch('x', deps({
      digest: async () => { throw new Error('parse failed') },
      search: spreadSearch(),
    }), { budget: { minSources: 2, maxSources: 6, minDistinctDomains: 2 } })
    expect(out.progress.sourcesRead).toBeGreaterThan(0)
    expect(out.progress.groundedBlocks).toBe(0)
    expect(out.report).toContain('nothing quotable')
  })

  it('a failed search costs the angle, not the run', async () => {
    let call = 0
    const out = await runResearch('x', deps({
      search: async () => {
        call += 1
        if (call === 1) throw new Error('network down')
        return [src(`https://ok${call}.com/p`), src(`https://ok${call}b.com/p`)]
      },
    }), { budget: { minSources: 2, maxSources: 8, minDistinctDomains: 2 } })
    expect(out.progress.sourcesRead).toBeGreaterThan(0)
  })

  it('terminates when every angle is spent rather than spinning', async () => {
    const out = await runResearch('x', deps({ search: async () => [] }))
    expect(out.decision.stop).toBe(true)
    expect(['exhausted', 'ready', 'budget-sources', 'budget-time']).toContain(out.decision.reason)
  })

  it('honours an abort signal', async () => {
    const ctl = new AbortController()
    const out = await runResearch('x', deps({
      signal: ctl.signal,
      search: async () => { ctl.abort(); return [src('https://a.com/p')] },
    }))
    expect(out.decision.stop).toBe(true)
    expect(out.report).toContain('cancelled')
  })

  it('reports progress as it goes', async () => {
    const events: string[] = []
    await runResearch('x', deps({ onEvent: e => events.push(e.phase) }))
    expect(events).toContain('question')
    expect(events).toContain('read')
    expect(events[events.length - 1]).toBe('stopped')
  })

  it('records contested sources', async () => {
    const out = await runResearch('x', deps({
      digest: async () => ({ groundedBlocks: 2, contested: true }),
    }))
    expect(out.progress.contestedFound).toBeGreaterThan(0)
    expect(out.report).toContain('contested')
  })

  it('a hung source cannot outlive the run', async () => {
    // Found live, not by reasoning: shouldStop is only consulted BETWEEN sources, so one page
    // that never responds stalls the run past every budget it has — control never comes back
    // to check the clock. A budget that only applies when things go well is not a budget.
    const out = await runResearch('x', deps({
      sourceTimeoutMs: 30,
      digest: () => new Promise<never>(() => {}),   // never settles
      search: spreadSearch(),
    }), { budget: { minSources: 2, maxSources: 4, minDistinctDomains: 2 } })
    expect(out.decision.stop).toBe(true)
    expect(out.progress.groundedBlocks).toBe(0)
    expect(out.progress.sourcesRead).toBeGreaterThan(0)
  }, 10_000)

  it('a hung SEARCH costs the angle, not the run', async () => {
    let call = 0
    const out = await runResearch('x', deps({
      sourceTimeoutMs: 30,
      search: async () => {
        call += 1
        if (call === 1) return new Promise<never>(() => {}) as never
        return [src(`https://ok${call}.com/p`), src(`https://ok${call}b.com/p`)]
      },
    }), { budget: { minSources: 2, maxSources: 6, minDistinctDomains: 2 } })
    expect(out.decision.stop).toBe(true)
    expect(out.progress.sourcesRead).toBeGreaterThan(0)
  }, 10_000)

  it('is NOT ready when everything came from one domain', async () => {
    // Decision ②, end to end: volume without spread is not a knowledge base.
    let n = 0
    const out = await runResearch('x', deps({
      search: async () => { n += 1; return [src(`https://only.com/p${n}`)] },
    }), { budget: { minSources: 2, maxSources: 6, minDistinctDomains: 3 } })
    expect(out.decision.reason).not.toBe('ready')
  })
})
