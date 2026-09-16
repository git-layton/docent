import { describe, it, expect } from 'vitest'
import { mailMessageUrl, describeOpenFailure } from '../../services/openInApp'

// ─── Opening the REAL thing ───────────────────────────────────────────────────
//
// The whole case for retiring the in-app Mail/Notes/Messages copies rests on this working: ask,
// get handles, click, the actual app opens at the actual item. The URL shape is the fragile part
// and it fails SILENTLY when wrong — Mail opens to nothing and reports no error, which is
// indistinguishable from "the click didn't register".

describe('mailMessageUrl', () => {
  it('wraps the id in percent-encoded angle brackets, which Mail requires', () => {
    // Skip the %3c/%3e and Mail opens an empty window with no error at all.
    expect(mailMessageUrl('abc123@mail.example.com'))
      .toBe('message://%3cabc123%40mail.example.com%3e')
  })

  it('accepts an id that already carries its brackets', () => {
    // IMAP servers return it both ways; double-wrapping breaks the lookup just as silently.
    expect(mailMessageUrl('<abc123@example.com>')).toBe(mailMessageUrl('abc123@example.com'))
  })

  it('encodes characters that would otherwise break the URL', () => {
    const url = mailMessageUrl('a b+c/d?e@example.com')!
    expect(url).not.toMatch(/[ ?]/)
    expect(url.startsWith('message://%3c')).toBe(true)
    expect(url.endsWith('%3e')).toBe(true)
  })

  it('returns null rather than a malformed URL when there is no id', () => {
    for (const bad of ['', '   ', '<>', null, undefined]) {
      expect(mailMessageUrl(bad as any)).toBeNull()
    }
  })
})

describe('describeOpenFailure', () => {
  it('explains every failure without blaming the user', () => {
    for (const reason of ['no-message-id', 'lookup-failed', 'open-failed'] as const) {
      const msg = describeOpenFailure({ opened: false, reason })
      expect(msg).toBeTruthy()
      expect(msg).not.toMatch(/undefined/)
    }
  })

  it('tells the user the message is still readable when Mail cannot take it', () => {
    // A dead end is only acceptable if there's a way forward in it.
    expect(describeOpenFailure({ opened: false, reason: 'no-message-id' })).toMatch(/still readable/i)
  })
})
