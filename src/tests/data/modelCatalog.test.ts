import { describe, it, expect } from 'vitest'
import { MODEL_CATALOG, recommendSetup, MIN_LOCAL_GB } from '../../data/modelCatalog'

// recommendSetup takes RAM in MB; tests express sizes in GB for readability.
const mb = (gb: number) => gb * 1024
const recLocal = (gb: number) => recommendSetup({ totalMb: mb(gb), isAppleSilicon: true })

// ---------------------------------------------------------------------------
// Per-tier `primary` picks — the single get-started recommendation per Mac.
// ---------------------------------------------------------------------------

describe('recommendSetup — local picks by RAM tier (Apple Silicon)', () => {
  it('8GB → Qwen 2.5 7B', () => {
    const rec = recLocal(8)
    expect(rec.kind).toBe('local')
    if (rec.kind !== 'local') return
    expect(rec.recommended.id).toBe('qwen25-7b')
  })

  it('16GB → Gemma 3 12B', () => {
    const rec = recLocal(16)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('gemma3-12b')
  })

  it('32GB → Gemma 3 27B', () => {
    const rec = recLocal(32)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('gemma3-27b')
  })

  it('48GB → Llama 3.3 70B', () => {
    const rec = recLocal(48)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('llama33-70b')
  })

  it('64GB stays on the 48GB tier → Llama 3.3 70B', () => {
    const rec = recLocal(64)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('llama33-70b')
  })

  it('24GB rounds down to the 16GB tier → Gemma 3 12B', () => {
    const rec = recLocal(24)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('gemma3-12b')
  })

  it('every local pick carries a tierLabel', () => {
    const rec = recLocal(32)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.tierLabel).toMatch(/GB tier/)
  })
})

// ---------------------------------------------------------------------------
// Cloud fallbacks — Intel and Macs below the local RAM floor.
// ---------------------------------------------------------------------------

describe('recommendSetup — cloud fallbacks', () => {
  it('non-Apple-Silicon Macs fall back to cloud regardless of RAM', () => {
    const rec = recommendSetup({ totalMb: mb(64), isAppleSilicon: false })
    expect(rec.kind).toBe('cloud')
    if (rec.kind !== 'cloud') return
    expect(rec.reason).toMatch(/Apple Silicon/i)
  })

  it(`under ${MIN_LOCAL_GB}GB falls back to cloud and cites RAM`, () => {
    const rec = recommendSetup({ totalMb: mb(4), isAppleSilicon: true })
    expect(rec.kind).toBe('cloud')
    if (rec.kind !== 'cloud') return
    expect(rec.reason).toMatch(/RAM/i)
  })
})

// ---------------------------------------------------------------------------
// Catalog invariant — exactly one `primary` pick per RAM tier.
// Guards against a second tier-default sneaking in (which would make the
// recommendation non-deterministic depending on catalog order).
// ---------------------------------------------------------------------------

describe('MODEL_CATALOG primary invariant', () => {
  it('has exactly one primary model per RAM tier', () => {
    const primaries = MODEL_CATALOG.filter(m => m.primary)
    const tiers = primaries.map(m => m.ramGb)
    // one per distinct tier → no duplicates
    expect(new Set(tiers).size).toBe(primaries.length)
    // the four tiers we ship
    expect([...tiers].sort((a, b) => a - b)).toEqual([8, 16, 32, 48])
  })
})
