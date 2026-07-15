import { describe, it, expect } from 'vitest'
import { MODEL_CATALOG, recommendSetup, fitOnMac, MIN_LOCAL_GB } from '../../data/modelCatalog'

// recommendSetup takes RAM in MB; tests express sizes in GB for readability.
const mb = (gb: number) => gb * 1024
const recLocal = (gb: number) => recommendSetup({ totalMb: mb(gb), isAppleSilicon: true })

// ---------------------------------------------------------------------------
// Memory-computed picks. The engine recommends the largest model that runs at
// a useful context (>=16K) inside a conservative GPU-memory budget — NOT the
// biggest model whose file fits in RAM (which is what made a 64GB Mac pick a
// 70B it couldn't load).
// ---------------------------------------------------------------------------

describe('recommendSetup — memory-computed local picks (Apple Silicon)', () => {
  it('8GB → cloud (no model runs at full context in a conservative budget)', () => {
    const rec = recLocal(8)
    expect(rec.kind).toBe('cloud')
  })

  it('16GB → Qwen3 8B (current-gen)', () => {
    const rec = recLocal(16)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('qwen3-8b')
  })

  it('32GB → Qwen3 14B, not a 27B+ it cannot fit at 32K', () => {
    const rec = recLocal(32)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('qwen3-14b')
  })

  it('48GB → Qwen3 30B-A3B (fast MoE, the curated primary over the dense 32B)', () => {
    const rec = recLocal(48)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('qwen3-coder-30b-a3b')
  })

  it('64GB → Qwen3 30B-A3B (current-gen; the 70B does not fit at a usable context)', () => {
    const rec = recLocal(64)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.id).toBe('qwen3-coder-30b-a3b')
  })

  it('96GB → the 70B-class becomes recommendable', () => {
    const rec = recLocal(96)
    if (rec.kind !== 'local') throw new Error('expected local')
    expect(rec.recommended.sizeMb).toBeGreaterThan(40000)
  })

  it('every local pick runs at full 32K and actually fits', () => {
    for (const gb of [16, 24, 32, 48, 64]) {
      const rec = recLocal(gb)
      if (rec.kind !== 'local') throw new Error(`expected local at ${gb}GB`)
      expect(rec.tierLabel).toMatch(/context/i)
      const fit = fitOnMac(rec.recommended, gb)
      expect(fit.fits).toBe(true)
      expect(fit.contextK).toBe(32)
      expect(fit.kv8bit).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// The core regression: a too-large model must never be recommended for a Mac
// that can't load it at a useful context.
// ---------------------------------------------------------------------------

describe('memory model — never recommends an unrunnable model', () => {
  it('the 70B is not recommended below ~96GB', () => {
    for (const gb of [8, 16, 32, 48, 64]) {
      const rec = recLocal(gb)
      if (rec.kind === 'local') expect(rec.recommended.id).not.toBe('llama33-70b')
    }
  })

  it('fitOnMac flags the 70B as not comfortable on 64GB', () => {
    const m70 = MODEL_CATALOG.find(m => m.id === 'llama33-70b')!
    const fit = fitOnMac(m70, 64)
    // It only squeezes in at a tiny context — not a usable recommendation.
    expect(fit.contextK).toBeLessThan(16)
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
