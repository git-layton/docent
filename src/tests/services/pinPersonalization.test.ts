import { describe, it, expect } from 'vitest'
import {
  computePinProfile,
  computePinBoost,
  isDuplicateOfRecentPins,
  formatPinProfileForPrompt,
  EMPTY_PROFILE,
  MEMS_PROTECTED,
  type GlobalPin,
  type PinProfile,
} from '../../services/pinPersonalization'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

/** Build a minimal GlobalPin with a known savedAt timestamp */
function makePin(
  content: string,
  savedAt: number,
  overrides: Partial<GlobalPin> = {},
): GlobalPin {
  return {
    id: 'pin-' + Math.random().toString(36).slice(2),
    chatId: 'chat-1',
    msgId: 'msg-1',
    agentId: 'agent-1',
    content,
    savedAt,
    ...overrides,
  }
}

/** Return a savedAt value that is `daysAgo` days before Date.now() */
function daysAgo(n: number): number {
  return Date.now() - n * DAY_MS
}

// ─── computePinProfile ────────────────────────────────────────────────────────

describe('computePinProfile', () => {
  it('returns EMPTY_PROFILE for an empty pins array', () => {
    const profile = computePinProfile([])
    expect(profile).toStrictEqual(EMPTY_PROFILE)
  })

  it('isCalibrated is false when fewer than 5 pins are provided', () => {
    const pins = [1, 2, 3, 4].map(i =>
      makePin(`unique content item number ${i} with extra words here`, daysAgo(1)),
    )
    const profile = computePinProfile(pins)
    expect(profile.isCalibrated).toBe(false)
  })

  it('isCalibrated is true when 5 or more pins are provided', () => {
    const pins = [1, 2, 3, 4, 5].map(i =>
      makePin(`unique content item number ${i} with extra words here`, daysAgo(1)),
    )
    const profile = computePinProfile(pins)
    expect(profile.isCalibrated).toBe(true)
  })

  it('totalPins reflects the exact count of pins passed', () => {
    const pins = [1, 2, 3, 4, 5, 6, 7].map(i =>
      makePin(`unique item ${i} with enough words`, daysAgo(1)),
    )
    const profile = computePinProfile(pins)
    expect(profile.totalPins).toBe(7)
  })

  // ── recency decay math ──────────────────────────────────────────────────────

  it('a pin from 0 days ago has decay weight ≈ 1.0', () => {
    // A single recent code pin — categoryWeights['code'] should be close to 1
    const pin = makePin('function hello() { return "world"; }', daysAgo(0))
    const profile = computePinProfile([pin, ...Array(4).fill(null).map((_, i) =>
      makePin(`filler content number ${i} extra words here`, daysAgo(1)),
    )])
    // Weight of the fresh pin is exp(0) = 1; combined with 4 others each ≈ exp(-LN2/30)
    expect(profile.categoryWeights['code']).toBeGreaterThan(0.95)
  })

  it('a pin from 30 days ago has decay weight ≈ 0.5 (half-life)', () => {
    // Only one code pin, saved exactly 30 days ago
    const pin = makePin('function hello() { return "world"; }', daysAgo(30))
    // Pad with 4 non-code pins so isCalibrated = true
    const pads = Array(4).fill(null).map(() =>
      makePin('my wife loves hiking in the mountains every weekend', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    // half-life = 30 days → exp(-LN2) = 0.5
    expect(profile.categoryWeights['code']).toBeGreaterThan(0.45)
    expect(profile.categoryWeights['code']).toBeLessThan(0.55)
  })

  it('a pin from 60 days ago has decay weight ≈ 0.25 (two half-lives)', () => {
    const pin = makePin('function hello() { return "world"; }', daysAgo(60))
    const pads = Array(4).fill(null).map(() =>
      makePin('my wife loves hiking in the mountains every weekend', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['code']).toBeGreaterThan(0.20)
    expect(profile.categoryWeights['code']).toBeLessThan(0.30)
  })

  // ── category detection ──────────────────────────────────────────────────────

  it('detects code category for content with a function keyword', () => {
    const pin = makePin('function greet(name) { console.log(name); }', daysAgo(0))
    const pads = Array(4).fill(null).map(() =>
      makePin('my wife loves hiking in the mountains every weekend', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['code']).toBeGreaterThan(0)
  })

  it('detects recipe category', () => {
    const pin = makePin('Add 2 tablespoon of olive oil and simmer for 10 minutes', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['recipe']).toBeGreaterThan(0)
  })

  it('detects medical category', () => {
    const pin = makePin('Doctor prescribed 20mg dosage for blood pressure medication', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['medical']).toBeGreaterThan(0)
  })

  it('detects event category', () => {
    const pin = makePin("Don't forget Sarah's birthday on March 15", daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['event']).toBeGreaterThan(0)
  })

  it('detects relationship category', () => {
    const pin = makePin('My mom always calls on Sunday evenings', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['relationship']).toBeGreaterThan(0)
  })

  it('detects preference category', () => {
    const pin = makePin('I prefer dark mode interfaces and always use Vim keybindings', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['preference']).toBeGreaterThan(0)
  })

  it('detects decision category', () => {
    const pin = makePin('We decided to go with Postgres — final decision was made yesterday', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['decision']).toBeGreaterThan(0)
  })

  it('detects research category', () => {
    const pin = makePin('According to the published study, the data shows a 40% improvement', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['research']).toBeGreaterThan(0)
  })

  it('detects project category', () => {
    const pin = makePin('New sprint ticket: deploy the authentication feature by end of roadmap', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique filler content item with extra words here', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['project']).toBeGreaterThan(0)
  })

  it('falls back to fact category when no category matches', () => {
    const pin = makePin('Some completely unclassifiable random note without special terms', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('another completely unclassifiable random note without special terms', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    expect(profile.categoryWeights['fact']).toBeGreaterThan(0)
  })

  // ── keyword extraction ──────────────────────────────────────────────────────

  it('topKeywords are extracted from recent (last 30 days) pins only', () => {
    const recentPin = makePin('typescript javascript nodejs webpack bundler', daysAgo(5))
    const oldPin = makePin('fortran cobol assembler mainframe oldlanguage', daysAgo(60))
    const pads = Array(3).fill(null).map(() =>
      makePin('unique content here with enough words', daysAgo(2)),
    )
    const profile = computePinProfile([recentPin, oldPin, ...pads])
    // Recent keywords should appear; old-pin keywords should not
    expect(profile.topKeywords.some(kw => ['typescript', 'javascript', 'nodejs', 'webpack', 'bundler'].includes(kw))).toBe(true)
    expect(profile.topKeywords.some(kw => ['fortran', 'cobol', 'assembler', 'mainframe', 'oldlanguage'].includes(kw))).toBe(false)
  })

  it('topKeywords contain at most 10 entries', () => {
    const pins = Array(10).fill(null).map((_, i) =>
      makePin(`word${i}alpha word${i}beta word${i}gamma word${i}delta word${i}epsilon`, daysAgo(1)),
    )
    const profile = computePinProfile(pins)
    expect(profile.topKeywords.length).toBeLessThanOrEqual(10)
  })

  it('stopwords are excluded from topKeywords', () => {
    const pin = makePin('the and for that this with have from they will', daysAgo(1))
    const pads = Array(4).fill(null).map(() =>
      makePin('unique content here with enough words for padding purposes', daysAgo(1)),
    )
    const profile = computePinProfile([pin, ...pads])
    const stopwords = ['the', 'and', 'for', 'that', 'this', 'with', 'have', 'from', 'they', 'will']
    for (const sw of stopwords) {
      expect(profile.topKeywords).not.toContain(sw)
    }
  })

  // ── gap categories ──────────────────────────────────────────────────────────

  it('gapCategories includes all MEMS_PROTECTED categories when user has no relevant pins', () => {
    const pins = Array(5).fill(null).map(() =>
      makePin('function doSomething() { const result = compute(); return result; }', daysAgo(1)),
    )
    const profile = computePinProfile(pins)
    for (const cat of MEMS_PROTECTED) {
      expect(profile.gapCategories).toContain(cat)
    }
  })

  it('gapCategories excludes a MEMS_PROTECTED category once it has enough recent pins', () => {
    // Provide enough medical pins to push weight above 0.3
    const medicalPins = Array(3).fill(null).map(() =>
      makePin('Doctor prescribed 20mg dosage for blood pressure medication', daysAgo(1)),
    )
    const codePins = Array(2).fill(null).map(() =>
      makePin('function doSomething() { const result = compute(); return result; }', daysAgo(1)),
    )
    const profile = computePinProfile([...medicalPins, ...codePins])
    expect(profile.gapCategories).not.toContain('medical')
  })

  it('recentPinCount counts only pins within last 30 days', () => {
    const recentPins = Array(3).fill(null).map(() =>
      makePin('recent content with enough unique words here', daysAgo(10)),
    )
    const oldPins = Array(2).fill(null).map(() =>
      makePin('old content with enough unique words here', daysAgo(45)),
    )
    const profile = computePinProfile([...recentPins, ...oldPins])
    expect(profile.recentPinCount).toBe(3)
  })
})

// ─── computePinBoost ──────────────────────────────────────────────────────────

describe('computePinBoost', () => {
  const makeProfile = (overrides: Partial<PinProfile> = {}): PinProfile => ({
    categoryWeights: {},
    topKeywords: [],
    gapCategories: [],
    recentPinCount: 10,
    totalPins: 20,
    isCalibrated: true,
    ...overrides,
  })

  it('returns boost 0 and empty reason when profile is not calibrated', () => {
    const profile = makeProfile({ isCalibrated: false })
    const result = computePinBoost('function doSomething() { return true; }', profile)
    expect(result.boost).toBe(0)
    expect(result.reason).toBe('')
  })

  it('boost is a number (always numeric)', () => {
    const profile = makeProfile({ categoryWeights: { code: 3.0 } })
    const result = computePinBoost('function doSomething() { return true; }', profile)
    expect(typeof result.boost).toBe('number')
  })

  it('non-protected category with weight > 2.0 returns boost +2', () => {
    const profile = makeProfile({ categoryWeights: { code: 2.5 } })
    const result = computePinBoost('function doSomething() { return true; }', profile)
    expect(result.boost).toBe(2)
    expect(result.reason).toContain('heavy pin pattern')
  })

  it('non-protected category with weight between 0.8 and 2.0 returns boost +1', () => {
    const profile = makeProfile({ categoryWeights: { code: 1.2 } })
    const result = computePinBoost('function doSomething() { return true; }', profile)
    expect(result.boost).toBe(1)
    expect(result.reason).toContain('moderate pin pattern')
  })

  it('non-protected category with weight < 0.1 returns boost -1', () => {
    const profile = makeProfile({ categoryWeights: { code: 0.05 } })
    const result = computePinBoost('function doSomething() { return true; }', profile)
    expect(result.boost).toBe(-1)
    expect(result.reason).toContain('low pin interest')
  })

  it('non-protected category with weight in the neutral range returns boost 0', () => {
    const profile = makeProfile({ categoryWeights: { code: 0.5 } })
    const result = computePinBoost('function doSomething() { return true; }', profile)
    expect(result.boost).toBe(0)
    expect(result.reason).toBe('')
  })

  it('MEMS-protected category in gapCategories returns boost +1 with gap protection reason', () => {
    const profile = makeProfile({ gapCategories: ['medical'] })
    const result = computePinBoost(
      'Doctor prescribed 20mg dosage for blood pressure medication',
      profile,
    )
    expect(result.boost).toBe(1)
    expect(result.reason).toContain('pin-gap protection')
    expect(result.reason).toContain('medical')
  })

  it('MEMS-protected category NOT in gapCategories returns boost 0 (neutral)', () => {
    const profile = makeProfile({
      categoryWeights: { medical: 1.5 },
      gapCategories: [], // medical is not a gap
    })
    const result = computePinBoost(
      'Doctor prescribed 20mg dosage for blood pressure medication',
      profile,
    )
    expect(result.boost).toBe(0)
    expect(result.reason).toBe('')
  })

  it('boost is within range [-1, +2] for all categories', () => {
    const contents = [
      'function doSomething() { return true; }',
      'Doctor prescribed 20mg dosage for blood pressure medication',
      'My mom called to wish happy birthday on March 5',
      'I prefer TypeScript over JavaScript for large projects',
      'We decided to go with PostgreSQL final decision',
      'According to the published research data shows significant results',
    ]
    const profile = makeProfile({
      categoryWeights: { code: 5.0, recipe: 0.5, research: 0.05 },
      gapCategories: ['preference', 'medical'],
    })
    for (const content of contents) {
      const { boost } = computePinBoost(content, profile)
      expect(boost).toBeGreaterThanOrEqual(-1)
      expect(boost).toBeLessThanOrEqual(2)
    }
  })
})

// ─── isDuplicateOfRecentPins ──────────────────────────────────────────────────

describe('isDuplicateOfRecentPins', () => {
  it('returns false when the pins array is empty', () => {
    expect(isDuplicateOfRecentPins('some unique content here words', [])).toBe(false)
  })

  it('returns false when there are no recent pins (all pins are old)', () => {
    const oldPin = makePin(
      'typescript javascript nodejs webpack frontend backend',
      daysAgo(30), // outside default 14-day window
    )
    expect(isDuplicateOfRecentPins(
      'typescript javascript nodejs webpack frontend backend',
      [oldPin],
    )).toBe(false)
  })

  it('returns true for identical content pinned recently', () => {
    const content = 'typescript javascript nodejs webpack frontend backend bundler'
    const pin = makePin(content, daysAgo(1))
    expect(isDuplicateOfRecentPins(content, [pin])).toBe(true)
  })

  it('returns false for completely different content', () => {
    const existingPin = makePin(
      'typescript javascript nodejs webpack frontend backend',
      daysAgo(1),
    )
    const newContent = 'recipe ingredients tablespoon simmer preheat oven baking bread'
    expect(isDuplicateOfRecentPins(newContent, [existingPin])).toBe(false)
  })

  it('returns false when new content has fewer than 3 keywords', () => {
    // Short content after keyword extraction will have < 3 words
    const pin = makePin('typescript javascript nodejs', daysAgo(1))
    expect(isDuplicateOfRecentPins('typescript', [pin])).toBe(false)
  })

  it('returns true when Jaccard similarity is above the 0.55 threshold', () => {
    // Craft two strings with high overlap
    const base = 'typescript javascript nodejs webpack vite vitest coverage testing linting'
    const similar = 'typescript javascript nodejs webpack vite vitest coverage testing linting eslint prettier'
    const pin = makePin(base, daysAgo(1))
    expect(isDuplicateOfRecentPins(similar, [pin])).toBe(true)
  })

  it('returns false when Jaccard similarity is below the 0.55 threshold', () => {
    const pinContent = 'typescript javascript nodejs webpack vite vitest coverage testing'
    const lowOverlap = 'python django flask sqlalchemy celery redis postgres deployment docker'
    const pin = makePin(pinContent, daysAgo(1))
    expect(isDuplicateOfRecentPins(lowOverlap, [pin])).toBe(false)
  })

  it('respects a custom windowDays parameter', () => {
    const content = 'typescript javascript nodejs webpack frontend backend bundler'
    // Pin is 10 days old — within 14-day default but outside a 7-day window
    const pin = makePin(content, daysAgo(10))
    expect(isDuplicateOfRecentPins(content, [pin], 7)).toBe(false)
    expect(isDuplicateOfRecentPins(content, [pin], 14)).toBe(true)
  })

  it('respects a custom threshold parameter', () => {
    const base = 'typescript javascript nodejs webpack vite vitest coverage testing linting'
    const similar = 'typescript javascript nodejs webpack vite vitest coverage testing linting eslint prettier'
    const pin = makePin(base, daysAgo(1))
    // With a very high threshold (0.95) it should not be considered a duplicate
    expect(isDuplicateOfRecentPins(similar, [pin], 14, 0.95)).toBe(false)
    // With a low threshold (0.3) it should be a duplicate
    expect(isDuplicateOfRecentPins(similar, [pin], 14, 0.3)).toBe(true)
  })
})

// ─── formatPinProfileForPrompt ────────────────────────────────────────────────

describe('formatPinProfileForPrompt', () => {
  it('returns empty string for a non-calibrated profile', () => {
    expect(formatPinProfileForPrompt(EMPTY_PROFILE)).toBe('')
  })

  it('returns a non-empty string for a calibrated profile', () => {
    const profile: PinProfile = {
      categoryWeights: { code: 2.0 },
      topKeywords: ['typescript', 'react'],
      gapCategories: [],
      recentPinCount: 8,
      totalPins: 20,
      isCalibrated: true,
    }
    const result = formatPinProfileForPrompt(profile)
    expect(result.length).toBeGreaterThan(0)
  })

  it('output contains total pin count', () => {
    const profile: PinProfile = {
      categoryWeights: { code: 1.0 },
      topKeywords: [],
      gapCategories: [],
      recentPinCount: 5,
      totalPins: 15,
      isCalibrated: true,
    }
    expect(formatPinProfileForPrompt(profile)).toContain('15')
  })

  it('output contains recent pin topics when topKeywords is populated', () => {
    const profile: PinProfile = {
      categoryWeights: { code: 1.0 },
      topKeywords: ['typescript', 'react', 'testing'],
      gapCategories: [],
      recentPinCount: 5,
      totalPins: 10,
      isCalibrated: true,
    }
    const result = formatPinProfileForPrompt(profile)
    expect(result).toContain('typescript')
    expect(result).toContain('Recent pin topics')
  })

  it('output contains dedup rule for near-duplicate detection', () => {
    const profile: PinProfile = {
      categoryWeights: { code: 1.0 },
      topKeywords: [],
      gapCategories: [],
      recentPinCount: 5,
      totalPins: 10,
      isCalibrated: true,
    }
    expect(formatPinProfileForPrompt(profile)).toContain('Dedup rule')
  })

  it('output mentions gap categories with MEMS protection language', () => {
    const profile: PinProfile = {
      categoryWeights: {},
      topKeywords: [],
      gapCategories: ['medical', 'preference'],
      recentPinCount: 5,
      totalPins: 10,
      isCalibrated: true,
    }
    const result = formatPinProfileForPrompt(profile)
    expect(result).toContain('medical')
    expect(result).toContain('MEMS protection')
  })

  it('heavy categories (weight > 0.8) are listed in the actively-saves line', () => {
    const profile: PinProfile = {
      categoryWeights: { code: 3.0, research: 1.2, recipe: 0.2 },
      topKeywords: [],
      gapCategories: [],
      recentPinCount: 5,
      totalPins: 15,
      isCalibrated: true,
    }
    const result = formatPinProfileForPrompt(profile)
    expect(result).toContain('Actively saves')
    expect(result).toContain('code')
    expect(result).toContain('research')
    // recipe has weight < 0.8, should not appear in "actively saves"
    expect(result).not.toMatch(/Actively saves.*recipe/)
  })

  it('does not include "Actively saves" line when no category exceeds weight 0.8', () => {
    const profile: PinProfile = {
      categoryWeights: { code: 0.5, recipe: 0.3 },
      topKeywords: [],
      gapCategories: [],
      recentPinCount: 5,
      totalPins: 10,
      isCalibrated: true,
    }
    const result = formatPinProfileForPrompt(profile)
    expect(result).not.toContain('Actively saves')
  })

  it('output starts with the USER MEMORY FINGERPRINT header', () => {
    const profile: PinProfile = {
      categoryWeights: { code: 1.5 },
      topKeywords: [],
      gapCategories: [],
      recentPinCount: 5,
      totalPins: 10,
      isCalibrated: true,
    }
    const result = formatPinProfileForPrompt(profile)
    expect(result).toContain('[USER MEMORY FINGERPRINT]')
  })
})
