import { describe, it, expect } from 'vitest'
import {
  hasMailFilter,
  filterMailForDigest,
  unseenHeaders,
  memoryPathFor,
  shouldWriteMemory,
  matchesWatch,
  detectRoutineIntent,
  type Routine,
} from '../../services/routines'

// ─── Following a source vs being briefed ──────────────────────────────────────
//
// A digest gathering EVERYTHING is a briefing: today's supersedes yesterday's, and one file
// per routine is correct. A digest following ONE source — a newsletter — is the opposite: it
// must gather only that, capture the body rather than the subject line, and accumulate, because
// issue 47 erasing issue 46 destroys exactly what the user asked to keep.

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  name: 'Breaking Points',
  trigger: { kind: 'mailWatch', everyMinutes: 15 },
  action: 'digest',
  sources: { mail: true },
  ownerId: 'docent',
  enabled: true,
  createdAt: 0,
  ...over,
})

const hdr = (uid: number, fromName: string, subject: string) =>
  ({ uid, fromName, fromEmail: `${fromName.toLowerCase().replace(/\s/g, '')}@example.com`, subject })

const INBOX = [
  hdr(1, 'Breaking Points', 'BP #212 — the week in review'),
  hdr(2, 'Sam', 'lunch tomorrow?'),
  hdr(3, 'Breaking Points', 'BP #213 — special episode'),
  hdr(4, 'GitHub', '[docent] build failed'),
]

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('filterMailForDigest', () => {
  it('gathers EVERYTHING when unfiltered — that is a briefing', () => {
    expect(filterMailForDigest(routine(), INBOX)).toHaveLength(4)
  })

  it('gathers only the followed source when filtered', () => {
    const r = routine({ fromContains: 'Breaking Points' })
    expect(filterMailForDigest(r, INBOX).map(h => h.uid)).toEqual([1, 3])
  })

  it('matches on subject too', () => {
    expect(filterMailForDigest(routine({ subjectContains: 'build failed' }), INBOX).map(h => h.uid))
      .toEqual([4])
  })

  it('requires BOTH when both are given', () => {
    const r = routine({ fromContains: 'Breaking Points', subjectContains: '#213' })
    expect(filterMailForDigest(r, INBOX).map(h => h.uid)).toEqual([3])
  })

  it('is case-insensitive', () => {
    expect(filterMailForDigest(routine({ fromContains: 'BREAKING points' }), INBOX)).toHaveLength(2)
  })

  it('takes the OPPOSITE empty-case to matchesWatch, deliberately', () => {
    // An unconfigured WATCHER must flag nothing — flagging the whole inbox is destructive.
    // An unconfigured DIGEST is a briefing and must see everything. Same fields, opposite
    // default, which is exactly why they cannot share one predicate.
    const bare = routine()
    expect(matchesWatch(bare, INBOX[0])).toBe(false)
    expect(filterMailForDigest(bare, INBOX)).toHaveLength(4)
  })

  it('survives a malformed inbox', () => {
    expect(filterMailForDigest(routine({ fromContains: 'x' }), undefined as any)).toEqual([])
  })
})

describe('hasMailFilter', () => {
  it('is false for blank and whitespace-only filters', () => {
    expect(hasMailFilter(routine())).toBe(false)
    expect(hasMailFilter(routine({ fromContains: '   ' }))).toBe(false)
  })
  it('is true when either field is set', () => {
    expect(hasMailFilter(routine({ subjectContains: 'BP' }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Dedupe — the thing that stops a poller from spamming
// ---------------------------------------------------------------------------

describe('unseenHeaders', () => {
  it('drops anything captured on a previous run', () => {
    // Without this a 15-minute watch re-captures the same issue 96 times a day.
    const r = routine({ seenUids: [1] })
    expect(unseenHeaders(r, INBOX).map(h => h.uid)).toEqual([2, 3, 4])
  })

  it('returns everything on a first run', () => {
    expect(unseenHeaders(routine(), INBOX)).toHaveLength(4)
  })

  it('ignores headers with a non-numeric uid rather than treating them as new', () => {
    expect(unseenHeaders(routine(), [{ uid: NaN } as any])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

describe('memoryPathFor', () => {
  const at = new Date('2026-08-08T21:04:11.000Z')

  it('defaults to one stable file — the shipped behaviour', () => {
    expect(memoryPathFor(routine(), at)).toBe('routines/breaking-points.md')
    expect(memoryPathFor(routine({ filing: 'latest' }), at)).toBe('routines/breaking-points.md')
  })

  it('archives per run, under the routine folder', () => {
    expect(memoryPathFor(routine({ filing: 'archive' }), at))
      .toBe('routines/breaking-points/2026-08-08-2104.md')
  })

  it('archived runs sort chronologically by filename', () => {
    const a = memoryPathFor(routine({ filing: 'archive' }), new Date('2026-08-08T09:00:00Z'))
    const b = memoryPathFor(routine({ filing: 'archive' }), new Date('2026-08-08T21:00:00Z'))
    const c = memoryPathFor(routine({ filing: 'archive' }), new Date('2026-09-01T09:00:00Z'))
    expect([c, a, b].sort()).toEqual([a, b, c])
  })

  it('never emits a path-traversing or empty slug', () => {
    expect(memoryPathFor(routine({ name: '../../etc/passwd' }), at)).toBe('routines/etc-passwd.md')
    expect(memoryPathFor(routine({ name: '!!!' }), at)).toBe('routines/routine-briefing.md')
  })

  it('two issues on the same day do not collide', () => {
    const morning = memoryPathFor(routine({ filing: 'archive' }), new Date('2026-08-08T08:00:00Z'))
    const evening = memoryPathFor(routine({ filing: 'archive' }), new Date('2026-08-08T20:00:00Z'))
    expect(morning).not.toBe(evening)
  })
})

describe('shouldWriteMemory', () => {
  it('writes nothing when saving is off', () => {
    expect(shouldWriteMemory(routine({ saveToMemory: false, filing: 'archive' }), true)).toBe(false)
  })

  it('an ARCHIVE run with nothing new writes nothing', () => {
    // Otherwise every empty poll files an "I found nothing" document and the knowledge base
    // fills with the absence of news.
    expect(shouldWriteMemory(routine({ saveToMemory: true, filing: 'archive' }), false)).toBe(false)
  })

  it('an ARCHIVE run with something new writes', () => {
    expect(shouldWriteMemory(routine({ saveToMemory: true, filing: 'archive' }), true)).toBe(true)
  })

  it('a LATEST briefing writes even on a quiet day', () => {
    // "Quiet today" superseding yesterday is information.
    expect(shouldWriteMemory(routine({ saveToMemory: true }), false)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The whole use case, end to end over the pure layer
// ---------------------------------------------------------------------------

describe('"follow the Breaking Points newsletter into my knowledge base"', () => {
  const r = routine({
    fromContains: 'Breaking Points',
    saveToMemory: true,
    filing: 'archive',
    instruction: 'Summarise the main segments and who was on.',
  })

  it('first poll captures both issues and files them separately', () => {
    const matched = unseenHeaders(r, filterMailForDigest(r, INBOX))
    expect(matched.map(h => h.uid)).toEqual([1, 3])
    expect(shouldWriteMemory(r, matched.length > 0)).toBe(true)
  })

  it('the next poll, with nothing new, captures nothing and files nothing', () => {
    const after = { ...r, seenUids: [1, 3] }
    const matched = unseenHeaders(after, filterMailForDigest(after, INBOX))
    expect(matched).toEqual([])
    expect(shouldWriteMemory(after, matched.length > 0)).toBe(false)
  })

  it('a new issue arriving is captured on its own', () => {
    const after = { ...r, seenUids: [1, 3] }
    const withNew = [...INBOX, hdr(5, 'Breaking Points', 'BP #214')]
    expect(unseenHeaders(after, filterMailForDigest(after, withNew)).map(h => h.uid)).toEqual([5])
  })

  it('never captures unrelated mail, however busy the inbox', () => {
    const noisy = [...INBOX, hdr(9, 'Newsletter Digest', 'breaking news roundup')]
    expect(filterMailForDigest(r, noisy).map(h => h.uid)).toEqual([1, 3])
  })
})

// ---------------------------------------------------------------------------
// Intent detection — and the cadence default
// ---------------------------------------------------------------------------

describe('detectRoutineIntent — following a source', () => {
  it('proposes a daily, archiving, memory-filing digest', () => {
    const p = detectRoutineIntent('capture the newsletter from Breaking Points in my email')!
    expect(p).toBeTruthy()
    expect(p.action).toBe('digest')
    expect(p.fromContains).toMatch(/Breaking Points/i)
    expect(p.filing).toBe('archive')
    expect(p.saveToMemory).toBe(true)
  })

  it('defaults to ONCE A DAY, not a constant poll', () => {
    // A newsletter does not need 288 IMAP connections a day to learn something that changed
    // once. Daily is the default; urgency is opt-in.
    const p = detectRoutineIntent('follow the emails from Breaking Points')!
    expect(p.trigger.kind).toBe('daily')
    expect(p.summary).toContain('once a day')
  })

  it('only polls frequently when the user actually asks for immediacy', () => {
    const p = detectRoutineIntent('track email from Breaking Points and tell me immediately')!
    expect(p.trigger.kind).toBe('mailWatch')
  })

  it('beats the watch branch — capturing is about KEEPING, not being interrupted', () => {
    // "watch" appears, but the intent is capture; the watch branch would only flag the mail.
    const p = detectRoutineIntent('watch my email and capture everything from Breaking Points')!
    expect(p.action).toBe('digest')
    expect(p.saveToMemory).toBe(true)
  })

  it('still proposes a plain flag when the user only wants to be told', () => {
    const p = detectRoutineIntent('flag any email from my landlord')!
    expect(p.action).toBe('mailFlag')
  })

  it('needs a target — "capture my email" is not a source to follow', () => {
    const p = detectRoutineIntent('capture my email')
    expect(p?.action).not.toBe('digest')
  })

  it('leaves one-off requests alone', () => {
    expect(detectRoutineIntent('summarize this email for me')).toBeNull()
  })
})
