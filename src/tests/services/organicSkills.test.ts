import { describe, it, expect } from 'vitest';
import {
  distillCandidate,
  observeCompletion,
  shouldPropose,
  isStale,
  composeSkillContext,
  DEFAULT_SKILL_POLICY,
  type LearnedSkill,
  type CompletedAction,
} from '../../services/organicSkills';
import { buildPlaybookRecord, parsePlaybook } from '../../services/appliedMemory';

const actions = (n: number): CompletedAction[] =>
  Array.from({ length: n }, (_, i) => ({ tool: `tool${i}`, intent: `step ${i + 1}` }));

describe('distillCandidate', () => {
  it('turns a completed multi-step task into an unverified candidate seen once', () => {
    const c = distillCandidate('pull the weekly metrics', actions(3))!;
    expect(c).not.toBeNull();
    expect(c.verified).toBe(false);
    expect(c.accept).toBe(0);
    expect(c.seen).toBe(1);
    expect(c.trigger).toBe('pull-the-weekly-metrics');
    expect(c.steps).toHaveLength(3);
    expect(c.steps[0]).toEqual({ intent: 'step 1', toolHint: 'tool0' });
    expect(c.title).toBe('Pull the weekly metrics');
  });

  it('refuses tasks below the minimum step count (nothing to reuse)', () => {
    expect(distillCandidate('open a tab', actions(1))).toBeNull();
    expect(distillCandidate('open a tab', [])).toBeNull();
  });

  it('collapses consecutive identical steps (retry/pagination) into one', () => {
    const repeated: CompletedAction[] = [
      { tool: 'web', intent: 'fetch page' },
      { tool: 'web', intent: 'fetch page' },
      { tool: 'doc', intent: 'summarize' },
    ];
    const c = distillCandidate('research a topic', repeated)!;
    expect(c.steps.map((s) => s.intent)).toEqual(['fetch page', 'summarize']);
  });

  it('drops blank steps and empty tool hints', () => {
    const c = distillCandidate('do a thing', [
      { tool: '', intent: 'first' },
      { tool: '  ', intent: '   ' },
      { tool: 'mail', intent: 'second' },
    ])!;
    expect(c.steps).toEqual([{ intent: 'first', toolHint: undefined }, { intent: 'second', toolHint: 'mail' }]);
  });
});

describe('observeCompletion', () => {
  it('starts fresh when there is no prior skill', () => {
    const fresh = distillCandidate('draft the release notes', actions(2))!;
    const next = observeCompletion(null, fresh);
    expect(next.seen).toBe(1);
    expect(next.lastSeenAt).toBeTruthy();
  });

  it('increments seen and refreshes steps when the same task recurs', () => {
    const first = distillCandidate('draft the release notes', actions(2))!;
    const second = distillCandidate('draft the release notes', actions(4))!; // task drifted longer
    const merged = observeCompletion(first, second);
    expect(merged.trigger).toBe(first.trigger);
    expect(merged.seen).toBe(2);
    expect(merged.steps).toHaveLength(4); // keeps the most recent shape
  });

  it('does not merge across different triggers', () => {
    const a = distillCandidate('task a', actions(2))!;
    const b = distillCandidate('task b', actions(2))!;
    const next = observeCompletion(a, b);
    expect(next.trigger).toBe('task-b');
    expect(next.seen).toBe(1);
  });

  it('never mutates its inputs', () => {
    const prior = distillCandidate('task', actions(2))!;
    const snapshot = JSON.parse(JSON.stringify(prior));
    observeCompletion(prior, distillCandidate('task', actions(2))!);
    expect(prior).toEqual(snapshot);
  });
});

describe('proposal — recurrence surfaces a candidate but never verifies it (SEC-PLAYBOOKVERIFY)', () => {
  const base = (over: Partial<LearnedSkill>): LearnedSkill => ({
    title: 'T', trigger: 't', steps: [{ intent: 's' }], verified: false, accept: 0, seen: 0, ...over,
  });

  it('does not propose a candidate until it has recurred enough', () => {
    expect(shouldPropose(base({ seen: DEFAULT_SKILL_POLICY.proposeAfterSeen - 1 }))).toBe(false);
    expect(shouldPropose(base({ seen: DEFAULT_SKILL_POLICY.proposeAfterSeen }))).toBe(true);
  });

  it('never proposes an already-trusted skill', () => {
    expect(shouldPropose(base({ seen: 99, verified: true }))).toBe(false);
  });

  it('offers a candidate only once (proposed flag prevents re-nagging)', () => {
    expect(shouldPropose(base({ seen: 99, proposed: false }))).toBe(true);
    expect(shouldPropose(base({ seen: 99, proposed: true }))).toBe(false);
  });

  it('recurrence alone NEVER sets verified — trust stays an explicit user action', () => {
    let skill = distillCandidate('recurring chore', actions(2))!; // seen 1
    for (let i = 0; i < 6; i++) {
      skill = observeCompletion(skill, distillCandidate('recurring chore', actions(2))!);
    }
    expect(skill.seen).toBeGreaterThanOrEqual(DEFAULT_SKILL_POLICY.proposeAfterSeen);
    expect(shouldPropose(skill)).toBe(true); // Docent will OFFER it for the user to trust…
    expect(skill.verified).toBe(false);      // …but it is not suggestable until the user says so
  });
});

describe('decay', () => {
  const now = new Date('2026-07-21T00:00:00Z');
  it('forgets an un-promoted candidate that has gone quiet past the window', () => {
    const old = { ...distillCandidate('stale', actions(2))!, lastSeenAt: '2026-05-01T00:00:00Z' };
    expect(isStale(old, DEFAULT_SKILL_POLICY, now)).toBe(true);
  });
  it('keeps a recently-seen candidate', () => {
    const recent = { ...distillCandidate('fresh', actions(2))!, lastSeenAt: '2026-07-20T00:00:00Z' };
    expect(isStale(recent, DEFAULT_SKILL_POLICY, now)).toBe(false);
  });
  it('never decays a verified skill', () => {
    const proven = { ...distillCandidate('proven', actions(2))!, verified: true, lastSeenAt: '2020-01-01T00:00:00Z' };
    expect(isStale(proven, DEFAULT_SKILL_POLICY, now)).toBe(false);
  });
});

describe('composeSkillContext', () => {
  it('includes verified learned skills and excludes candidates', () => {
    const verified: LearnedSkill = { title: 'Ship it', trigger: 'ship-it', steps: [{ intent: 'tag' }, { intent: 'push' }], verified: true, accept: 2, seen: 4 };
    const candidate: LearnedSkill = { title: 'Maybe', trigger: 'maybe', steps: [{ intent: 'x' }], verified: false, accept: 0, seen: 1 };
    const block = composeSkillContext({ tabType: 'code-canvas' }, [verified, candidate]);
    expect(block).toContain('Ship it');
    expect(block).not.toContain('Maybe');
    // surface skill (engineering) is layered in for the code surface
    expect(block.toLowerCase()).toContain('clean architecture');
  });

  it('returns an empty string when there is nothing to add', () => {
    expect(composeSkillContext({}, [])).toBe('');
  });
});

describe('seen roundtrips through the playbook store', () => {
  it('persists and parses the organic seen counter', () => {
    const { content } = buildPlaybookRecord({
      rootPath: '/root', agentId: 'a', title: 'Weekly digest', intent: 'weekly digest',
      steps: [{ intent: 'gather' }, { intent: 'summarize' }], verified: true, accept: 1, seen: 5,
    });
    expect(content).toContain('seen: 5');
    const parsed = parsePlaybook(content)!;
    expect(parsed.seen).toBe(5);
    expect(parsed.verified).toBe(true);
  });

  it('defaults seen to 0 for pre-existing playbooks without the field', () => {
    const legacy = ['---', 'title: "Old"', 'trigger: "old"', 'verified: true', 'accept: 0', '---', '', '# Old', '', '## Procedure', '1. do a', '2. do b', ''].join('\n');
    expect(parsePlaybook(legacy)!.seen).toBe(0);
  });
});
