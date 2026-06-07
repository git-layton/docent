import { describe, it, expect } from 'vitest'
import {
  getLocalModelRecommendation,
  formatRamForRecommendation,
} from '../../services/modelRecommendations'

// ---------------------------------------------------------------------------
// formatRamForRecommendation
// ---------------------------------------------------------------------------

describe('formatRamForRecommendation', () => {
  it('returns fallback text for 0 MB', () => {
    expect(formatRamForRecommendation(0)).toBe('hardware not detected yet')
  })

  it('returns fallback text for null', () => {
    expect(formatRamForRecommendation(null)).toBe('hardware not detected yet')
  })

  it('returns fallback text for undefined', () => {
    expect(formatRamForRecommendation(undefined)).toBe('hardware not detected yet')
  })

  it('formats 8192 MB as "8.0GB RAM" (< 10 GB uses toFixed(1))', () => {
    expect(formatRamForRecommendation(8192)).toBe('8.0GB RAM')
  })

  it('formats 16384 MB as "16GB RAM" (>= 10 GB uses Math.round)', () => {
    expect(formatRamForRecommendation(16384)).toBe('16GB RAM')
  })

  it('formats 1536 MB (1.5 GB) as "1.5GB RAM"', () => {
    expect(formatRamForRecommendation(1536)).toBe('1.5GB RAM')
  })

  it('formats 12288 MB as "12GB RAM"', () => {
    expect(formatRamForRecommendation(12288)).toBe('12GB RAM')
  })

  it('formats 24576 MB as "24GB RAM"', () => {
    expect(formatRamForRecommendation(24576)).toBe('24GB RAM')
  })

  it('formats 49152 MB as "48GB RAM"', () => {
    expect(formatRamForRecommendation(49152)).toBe('48GB RAM')
  })
})

// ---------------------------------------------------------------------------
// getLocalModelRecommendation — unknown tier
// ---------------------------------------------------------------------------

describe('getLocalModelRecommendation — unknown tier (0 / null / undefined)', () => {
  it('returns tierId "unknown" for 0 MB', () => {
    const result = getLocalModelRecommendation(0)
    expect(result.tierId).toBe('unknown')
  })

  it('returns tierId "unknown" for null', () => {
    const result = getLocalModelRecommendation(null)
    expect(result.tierId).toBe('unknown')
  })

  it('returns tierId "unknown" for undefined', () => {
    const result = getLocalModelRecommendation(undefined)
    expect(result.tierId).toBe('unknown')
  })

  it('has the expected caveat text for unknown tier', () => {
    const result = getLocalModelRecommendation(0)
    expect(result.caveat).toBe(
      'Hardware detection is only available in the desktop app, so this is a conservative LM Studio default.'
    )
  })

  it('has a strategy mentioning cloud model for unknown tier', () => {
    const result = getLocalModelRecommendation(0)
    expect(result.strategy).toContain('cloud model')
  })

  it('unknown tier has exactly one option with modelId "local-7b-instruct"', () => {
    const result = getLocalModelRecommendation(0)
    expect(result.options).toHaveLength(1)
    expect(result.options[0].modelId).toBe('local-7b-instruct')
  })
})

// ---------------------------------------------------------------------------
// getLocalModelRecommendation — light tier (0 < totalMb < 12 GB)
// ---------------------------------------------------------------------------

describe('getLocalModelRecommendation — light tier (< 12 GB)', () => {
  it('returns tierId "light" for 8192 MB (8 GB)', () => {
    const result = getLocalModelRecommendation(8192)
    expect(result.tierId).toBe('light')
  })

  it('has the expected caveat for light tier', () => {
    const result = getLocalModelRecommendation(8192)
    expect(result.caveat).toBe('Avoid 7B+ models unless the machine has plenty of free memory.')
  })

  it('has a strategy mentioning small local models for light tier', () => {
    const result = getLocalModelRecommendation(8192)
    expect(result.strategy).toContain('Small local models')
  })

  it('light tier recommends two lmstudio options', () => {
    const result = getLocalModelRecommendation(8192)
    expect(result.options).toHaveLength(2)
    expect(result.options.every(o => o.provider === 'lmstudio')).toBe(true)
  })

  it('light tier first option modelId is "local-3b-instruct"', () => {
    const result = getLocalModelRecommendation(8192)
    expect(result.options[0].modelId).toBe('local-3b-instruct')
  })

  it('light tier second option modelId is "local-4b-instruct"', () => {
    const result = getLocalModelRecommendation(8192)
    expect(result.options[1].modelId).toBe('local-4b-instruct')
  })
})

// ---------------------------------------------------------------------------
// getLocalModelRecommendation — balanced tier (12 GB <= totalMb < 24 GB)
// ---------------------------------------------------------------------------

describe('getLocalModelRecommendation — balanced tier (12–24 GB)', () => {
  it('returns tierId "balanced" at the 12 GB boundary (12288 MB)', () => {
    const result = getLocalModelRecommendation(12288)
    expect(result.tierId).toBe('balanced')
  })

  it('returns tierId "balanced" for 16384 MB (16 GB)', () => {
    const result = getLocalModelRecommendation(16384)
    expect(result.tierId).toBe('balanced')
  })

  it('has the expected caveat for balanced tier', () => {
    const result = getLocalModelRecommendation(16384)
    expect(result.caveat).toBe(
      'Large context windows and multiple apps can still push memory pressure up.'
    )
  })

  it('has a strategy mentioning 7B or 8B for balanced tier', () => {
    const result = getLocalModelRecommendation(16384)
    expect(result.strategy).toContain('local models')
  })

  it('balanced tier first option modelId is "local-8b-instruct"', () => {
    const result = getLocalModelRecommendation(16384)
    expect(result.options[0].modelId).toBe('local-8b-instruct')
  })

  it('balanced tier second option modelId is "local-7b-instruct"', () => {
    const result = getLocalModelRecommendation(16384)
    expect(result.options[1].modelId).toBe('local-7b-instruct')
  })
})

// ---------------------------------------------------------------------------
// getLocalModelRecommendation — strong tier (24 GB <= totalMb < 48 GB)
// ---------------------------------------------------------------------------

describe('getLocalModelRecommendation — strong tier (24–48 GB)', () => {
  it('returns tierId "strong" at the 24 GB boundary (24576 MB)', () => {
    const result = getLocalModelRecommendation(24576)
    expect(result.tierId).toBe('strong')
  })

  it('returns tierId "strong" for 32768 MB (32 GB)', () => {
    const result = getLocalModelRecommendation(32768)
    expect(result.tierId).toBe('strong')
  })

  it('has the expected caveat for strong tier', () => {
    const result = getLocalModelRecommendation(32768)
    expect(result.caveat).toBe(
      '32B models may run, but they can be slow or unstable depending on free memory and quantization.'
    )
  })

  it('has a strategy mentioning 14B local model for strong tier', () => {
    const result = getLocalModelRecommendation(32768)
    expect(result.strategy).toContain('14B')
  })

  it('strong tier first option modelId is "local-14b-instruct"', () => {
    const result = getLocalModelRecommendation(24576)
    expect(result.options[0].modelId).toBe('local-14b-instruct')
  })

  it('strong tier first option contextLimit is 16384', () => {
    const result = getLocalModelRecommendation(24576)
    expect(result.options[0].contextLimit).toBe(16384)
  })
})

// ---------------------------------------------------------------------------
// getLocalModelRecommendation — workstation tier (48 GB+)
// ---------------------------------------------------------------------------

describe('getLocalModelRecommendation — workstation tier (>= 48 GB)', () => {
  it('returns tierId "workstation" at the 48 GB boundary (49152 MB)', () => {
    const result = getLocalModelRecommendation(49152)
    expect(result.tierId).toBe('workstation')
  })

  it('returns tierId "workstation" for 98304 MB (96 GB)', () => {
    const result = getLocalModelRecommendation(98304)
    expect(result.tierId).toBe('workstation')
  })

  it('has the expected caveat for workstation tier', () => {
    const result = getLocalModelRecommendation(49152)
    expect(result.caveat).toBe(
      '70B-class models may be possible on large unified-memory Macs, but expect slower responses and careful memory management.'
    )
  })

  it('has a strategy mentioning 32B-class for workstation tier', () => {
    const result = getLocalModelRecommendation(49152)
    expect(result.strategy).toContain('32B-class')
  })

  it('workstation tier first option modelId is "local-32b-instruct"', () => {
    const result = getLocalModelRecommendation(49152)
    expect(result.options[0].modelId).toBe('local-32b-instruct')
  })

  it('workstation tier first option contextLimit is 32768', () => {
    const result = getLocalModelRecommendation(49152)
    expect(result.options[0].contextLimit).toBe(32768)
  })

  it('workstation tier second option modelId is "local-14b-instruct"', () => {
    const result = getLocalModelRecommendation(98304)
    expect(result.options[1].modelId).toBe('local-14b-instruct')
  })
})

// ---------------------------------------------------------------------------
// Shared option shape sanity checks
// ---------------------------------------------------------------------------

describe('getLocalModelRecommendation — option shape invariants', () => {
  const sampleInputs = [0, 8192, 12288, 16384, 24576, 32768, 49152, 98304]

  it.each(sampleInputs)('all options for %i MB have provider "lmstudio"', (mb) => {
    const { options } = getLocalModelRecommendation(mb)
    expect(options.length).toBeGreaterThan(0)
    for (const opt of options) {
      expect(opt.provider).toBe('lmstudio')
      expect(opt.endpoint).toBe('http://127.0.0.1:1234/v1')
      expect(opt.label).toBe('Use LM Studio')
      expect(opt.setupHint).toBeTruthy()
    }
  })

  it('ramLabel in result matches formatRamForRecommendation output', () => {
    const inputs = [0, 8192, 16384, 49152]
    for (const mb of inputs) {
      const result = getLocalModelRecommendation(mb)
      expect(result.ramLabel).toBe(formatRamForRecommendation(mb))
    }
  })
})
