import { describe, it, expect } from 'vitest';
import { parseModelBlock, validateAgentAction, isBlockLang } from '../../services/modelBlocks';

describe('parseModelBlock', () => {
  it('rejects invalid JSON (mid-stream fragments) without throwing', () => {
    const r = parseModelBlock('task', '{"title": "unfinis');
    expect(r.ok).toBe(false);
  });

  it('accepts a task with only a title and drops a junk dueDate instead of failing', () => {
    const r = parseModelBlock('task', '{"title":"Call dentist","dueDate":"tomorrow"}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.title).toBe('Call dentist');
      expect(r.data.dueDate).toBeUndefined();
    }
  });

  it('keeps a valid ISO dueDate', () => {
    const r = parseModelBlock('task', '{"title":"Call dentist","dueDate":"2026-08-01"}');
    expect(r.ok && r.data.dueDate).toBe('2026-08-01');
  });

  it('rejects a task without a title', () => {
    expect(parseModelBlock('task', '{"dueDate":"2026-08-01"}').ok).toBe(false);
  });

  it('rejects a profile block without a fact', () => {
    expect(parseModelBlock('profile', '{}').ok).toBe(false);
    expect(parseModelBlock('profile', '{"fact":"Prefers tea"}').ok).toBe(true);
  });

  it('lets any object through for editable event cards', () => {
    expect(parseModelBlock('event', '{"totally":"freeform"}').ok).toBe(true);
  });

  it('requires an id for event updates/deletes, coercing numeric ids', () => {
    expect(parseModelBlock('event_update', '{"dueDate":"2026-08-01"}').ok).toBe(false);
    const r = parseModelBlock('event_delete', '{"id":42}');
    expect(r.ok && (r.data as any).id).toBe('42');
  });

  it('requires channel and text for direct-send slack posts', () => {
    expect(parseModelBlock('slack_post', '{"channel":"general"}').ok).toBe(false);
    expect(parseModelBlock('slack_post', '{"channel":"general","text":"hi"}').ok).toBe(true);
  });

  it('requires a recipient for gmail drafts and defaults subject/body', () => {
    expect(parseModelBlock('gmail_draft', '{"subject":"x"}').ok).toBe(false);
    const r = parseModelBlock('gmail_draft', '{"to":"a@b.com"}');
    expect(r.ok && r.data.subject).toBe('');
  });

  it('requires a known action for file ops', () => {
    expect(parseModelBlock('file_op', '{"action":"format_disk"}').ok).toBe(false);
    expect(parseModelBlock('file_op', '{"action":"write","path":"a.md","content":"x"}').ok).toBe(true);
  });

  it('exposes isBlockLang for renderer routing', () => {
    expect(isBlockLang('task')).toBe(true);
    expect(isBlockLang('python')).toBe(false);
  });
});

describe('validateAgentAction', () => {
  it('rejects non-action shapes', () => {
    expect(validateAgentAction(null)).toBeNull();
    expect(validateAgentAction({ tool: 'note' })).toBeNull();
  });

  it('passes unknown tool.op combos through (future ops must not break parsing)', () => {
    expect(validateAgentAction({ tool: 'rocket', op: 'launch' })).toEqual({ tool: 'rocket', op: 'launch' });
  });

  it('drops a task.create without a title instead of creating an empty to-do', () => {
    expect(validateAgentAction({ tool: 'task', op: 'create' })).toBeNull();
    expect(validateAgentAction({ tool: 'task', op: 'create', title: 'Buy milk' })).toMatchObject({ title: 'Buy milk' });
  });

  it('requires an id for completes and deletes', () => {
    expect(validateAgentAction({ tool: 'task', op: 'complete' })).toBeNull();
    expect(validateAgentAction({ tool: 'note', op: 'delete', id: 7 })).toMatchObject({ id: '7' });
  });

  it('requires text plus a target for message.send', () => {
    expect(validateAgentAction({ tool: 'message', op: 'send', text: 'yo' })).toBeNull();
    expect(validateAgentAction({ tool: 'message', op: 'send', text: 'yo', to: 'Sam' })).toMatchObject({ to: 'Sam' });
    expect(validateAgentAction({ tool: 'message', op: 'send', to: 'Sam' })).toBeNull();
  });

  it('accepts string or array recipients for mail.send', () => {
    expect(validateAgentAction({ tool: 'mail', op: 'send', to: 'a@b.com' })).toBeTruthy();
    expect(validateAgentAction({ tool: 'mail', op: 'send', to: ['a@b.com'] })).toBeTruthy();
    expect(validateAgentAction({ tool: 'mail', op: 'send', to: [] })).toBeNull();
  });

  it('preserves extra fields on valid actions', () => {
    const a = validateAgentAction({ tool: 'task', op: 'create', title: 'x', details: 'd', location: 'l' });
    expect(a).toMatchObject({ details: 'd', location: 'l' });
  });
});
