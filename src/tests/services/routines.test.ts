import { describe, it, expect } from 'vitest';
import { isDue, matchesWatch, rememberUids, detectRoutineIntent, type Routine } from '../../services/routines';

const base = (over: Partial<Routine>): Routine => ({
  id: 'r1', name: 'test', trigger: { kind: 'daily', hour: 8, minute: 0 },
  action: 'mailReport', ownerId: 'agent-1', enabled: true, createdAt: 0, ...over,
});

const at = (h: number, m = 0) => { const d = new Date(2026, 6, 10, h, m, 0, 0); return d.getTime(); };

describe('isDue — daily', () => {
  it('not due before the slot when it already ran yesterday', () => {
    const r = base({ lastRunAt: at(8) - 24 * 60 * 60 * 1000 + 60_000 }); // ran just after yesterday's slot
    expect(isDue(r, at(7, 30))).toBe(false);
  });
  it('due after the slot when it has not run since', () => {
    expect(isDue(base({ lastRunAt: at(8) - 3 * 60 * 60 * 1000 }), at(9))).toBe(true);
  });
  it('CATCH-UP: due at launch even long after the slot (missed while app was closed)', () => {
    expect(isDue(base({ lastRunAt: at(8) - 30 * 60 * 60 * 1000 }), at(22))).toBe(true);
  });
  it('not due twice in one day', () => {
    expect(isDue(base({ lastRunAt: at(8, 1) }), at(15))).toBe(false);
  });
  it('never due when disabled', () => {
    expect(isDue(base({ enabled: false }), at(9))).toBe(false);
  });
});

describe('isDue — mailWatch interval', () => {
  const watch = base({ trigger: { kind: 'mailWatch', everyMinutes: 5 }, action: 'mailFlag' });
  it('due when the interval has elapsed', () => {
    expect(isDue({ ...watch, lastRunAt: at(9) - 6 * 60_000 }, at(9))).toBe(true);
  });
  it('not due inside the interval', () => {
    expect(isDue({ ...watch, lastRunAt: at(9) - 2 * 60_000 }, at(9))).toBe(false);
  });
});

describe('matchesWatch', () => {
  const h = { fromName: 'Jane Doe', fromEmail: 'jane@acme.com', subject: 'Q3 Invoice attached' };
  it('matches on sender substring, case-insensitive', () => {
    expect(matchesWatch(base({ fromContains: 'ACME' }), h)).toBe(true);
  });
  it('matches on subject substring', () => {
    expect(matchesWatch(base({ subjectContains: 'invoice' }), h)).toBe(true);
  });
  it('requires BOTH filters when both set', () => {
    expect(matchesWatch(base({ fromContains: 'acme', subjectContains: 'payroll' }), h)).toBe(false);
  });
  it('never matches with no filters configured (must not flag the whole inbox)', () => {
    expect(matchesWatch(base({}), h)).toBe(false);
  });
});

describe('rememberUids', () => {
  it('appends and caps', () => {
    const uids = rememberUids(Array.from({ length: 498 }, (_, i) => i), [998, 999], 500);
    expect(uids.length).toBe(500);
    expect(uids[uids.length - 1]).toBe(999);
    expect(uids[0]).toBe(0);
  });
});

describe('detectRoutineIntent', () => {
  it('proposes a daily digest for a recurring mail+calendar request', () => {
    const p = detectRoutineIntent('every morning at 8am give me a summary of my email and calendar');
    expect(p?.action).toBe('digest');
    expect(p?.sources).toEqual({ mail: true, calendar: true, notes: false });
    expect(p?.trigger).toEqual({ kind: 'daily', hour: 8, minute: 0 });
  });
  it('parses pm times', () => {
    const p = detectRoutineIntent('each day at 6:30pm summarize my notes');
    expect(p?.trigger).toEqual({ kind: 'daily', hour: 18, minute: 30 });
  });
  it('proposes a mail watcher with a sender target', () => {
    const p = detectRoutineIntent('watch my email from stripe and flag it');
    expect(p?.action).toBe('mailFlag');
    expect(p?.fromContains?.toLowerCase()).toContain('stripe');
  });
  it('returns null for a one-off request (no recurrence or watch cue)', () => {
    expect(detectRoutineIntent('summarize this email for me')).toBeNull();
  });
  it('returns null when no mail/calendar/notes subject is present', () => {
    expect(detectRoutineIntent('every morning remind me to stretch')).toBeNull();
  });
  it('returns null for a watcher with no target to match on', () => {
    expect(detectRoutineIntent('watch my email')).toBeNull();
  });
});
