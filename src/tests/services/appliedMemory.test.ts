import { describe, it, expect } from 'vitest';
import { buildPlaybookRecord, parsePlaybook, playbookTriggerSlug, formatProceduresBlock } from '../../services/appliedMemory';

describe('playbookTriggerSlug', () => {
  it('slugifies, lowercases, caps length, and falls back', () => {
    expect(playbookTriggerSlug('Weekly Report')).toBe('weekly-report');
    expect(playbookTriggerSlug('  Ship the Q4!! release  ')).toBe('ship-the-q4-release');
    expect(playbookTriggerSlug('')).toBe('playbook');
    expect(playbookTriggerSlug('!!!').length).toBeGreaterThan(0);
    expect(playbookTriggerSlug('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('buildPlaybookRecord', () => {
  const base = {
    rootPath: '/wk', agentId: 'codey', title: 'Weekly report',
    intent: 'weekly report', now: new Date('2026-01-15T12:00:00.000Z'),
    steps: [
      { intent: 'pull the latest metrics', toolHint: 'knowledge_search' },
      { intent: 'summarize the highlights' },
      { intent: 'draft the email', toolHint: 'mail' },
    ],
  };

  it('keys the file by the trigger slug (stable — re-capture updates in place)', () => {
    const { path, trigger } = buildPlaybookRecord(base);
    expect(trigger).toBe('weekly-report');
    // Space-scoped layout (WS-A): playbooks live under the active Space, space-home outside one.
    expect(path).toBe('/wk/memory/spaces/space-home/playbooks/weekly-report.md');
  });

  it('writes playbook frontmatter, starts unverified with 0 accepts, and tags the tools', () => {
    const { content } = buildPlaybookRecord(base);
    expect(content).toContain('memory_type: playbook');
    expect(content).toContain('verified: false');
    expect(content).toContain('accept: 0');
    expect(content).toContain('"tool:knowledge_search"');
    expect(content).toContain('"tool:mail"');
    expect(content).toContain('"trigger:weekly-report"');
  });

  it('renders steps as a numbered procedure with optional hints', () => {
    const { content } = buildPlaybookRecord(base);
    expect(content).toContain('## Procedure');
    expect(content).toContain('1. pull the latest metrics _(hint: knowledge_search)_');
    expect(content).toContain('2. summarize the highlights');
    expect(content).not.toMatch(/2\. summarize the highlights _\(hint:/); // no hint → no hint suffix
  });

  it('sanitizes a newline-bearing title against YAML-frontmatter injection', () => {
    const { content } = buildPlaybookRecord({ ...base, title: 'evil"\ninjected: true' });
    expect(content).not.toMatch(/\ninjected: true/);
    expect(content.match(/^title: ".*"$/m)).toBeTruthy(); // title stays a single quoted scalar
  });

  it('round-trips through parsePlaybook', () => {
    const built = buildPlaybookRecord({ ...base, verified: true, accept: 3 });
    const pb = parsePlaybook(built.content)!;
    expect(pb).not.toBeNull();
    expect(pb.title).toBe('Weekly report');
    expect(pb.trigger).toBe('weekly-report');
    expect(pb.verified).toBe(true);
    expect(pb.accept).toBe(3);
    expect(pb.steps.map((s) => s.intent)).toEqual(['pull the latest metrics', 'summarize the highlights', 'draft the email']);
    expect(pb.steps[0].toolHint).toBe('knowledge_search');
    expect(pb.steps[1].toolHint).toBeUndefined();
  });

  it('parsePlaybook returns null for a non-playbook blob', () => {
    expect(parsePlaybook('just some text')).toBeNull();
    expect(parsePlaybook('')).toBeNull();
  });
});

describe('formatProceduresBlock', () => {
  const pb = { title: 'Weekly report', trigger: 'weekly-report', verified: true, accept: 0,
    steps: [{ intent: 'pull metrics' }, { intent: 'draft email' }] };

  it('returns empty string when there are no usable playbooks', () => {
    expect(formatProceduresBlock([])).toBe('');
    expect(formatProceduresBlock([{ ...pb, steps: [] }])).toBe('');
  });

  it('formats a propose-don\'t-run block with the title and numbered steps', () => {
    const block = formatProceduresBlock([pb]);
    expect(block).toContain('KNOWN PROCEDURES');
    expect(block).toMatch(/offer, don't auto-run/i);
    expect(block).toContain('ONE action at a time');   // the per-step gating instruction
    expect(block).toContain('• Weekly report');
    expect(block).toContain('1. pull metrics');
    expect(block).toContain('2. draft email');
  });
});
