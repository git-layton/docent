import { describe, it, expect } from 'vitest'
import { mailQueryFrom, formatHeader, mailCapability } from '../../services/capabilities/builtins/mail'

// ─── The capability that has to exist before InboxPanel can go ────────────────
//
// Until this, mail was reachable only through that panel and through routines — asking
// "find my Breaking Points newsletters" in chat reached NOTHING, because there was no mail route
// and no mail capability. Deleting the panel first would have removed real function, which is the
// one thing Alex asked not to happen.
//
// The riskiest part is not the IMAP call, it is deciding WHETHER to make one. An empty search term
// handed to IMAP TEXT search returns the whole mailbox — 56,034 messages on this account. So the
// extraction is what's tested hardest.

describe('mailQueryFrom — a search needs something to search FOR', () => {
  it('pulls the sender out of the phrasings people actually use', () => {
    expect(mailQueryFrom('find my Breaking Points newsletters')).toMatch(/Breaking Points/i)
    expect(mailQueryFrom('show me emails from Breaking Points')).toMatch(/Breaking Points/i)
    expect(mailQueryFrom('search my email for the Apple receipt')).toMatch(/Apple receipt/i)
    expect(mailQueryFrom('pull up my mail about the lease')).toMatch(/lease/i)
  })

  it('REFUSES a bare briefing request', () => {
    // "check my email" is a request for a summary, not a search. Passing an empty term to IMAP
    // pulls the entire mailbox — the single most expensive mistake this function can make.
    expect(mailQueryFrom('check my email')).toBeNull()
    expect(mailQueryFrom('any new mail?')).toBeNull()
    expect(mailQueryFrom("what's in my inbox")).toBeNull()
  })

  it('refuses empty and junk input rather than searching for it', () => {
    expect(mailQueryFrom('')).toBeNull()
    expect(mailQueryFrom('   ')).toBeNull()
    expect(mailQueryFrom(undefined as any)).toBeNull()
    expect(mailQueryFrom(null as any)).toBeNull()
  })

  it('does not accept a stop-word as a search term', () => {
    // "show me all my emails" would otherwise extract "all" and search for it.
    for (const junk of ['show me all my emails', 'find my the emails']) {
      const out = mailQueryFrom(junk)
      expect(out === null || !/^(my|the|all|any|some|it)$/i.test(out)).toBe(true)
    }
  })

  it('strips surrounding quotes so the IMAP term is clean', () => {
    expect(mailQueryFrom('search my email for "Breaking Points"')).toBe('Breaking Points')
  })

  it('drops trailing punctuation rather than searching for it', () => {
    expect(mailQueryFrom('show me emails from Sam?')).toBe('Sam')
  })
})

describe('formatHeader', () => {
  it('renders a message compactly', () => {
    expect(formatHeader({ uid: 1, fromName: 'Breaking Points', subject: 'BP #214', date: 'Sep 12' }, 0))
      .toBe('[1] Breaking Points: BP #214 · Sep 12')
  })

  it('never renders "undefined" at the user', () => {
    // Headers arrive from IMAP and fields are routinely absent.
    const out = formatHeader({ uid: 2 }, 1)
    expect(out).not.toMatch(/undefined|null/)
    expect(out).toContain('unknown sender')
    expect(out).toContain('(no subject)')
  })
})

describe('the capability declines honestly instead of guessing', () => {
  const ctx = (content: string, integrations: any = {}) =>
    ({ userMsg: { content }, integrations } as any)

  it('does not query the mailbox without a search term', async () => {
    const out = await mailCapability.execute(ctx('check my email'))
    expect(out.sources).toEqual([])
    expect(out.toolData).toMatch(/no search term/i)
    // Must tell the model to ASK, not to answer — otherwise it invents an inbox.
    expect(out.toolData).toMatch(/ask the user/i)
  })

  it('says the account is missing rather than reporting an empty inbox', async () => {
    const out = await mailCapability.execute(ctx('find emails from Breaking Points', { mailAccounts: [] }))
    expect(out.toolData).toMatch(/no mail account is connected/i)
    expect(out.toolData).toMatch(/do NOT guess/i)
  })

  it('is declared read-only', () => {
    // It searches and opens. Sending or deleting must never ride in on this route.
    expect(mailCapability.effect).toBe('read')
  })

  it('describes itself, since that string is what tells the user what Docent can reach', () => {
    expect(mailCapability.description).toBeTruthy()
    expect(mailCapability.description).toMatch(/search/i)
  })
})
