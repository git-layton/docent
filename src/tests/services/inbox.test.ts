import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sanitizeInboxId,
  normalizeInboxOwners,
  mergeInboxOwners,
  ownerLabel,
  formatCaptureAge,
  slugifyCapture,
  inferCaptureKind,
  buildCaptureMarkdown,
  DEFAULT_INBOX_OWNERS,
  type CaptureItem,
  type InboxOwner,
} from '../../services/inbox'

// ---------------------------------------------------------------------------
// sanitizeInboxId
// ---------------------------------------------------------------------------
describe('sanitizeInboxId', () => {
  it('passes alphanumeric input through unchanged (lowercased)', () => {
    expect(sanitizeInboxId('Primary')).toBe('primary')
  })

  it('preserves dashes and underscores', () => {
    expect(sanitizeInboxId('my-inbox_1')).toBe('my-inbox_1')
  })

  it('strips spaces (replacing with dash)', () => {
    expect(sanitizeInboxId('hello world')).toBe('hello-world')
  })

  it('strips special characters', () => {
    expect(sanitizeInboxId('inbox@user!#$%')).toBe('inbox-user')
  })

  it('collapses multiple special chars into a single dash', () => {
    expect(sanitizeInboxId('a  b')).toBe('a-b')
  })

  it('trims leading and trailing dashes', () => {
    expect(sanitizeInboxId('  hello  ')).toBe('hello')
  })

  it('returns fallback when result is empty', () => {
    expect(sanitizeInboxId('!!!', 'primary')).toBe('primary')
  })

  it('returns fallback when input is empty string', () => {
    expect(sanitizeInboxId('')).toBe('primary')
  })

  it('accepts a custom fallback parameter', () => {
    expect(sanitizeInboxId('', 'default-inbox')).toBe('default-inbox')
  })

  it('handles null-ish input via String() coercion', () => {
    // The function calls String(input || '') — null coerces to '' then to empty string
    expect(sanitizeInboxId(null as unknown as string, 'fallback')).toBe('fallback')
  })

  it('truncates very long input to 80 chars', () => {
    const long = 'a'.repeat(100)
    expect(sanitizeInboxId(long)).toHaveLength(80)
  })
})

// ---------------------------------------------------------------------------
// normalizeInboxOwners
// ---------------------------------------------------------------------------
describe('normalizeInboxOwners', () => {
  it('returns empty-array input as DEFAULT_INBOX_OWNERS', () => {
    expect(normalizeInboxOwners([])).toEqual(DEFAULT_INBOX_OWNERS)
  })

  it('returns undefined input as DEFAULT_INBOX_OWNERS', () => {
    expect(normalizeInboxOwners(undefined)).toEqual(DEFAULT_INBOX_OWNERS)
  })

  it('deduplicates owners with the same id', () => {
    const owners = [
      { id: 'main', label: 'Main' },
      { id: 'main', label: 'Main duplicate' },
      { id: 'secondary', label: 'Secondary' },
    ]
    const result = normalizeInboxOwners(owners)
    const ids = result.map(o => o.id)
    expect(ids.filter(id => id === 'main')).toHaveLength(1)
    expect(result).toHaveLength(2)
  })

  it('normalizes label to trimmed string', () => {
    const result = normalizeInboxOwners([{ id: 'work', label: '  Work  ' }])
    expect(result[0].label).toBe('Work')
  })

  it('sanitizes id through sanitizeInboxId', () => {
    const result = normalizeInboxOwners([{ id: 'My Inbox!', label: 'My Inbox' }])
    expect(result[0].id).toBe('my-inbox')
  })

  it('falls back to "Inbox" label when label is empty', () => {
    const result = normalizeInboxOwners([{ id: 'test', label: '' }])
    expect(result[0].label).toBe('Inbox')
  })

  it('returns valid normalized array for well-formed input', () => {
    const owners = [
      { id: 'personal', label: 'Personal' },
      { id: 'shared', label: 'Shared' },
    ]
    const result = normalizeInboxOwners(owners)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 'personal', label: 'Personal' })
  })
})

// ---------------------------------------------------------------------------
// mergeInboxOwners
// ---------------------------------------------------------------------------
describe('mergeInboxOwners', () => {
  it('returns configured owners when no captures', () => {
    const configured: InboxOwner[] = [{ id: 'primary', label: 'Primary' }]
    expect(mergeInboxOwners(configured, [])).toEqual(configured)
  })

  it('adds new owners discovered in captures', () => {
    const configured: InboxOwner[] = [{ id: 'primary', label: 'Primary' }]
    const captures = [
      { ownerId: 'team', ownerLabel: 'Team' },
    ] as CaptureItem[]
    const result = mergeInboxOwners(configured, captures)
    expect(result).toHaveLength(2)
    expect(result[1].id).toBe('team')
    expect(result[1].label).toBe('Team')
  })

  it('does not add duplicates that are already in configured', () => {
    const configured: InboxOwner[] = [{ id: 'primary', label: 'Primary' }]
    const captures = [
      { ownerId: 'primary', ownerLabel: 'Primary Duplicate' },
    ] as CaptureItem[]
    const result = mergeInboxOwners(configured, captures)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('Primary') // configured takes priority
  })

  it('deduplicates multiple captures with the same ownerId', () => {
    const configured: InboxOwner[] = [{ id: 'primary', label: 'Primary' }]
    const captures = [
      { ownerId: 'alpha', ownerLabel: 'Alpha' },
      { ownerId: 'alpha', ownerLabel: 'Alpha Again' },
    ] as CaptureItem[]
    const result = mergeInboxOwners(configured, captures)
    const alphas = result.filter(o => o.id === 'alpha')
    expect(alphas).toHaveLength(1)
  })

  it('uses ownerId as label when ownerLabel is absent', () => {
    const configured: InboxOwner[] = []
    const captures = [{ ownerId: 'beta' }] as CaptureItem[]
    const result = mergeInboxOwners(configured, captures)
    expect(result[0].label).toBe('beta')
  })
})

// ---------------------------------------------------------------------------
// ownerLabel
// ---------------------------------------------------------------------------
describe('ownerLabel', () => {
  it('returns label for known owner', () => {
    const owners: InboxOwner[] = [{ id: 'main', label: 'Main Inbox' }]
    expect(ownerLabel('main', owners)).toBe('Main Inbox')
  })

  it('returns ownerId itself when not found in owners', () => {
    const owners: InboxOwner[] = [{ id: 'main', label: 'Main Inbox' }]
    expect(ownerLabel('unknown', owners)).toBe('unknown')
  })

  it('uses DEFAULT_INBOX_OWNERS when owners arg omitted', () => {
    expect(ownerLabel('primary')).toBe('Primary')
    expect(ownerLabel('shared')).toBe('Shared')
  })

  it('returns ownerId when not found in default owners', () => {
    expect(ownerLabel('nonexistent')).toBe('nonexistent')
  })
})

// ---------------------------------------------------------------------------
// formatCaptureAge
// ---------------------------------------------------------------------------
describe('formatCaptureAge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('returns "now" for a timestamp less than 1 minute ago', () => {
    const now = Date.now()
    vi.setSystemTime(now + 30_000) // 30 seconds later
    expect(formatCaptureAge(now)).toBe('now')
  })

  it('returns "now" for a timestamp exactly at now', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatCaptureAge(now)).toBe('now')
  })

  it('returns "30m ago" for a timestamp 30 minutes ago', () => {
    const now = Date.now()
    vi.setSystemTime(now + 30 * 60_000)
    expect(formatCaptureAge(now)).toBe('30m ago')
  })

  it('returns "1m ago" for a timestamp exactly 1 minute ago', () => {
    const now = Date.now()
    vi.setSystemTime(now + 60_000)
    expect(formatCaptureAge(now)).toBe('1m ago')
  })

  it('returns "2h ago" for a timestamp 2 hours ago', () => {
    const now = Date.now()
    vi.setSystemTime(now + 2 * 60 * 60_000)
    expect(formatCaptureAge(now)).toBe('2h ago')
  })

  it('returns "1h ago" for a timestamp exactly 60 minutes ago', () => {
    const now = Date.now()
    vi.setSystemTime(now + 60 * 60_000)
    expect(formatCaptureAge(now)).toBe('1h ago')
  })

  it('returns "3d ago" for a timestamp 3 days ago', () => {
    const now = Date.now()
    vi.setSystemTime(now + 3 * 24 * 60 * 60_000)
    expect(formatCaptureAge(now)).toBe('3d ago')
  })

  it('clamps negative diff to 0 (returns "now" for future timestamps)', () => {
    const now = Date.now()
    vi.setSystemTime(now - 60_000) // set clock to the past
    expect(formatCaptureAge(now)).toBe('now') // future timestamp → diff=0
  })
})

// ---------------------------------------------------------------------------
// slugifyCapture
// ---------------------------------------------------------------------------
describe('slugifyCapture', () => {
  it('lowercases and slug-ifies a normal title', () => {
    expect(slugifyCapture('Hello World')).toBe('hello-world')
  })

  it('strips special characters', () => {
    expect(slugifyCapture('note: important!')).toBe('note-important')
  })

  it('collapses consecutive non-alphanumeric chars into a single dash', () => {
    expect(slugifyCapture('a -- b')).toBe('a-b')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugifyCapture('  hello  ')).toBe('hello')
  })

  it('returns fallback when slug is empty', () => {
    expect(slugifyCapture('!!!', 'capture')).toBe('capture')
  })

  it('uses default fallback "capture" when not specified', () => {
    expect(slugifyCapture('')).toBe('capture')
  })

  it('truncates to 72 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugifyCapture(long)).toHaveLength(72)
  })
})

// ---------------------------------------------------------------------------
// inferCaptureKind
// ---------------------------------------------------------------------------
describe('inferCaptureKind', () => {
  it('returns "text" when only bodyText is present', () => {
    expect(inferCaptureKind({ bodyText: 'hello' })).toBe('text')
  })

  it('returns "text" for empty payload', () => {
    expect(inferCaptureKind({})).toBe('text')
  })

  it('returns "url" when only urls are present', () => {
    expect(inferCaptureKind({ urls: ['https://example.com'] })).toBe('url')
  })

  it('returns "mixed" when both bodyText and urls are present', () => {
    expect(inferCaptureKind({ bodyText: 'note', urls: ['https://example.com'] })).toBe('mixed')
  })

  it('returns "image" for a single image attachment with no text/urls', () => {
    expect(inferCaptureKind({ attachments: [{ mimeType: 'image/png' }] })).toBe('image')
  })

  it('returns "mixed" for an image attachment combined with bodyText', () => {
    expect(inferCaptureKind({ bodyText: 'caption', attachments: [{ mimeType: 'image/jpeg' }] })).toBe('mixed')
  })

  it('returns "audio" for a single audio attachment with no text/urls', () => {
    expect(inferCaptureKind({ attachments: [{ mimeType: 'audio/mpeg' }] })).toBe('audio')
  })

  it('returns "mixed" for an audio attachment combined with urls', () => {
    expect(inferCaptureKind({ urls: ['https://example.com'], attachments: [{ mimeType: 'audio/wav' }] })).toBe('mixed')
  })

  it('returns "file" for a single non-image/audio attachment', () => {
    expect(inferCaptureKind({ attachments: [{ mimeType: 'application/pdf' }] })).toBe('file')
  })

  it('returns "mixed" for a file attachment combined with bodyText', () => {
    expect(inferCaptureKind({ bodyText: 'see attached', attachments: [{ mimeType: 'application/pdf' }] })).toBe('mixed')
  })

  it('returns "mixed" for multiple attachments regardless of type', () => {
    expect(inferCaptureKind({
      attachments: [
        { mimeType: 'image/png' },
        { mimeType: 'image/jpeg' },
      ],
    })).toBe('mixed')
  })
})

// ---------------------------------------------------------------------------
// buildCaptureMarkdown
// ---------------------------------------------------------------------------
describe('buildCaptureMarkdown', () => {
  const makeCapture = (overrides: Partial<CaptureItem> = {}): CaptureItem => ({
    id: 'cap-001',
    ownerId: 'primary',
    ownerLabel: 'Primary',
    source: 'test',
    kind: 'text',
    status: 'received',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    title: 'Test Capture',
    bodyText: 'Some capture text.',
    urls: [],
    attachments: [],
    note: '',
    channelHint: '',
    channelId: '',
    agentId: '',
    tags: [],
    rawPath: '/tmp/raw.md',
    processedPaths: [],
    error: '',
    ...overrides,
  })

  it('returns a non-empty string', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'A test capture.',
      facts: ['Fact one'],
      tags: ['test'],
      targetLabel: 'agent-1',
    })
    expect(md.length).toBeGreaterThan(0)
  })

  it('contains YAML frontmatter block', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'A test capture.',
      facts: [],
      tags: [],
      targetLabel: 'agent-1',
    })
    expect(md).toMatch(/^---\n/)
    expect(md).toContain('---')
    expect(md).toContain('type: "inbox-capture"')
  })

  it('contains the capture title as a heading', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture({ title: 'My Capture Title' }),
      summary: 'Summary text.',
      facts: [],
      tags: [],
      targetLabel: 'agent-1',
    })
    expect(md).toContain('# My Capture Title')
  })

  it('contains the summary text', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'Very important summary.',
      facts: [],
      tags: [],
      targetLabel: 'agent-1',
    })
    expect(md).toContain('Very important summary.')
  })

  it('contains the capture body text', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture({ bodyText: 'Body content here.' }),
      summary: 'summary',
      facts: [],
      tags: [],
      targetLabel: 'agent-1',
    })
    expect(md).toContain('Body content here.')
  })

  it('includes extracted facts', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'summary',
      facts: ['Fact A', 'Fact B'],
      tags: [],
      targetLabel: 'agent-1',
    })
    expect(md).toContain('- Fact A')
    expect(md).toContain('- Fact B')
  })

  it('falls back to "No durable facts extracted." when facts is empty', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'summary',
      facts: [],
      tags: [],
      targetLabel: 'agent-1',
    })
    expect(md).toContain('No durable facts extracted.')
  })

  it('uses scope "channel" when targetLabel starts with "channel:"', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'summary',
      facts: [],
      tags: [],
      targetLabel: 'channel:general',
    })
    expect(md).toContain('scope: "channel"')
  })

  it('uses scope "library" when targetLabel is "library"', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'summary',
      facts: [],
      tags: [],
      targetLabel: 'library',
    })
    expect(md).toContain('scope: "library"')
  })

  it('uses scope "agent" for any other targetLabel', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'summary',
      facts: [],
      tags: [],
      targetLabel: 'agent-xyz',
    })
    expect(md).toContain('scope: "agent"')
  })

  it('includes gatekeeper decision reason when provided', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture(),
      summary: 'summary',
      facts: [],
      tags: [],
      targetLabel: 'agent-1',
      gatekeeperDecision: { reason: 'high priority capture' },
    })
    expect(md).toContain('high priority capture')
  })

  it('falls back to default title "Inbox Capture" when capture title is empty', () => {
    const md = buildCaptureMarkdown({
      capture: makeCapture({ title: '' }),
      summary: 'summary',
      facts: [],
      tags: [],
      targetLabel: 'agent-1',
    })
    expect(md).toContain('# Inbox Capture')
  })
})
