import { describe, it, expect } from 'vitest';
import { parseAgentActions, actionNeedsApproval, stripActionBlocks, describeAction } from '../../services/agentActions';

describe('agentActions — parsing', () => {
  it('extracts a single action block', () => {
    const text = 'Sure!\n```forge:action\n{"tool":"task","op":"create","title":"Buy milk"}\n```';
    const a = parseAgentActions(text);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tool: 'task', op: 'create', title: 'Buy milk' });
  });

  it('extracts an array of actions and multiple blocks', () => {
    const text =
      '```forge:action\n[{"tool":"note","op":"create","title":"A"},{"tool":"task","op":"create","title":"B"}]\n```\n' +
      'and\n```forge:action\n{"tool":"message","op":"send","to":"Mom","text":"hi"}\n```';
    const a = parseAgentActions(text);
    expect(a.map(x => `${x.tool}.${x.op}`)).toEqual(['note.create', 'task.create', 'message.send']);
  });

  it('skips malformed blocks and ignores entries missing tool/op', () => {
    const text = '```forge:action\n{not json}\n```\n```forge:action\n{"tool":"note"}\n```';
    expect(parseAgentActions(text)).toEqual([]);
  });

  it('returns [] for plain text', () => {
    expect(parseAgentActions('just a normal reply')).toEqual([]);
  });
});

describe('agentActions — safety classification', () => {
  it('flags sends and deletes for approval', () => {
    expect(actionNeedsApproval({ tool: 'message', op: 'send', text: 'x' })).toBe(true);
    expect(actionNeedsApproval({ tool: 'mail', op: 'send', to: ['a@b.c'], subject: 's' })).toBe(true);
    expect(actionNeedsApproval({ tool: 'task', op: 'delete', id: '1' })).toBe(true);
    expect(actionNeedsApproval({ tool: 'note', op: 'delete', id: '1' })).toBe(true);
    expect(actionNeedsApproval({ tool: 'calendar', op: 'delete', id: '1' })).toBe(true);
  });
  it('auto-applies local writes', () => {
    expect(actionNeedsApproval({ tool: 'note', op: 'create', title: 'x' })).toBe(false);
    expect(actionNeedsApproval({ tool: 'task', op: 'create', title: 'x' })).toBe(false);
    expect(actionNeedsApproval({ tool: 'calendar', op: 'create', title: 'x', start: '2026-01-01' })).toBe(false);
    expect(actionNeedsApproval({ tool: 'task', op: 'complete', id: '1' })).toBe(false);
  });
  it('treats agent self-edit memory writes as local (no approval)', () => {
    // The agent writing to its OWN private memory is a local write, like creating a note — App.tsx
    // routes it to persistAgentSelfMemory, so it must never land in the approval queue.
    expect(actionNeedsApproval({ tool: 'memory', op: 'save', title: 'Pref', content: 'likes brevity' })).toBe(false);
    expect(actionNeedsApproval({ tool: 'memory', op: 'update', title: 'Pref', content: 'likes brevity' })).toBe(false);
  });
});

describe('agentActions — self-edit memory parsing', () => {
  it('parses a memory.save block with title and content', () => {
    const text = 'Got it — I\'ll remember that.\n```forge:action\n{"tool":"memory","op":"save","title":"Tone","content":"User prefers concise replies."}\n```';
    const a = parseAgentActions(text);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tool: 'memory', op: 'save', title: 'Tone' });
    expect(a[0].content).toContain('concise');
  });
});

describe('agentActions — strip + describe', () => {
  it('strips action blocks from the visible message', () => {
    const text = 'Done.\n```forge:action\n{"tool":"task","op":"create","title":"X"}\n```\nAnything else?';
    expect(stripActionBlocks(text)).toBe('Done.\n\nAnything else?');
  });
  it('describes actions for the card', () => {
    expect(describeAction({ tool: 'message', op: 'send', to: 'Mom', text: 'hi' })).toContain('Send iMessage to Mom');
    expect(describeAction({ tool: 'note', op: 'create', title: 'Plan' })).toContain('Create note');
  });
});
