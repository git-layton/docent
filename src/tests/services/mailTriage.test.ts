import { describe, it, expect } from 'vitest';
import {
  classifyHeaderHeuristic, classifyAllHeuristic, buildTriagePrompt,
  parseTriageResponse, applyModelUpgrade, planSweep, invertSweepPlan,
  type TriageHeader,
} from '../../services/mailTriage';

const h = (over: Partial<TriageHeader>): TriageHeader => ({
  uid: 1, account: 'a@x.com', fromName: 'Sam', fromEmail: 'sam@friend.com',
  subject: 'hey', date: 'Sat, 19 Jul 2026 10:00:00 -0400', seen: false, flagged: false,
  ...over,
});

describe('classifyHeaderHeuristic (the no-model floor)', () => {
  it('routes automated senders and newsletter subjects to newsletter', () => {
    expect(classifyHeaderHeuristic(h({ fromEmail: 'noreply@service.com' }))).toBe('newsletter');
    expect(classifyHeaderHeuristic(h({ fromEmail: 'newsletter@paper.io' }))).toBe('newsletter');
    expect(classifyHeaderHeuristic(h({ subject: 'Weekly digest: issue #42' }))).toBe('newsletter');
  });

  it('routes transactional subjects to receipt — even from automated senders', () => {
    expect(classifyHeaderHeuristic(h({ fromEmail: 'noreply@shop.com', subject: 'Your order has shipped' }))).toBe('receipt');
    expect(classifyHeaderHeuristic(h({ subject: 'Invoice #1234 payment received' }))).toBe('receipt');
  });

  it('unread human mail is a reply candidate; read human mail rests in other', () => {
    expect(classifyHeaderHeuristic(h({ seen: false }))).toBe('needs-reply');
    expect(classifyHeaderHeuristic(h({ seen: true }))).toBe('other');
  });
});

describe('parseTriageResponse (defensive — Stance ii)', () => {
  it('accepts valid JSON with rationale first and known uids', () => {
    const out = parseTriageResponse('{"_rationale": "judgment", "queues": {"1": "receipt", "2": "needs-reply"}}', [1, 2]);
    expect(out?.get(1)).toBe('receipt');
    expect(out?.get(2)).toBe('needs-reply');
  });

  it('drops unknown uids and invalid queue names individually', () => {
    const out = parseTriageResponse('{"_rationale": "x", "queues": {"1": "receipt", "99": "receipt", "2": "spam-folder"}}', [1, 2]);
    expect(out?.size).toBe(1);
    expect(out?.get(1)).toBe('receipt');
  });

  it('returns null on garbage, empty, or schema-less responses (caller keeps the floor)', () => {
    expect(parseTriageResponse('sure! here are the queues', [1])).toBeNull();
    expect(parseTriageResponse('{"queues": "all newsletters"}', [1])).toBeNull();
    expect(parseTriageResponse('{"_rationale": "x", "queues": {}}', [1])).toBeNull();
  });

  it('extracts JSON even when the model wraps it in prose', () => {
    const out = parseTriageResponse('Here you go:\n{"_rationale": "r", "queues": {"5": "newsletter"}}\nDone!', [5]);
    expect(out?.get(5)).toBe('newsletter');
  });
});

describe('applyModelUpgrade', () => {
  it('upgrades only the uids the model classified, marking them', () => {
    const base = classifyAllHeuristic([h({ uid: 1 }), h({ uid: 2, fromEmail: 'noreply@x.com' })]);
    const upgraded = applyModelUpgrade(base, new Map([[2, 'needs-reply']]));
    expect(upgraded[0].modelClassified).toBeUndefined();
    expect(upgraded[1].queue).toBe('needs-reply');
    expect(upgraded[1].modelClassified).toBe(true);
  });
});

describe('buildTriagePrompt', () => {
  it('demands _rationale first and lists every header by uid', () => {
    const p = buildTriagePrompt([h({ uid: 7, subject: 'Lunch?' })]);
    expect(p.indexOf('_rationale')).toBeGreaterThan(-1);
    expect(p.indexOf('_rationale')).toBeLessThan(p.indexOf('queues'));
    expect(p).toContain('7: from');
    expect(p).toContain('Lunch?');
  });
});

describe('planSweep + invertSweepPlan', () => {
  const classified = applyModelUpgrade(classifyAllHeuristic([
    h({ uid: 1, fromEmail: 'noreply@news.io', subject: 'Weekly digest' }),          // newsletter, unread
    h({ uid: 2, subject: 'Invoice #9 payment', fromEmail: 'billing@saas.com' }),    // receipt, unread
    h({ uid: 3, subject: 'Lunch tomorrow?' }),                                      // needs-reply
    h({ uid: 4, subject: 'URGENT: contract deadline today' }),                      // needs-reply + urgent
    h({ uid: 5, subject: 'old thread', seen: true }),                               // read → untouched
  ]), new Map());

  it('archives bulk, drafts replies, flags urgent — and never touches read mail', () => {
    const plan = planSweep(classified);
    expect(plan.archive.map(x => x.uid).sort()).toEqual([1, 2]);
    expect(plan.draft.map(x => x.uid).sort()).toEqual([3, 4]);
    expect(plan.flag.map(x => x.uid)).toEqual([4]);
    expect(plan.summary).toContain('archive 2');
    expect(plan.summary).toContain('draft 2');
    expect(plan.summary).toContain('flag 1');
  });

  it('a clean inbox produces an honest no-op summary', () => {
    const plan = planSweep(classifyAllHeuristic([h({ uid: 5, seen: true })]));
    expect(plan.archive).toHaveLength(0);
    expect(plan.summary).toContain('nothing to do');
  });

  it('the inverse covers exactly what the plan changed externally', () => {
    const plan = planSweep(classified);
    const inverse = invertSweepPlan(plan);
    expect(inverse.unarchive.map(x => x.uid).sort()).toEqual([1, 2]);
    expect(inverse.unflag.map(x => x.uid)).toEqual([4]);
    // drafts are held, never sent — nothing external to reverse
  });
});
