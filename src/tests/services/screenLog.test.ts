import { describe, it, expect } from 'vitest'
import {
  shouldCapture,
  redactSecrets,
  shouldStore,
  makeEntry,
  entryToBlock,
  recall,
  DEFAULT_POLICY,
  MIN_ENTRY_INTERVAL_MS,
  MIN_ENTRY_CHARS,
  type WindowRef,
  type ScreenLogEntry,
} from '../../services/screenLog'
import { groundsWorldClaims, countsAsGrounding, type Block } from '../../services/provenance'

const NOW = 1_800_000_000_000

const win = (app: string, title = 'Untitled', id = 1): WindowRef => ({ id, app, title })

const entry = (over: Partial<ScreenLogEntry> = {}): ScreenLogEntry => ({
  id: 'screen-1',
  app: 'Safari',
  windowTitle: 'Prompt injection — Simon Willison',
  text: 'Prompt injection remains the highest-ranked risk for LLM applications.',
  frameId: 'frame-1',
  seenAt: NOW,
  ...over,
})

// ---------------------------------------------------------------------------
// Exclusions — the safety-critical half
// ---------------------------------------------------------------------------

describe('shouldCapture — the promise', () => {
  it('captures an ordinary window', () => {
    expect(shouldCapture(win('Safari', 'Docs — MDN')).capture).toBe(true)
  })

  it('never captures a password manager, by default and unasked', () => {
    for (const app of ['1Password', 'Bitwarden', 'KeePassXC', 'Keychain Access', 'Proton Pass']) {
      const d = shouldCapture(win(app))
      expect(d.capture).toBe(false)
      expect(d.capture === false && d.reason).toBe('excluded-app')
    }
  })

  it('never captures Docent itself — no hall of mirrors', () => {
    // A viewer capturing its own window would log content from windows that were
    // themselves excluded, laundering them back in.
    expect(shouldCapture(win('Docent', 'Prompt injection')).capture).toBe(false)
    expect(shouldCapture(win('Agent Forge')).capture).toBe(false)
  })

  it('vetoes private-browsing windows in any app', () => {
    expect(shouldCapture(win('Google Chrome', 'Gmail — Incognito')).capture).toBe(false)
    expect(shouldCapture(win('Safari', 'Private Browsing')).capture).toBe(false)
    expect(shouldCapture(win('Microsoft Edge', 'InPrivate — news')).capture).toBe(false)
  })

  it('vetoes credential-shaped titles in any app', () => {
    expect(shouldCapture(win('Notes', 'recovery phrase')).capture).toBe(false)
    expect(shouldCapture(win('TextEdit', 'my passwords.txt')).capture).toBe(false)
  })

  it('matches app names case-insensitively and as substrings', () => {
    expect(shouldCapture(win('1password 8')).capture).toBe(false)
    expect(shouldCapture(win('BITWARDEN')).capture).toBe(false)
  })

  it('refuses windows it cannot name, rather than defaulting to capture', () => {
    // Defaulting to "capture" for an unidentifiable window inverts the promise.
    expect(shouldCapture(win('', 'something')).capture).toBe(false)
    expect(shouldCapture(null).capture).toBe(false)
    expect(shouldCapture({ id: NaN, app: 'Safari', title: 'x' }).capture).toBe(false)
  })
})

describe('shouldCapture — allowlist mode', () => {
  const policy = { ...DEFAULT_POLICY, allowedApps: ['Safari', 'Visual Studio Code'] }

  it('captures only the named apps', () => {
    expect(shouldCapture(win('Safari'), policy).capture).toBe(true)
    expect(shouldCapture(win('Visual Studio Code'), policy).capture).toBe(true)
    const d = shouldCapture(win('Slack'), policy)
    expect(d.capture).toBe(false)
    expect(d.capture === false && d.reason).toBe('not-allowlisted')
  })

  it('the denylist still wins over the allowlist', () => {
    // Opting into "capture my browser" must not opt you into incognito windows.
    expect(shouldCapture(win('Safari', 'Private Browsing'), policy).capture).toBe(false)
  })

  it('cannot be used to re-enable an excluded app', () => {
    const sneaky = { ...DEFAULT_POLICY, allowedApps: ['1Password'] }
    expect(shouldCapture(win('1Password'), sneaky).capture).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Redaction — the net for allowed windows
// ---------------------------------------------------------------------------

describe('redactSecrets', () => {
  it('masks provider API keys and tokens', () => {
    expect(redactSecrets('export KEY=sk-abcdefghij1234567890abcd')).not.toContain('abcdefghij1234567890')
    expect(redactSecrets('ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toContain('[redacted-token]')
    expect(redactSecrets('xoxb-1234567890-abcdef')).toContain('[redacted-token]')
    expect(redactSecrets('AKIAIOSFODNN7EXAMPLE')).toContain('[redacted-key]')
  })

  it('masks JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'
    expect(redactSecrets(jwt)).toContain('[redacted-jwt]')
  })

  it('masks card-shaped digit runs', () => {
    expect(redactSecrets('card 4111 1111 1111 1111 exp')).toContain('[redacted-number]')
  })

  it('masks explicitly labelled secrets', () => {
    expect(redactSecrets('password: hunter2')).not.toContain('hunter2')
    expect(redactSecrets('api_key = abc123def456')).not.toContain('abc123def456')
  })

  it('leaves ordinary prose completely alone', () => {
    // A redactor that eats normal text makes the log useless and gets switched off.
    const prose = 'Prompt injection remains the highest-ranked risk for LLM applications in 2026.'
    expect(redactSecrets(prose)).toBe(prose)
  })
})

// ---------------------------------------------------------------------------
// Sampling — what makes a log affordable
// ---------------------------------------------------------------------------

describe('shouldStore', () => {
  const base = { isDelta: true, text: 'a'.repeat(80), lastEntryAt: null, now: NOW }

  it('stores a changed frame with real content', () => {
    expect(shouldStore(base).store).toBe(true)
  })

  it('skips an unchanged frame', () => {
    // The delta filter already exists (hasFrameChanged) and is currently ignored
    // by the viewer's raw 500ms timer. Gating on it is the whole affordability story.
    const d = shouldStore({ ...base, isDelta: false })
    expect(d.store).toBe(false)
    expect(d.store === false && d.reason).toBe('no-change')
  })

  it('rate-limits however fast the screen changes', () => {
    const d = shouldStore({ ...base, lastEntryAt: NOW - (MIN_ENTRY_INTERVAL_MS - 1) })
    expect(d.store).toBe(false)
    expect(d.store === false && d.reason).toBe('too-soon')
  })

  it('stores again once the interval has passed', () => {
    expect(shouldStore({ ...base, lastEntryAt: NOW - MIN_ENTRY_INTERVAL_MS }).store).toBe(true)
  })

  it('skips a near-empty screen', () => {
    const d = shouldStore({ ...base, text: 'hi' })
    expect(d.store).toBe(false)
    expect(d.store === false && d.reason).toBe('too-little-text')
  })

  it('skips an exact duplicate of the previous entry', () => {
    const text = 'b'.repeat(80)
    const d = shouldStore({ ...base, text, lastEntryAt: NOW - 10_000, lastEntryText: text })
    expect(d.store).toBe(false)
    expect(d.store === false && d.reason).toBe('duplicate')
  })
})

// ---------------------------------------------------------------------------
// Entries — the last gate before persistence
// ---------------------------------------------------------------------------

describe('makeEntry', () => {
  it('builds an entry for an allowed window', () => {
    const e = makeEntry(win('Safari', 'MDN'), 'a'.repeat(80), 'frame-9', NOW)!
    expect(e.app).toBe('Safari')
    expect(e.frameId).toBe('frame-9')
    expect(e.seenAt).toBe(NOW)
  })

  it('RE-CHECKS the policy at the point of storage', () => {
    // Redundant with the caller's check on purpose: this is the last gate before
    // text is persisted, and it must not be bypassable by a caller that forgets.
    expect(makeEntry(win('1Password'), 'a'.repeat(80), 'frame-1', NOW)).toBeNull()
    expect(makeEntry(win('Chrome', 'Incognito'), 'a'.repeat(80), 'frame-1', NOW)).toBeNull()
  })

  it('redacts before storing, never after', () => {
    const e = makeEntry(win('Terminal', 'zsh'), 'run with password: hunter2 and more text here to pass the floor', 'f1', NOW)!
    expect(e.text).not.toContain('hunter2')
  })

  it('requires a frame — the evidence that makes it checkable', () => {
    expect(makeEntry(win('Safari'), 'a'.repeat(80), '', NOW)).toBeNull()
  })

  it('rejects a bad timestamp', () => {
    expect(makeEntry(win('Safari'), 'a'.repeat(80), 'f1', 0)).toBeNull()
    expect(makeEntry(win('Safari'), 'a'.repeat(80), 'f1', NaN)).toBeNull()
  })

  it('rejects text below the floor', () => {
    expect('short'.length).toBeLessThan(MIN_ENTRY_CHARS)
    expect(makeEntry(win('Safari'), 'short', 'f1', NOW)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The provenance bridge
// ---------------------------------------------------------------------------

describe('entryToBlock', () => {
  it('produces an `observed` block', () => {
    const b = entryToBlock(entry())!
    expect(b.origin).toBe('observed')
  })

  it('grounds activity but NEVER world claims', () => {
    // The whole point of the observed tier: "I looked at a page" must never
    // masquerade as "I have a source for this".
    const b = entryToBlock(entry())!
    expect(countsAsGrounding(b)).toBe(true)
    expect(groundsWorldClaims(b)).toBe(false)
  })

  it('carries the frame and timestamp as its evidence', () => {
    const b = entryToBlock(entry()) as Extract<Block, { origin: 'observed' }>
    expect(b.frameId).toBe('frame-1')
    expect(b.seenAt).toBe(NOW)
  })

  it('labels the block with where it was seen', () => {
    const b = entryToBlock(entry())!
    expect(b.text).toContain('Safari')
    expect(b.text).toContain('Simon Willison')
  })
})

// ---------------------------------------------------------------------------
// Recall — tier 1, no model
// ---------------------------------------------------------------------------

describe('recall', () => {
  const entries: ScreenLogEntry[] = [
    entry({ id: 'a', seenAt: NOW - 1 * 24 * 3600_000, text: 'prompt injection and capability security' }),
    entry({ id: 'b', seenAt: NOW - 30 * 24 * 3600_000, text: 'prompt injection defenses overview' }),
    entry({ id: 'c', seenAt: NOW - 2 * 24 * 3600_000, app: 'Mail', windowTitle: 'lunch', text: 'completely unrelated content here' }),
  ]

  it('finds entries by term and ignores non-matches', () => {
    const hits = recall(entries, 'prompt injection', NOW)
    expect(hits.map(h => h.entry.id)).toEqual(['a', 'b'])
  })

  it('leans recent — "that thing I was looking at earlier"', () => {
    const hits = recall(entries, 'prompt injection', NOW)
    expect(hits[0].entry.id).toBe('a')
  })

  it('searches app and window title, not just text', () => {
    expect(recall(entries, 'Mail', NOW).map(h => h.entry.id)).toEqual(['c'])
  })

  it('ignores trivially short query terms', () => {
    expect(recall(entries, 'a of', NOW)).toEqual([])
  })

  it('returns nothing for an empty log or empty query', () => {
    expect(recall([], 'prompt', NOW)).toEqual([])
    expect(recall(entries, '', NOW)).toEqual([])
  })

  it('respects the limit', () => {
    expect(recall(entries, 'prompt injection', NOW, 1)).toHaveLength(1)
  })
})
