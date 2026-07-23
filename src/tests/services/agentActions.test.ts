import { describe, it, expect } from 'vitest';
import { parseAgentActions, actionNeedsApproval, stripActionBlocks, describeAction, executeAgentAction } from '../../services/agentActions';

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
  it('always requires approval to RUN a playbook (it expands into real actions), but capture is local', () => {
    expect(actionNeedsApproval({ tool: 'playbook', op: 'execute', id: 'p1' })).toBe(true);
    expect(actionNeedsApproval({ tool: 'playbook', op: 'capture', title: 'Weekly report' })).toBe(false);
  });
  it('requires approval for EVERY write when the turn ingested untrusted-external content (trust §3 rule 2)', () => {
    // Actions that auto-apply on a trusted turn must route to approval once the turn included a viewed
    // web page / received mail / messages — prompt-injection rides in on exactly that content.
    expect(actionNeedsApproval({ tool: 'note', op: 'create', title: 'x' }, true)).toBe(true);
    expect(actionNeedsApproval({ tool: 'task', op: 'create', title: 'x' }, true)).toBe(true);
    expect(actionNeedsApproval({ tool: 'calendar', op: 'create', title: 'x', start: '2026-01-01' }, true)).toBe(true);
    expect(actionNeedsApproval({ tool: 'task', op: 'complete', id: '1' }, true)).toBe(true);
    expect(actionNeedsApproval({ tool: 'mail', op: 'send', to: ['a@b.c'] }, true)).toBe(true);
    // A trusted turn (default / explicit false) keeps auto-applying local writes.
    expect(actionNeedsApproval({ tool: 'note', op: 'create', title: 'x' }, false)).toBe(false);
  });
});

describe('agentActions — playbook safety backstop', () => {
  it('refuses to execute a playbook directly — steps must be re-emitted and individually approved', async () => {
    // The whole safety story rests on this: executeAgentAction must NEVER run playbook steps.
    await expect(executeAgentAction({ tool: 'playbook', op: 'execute', id: 'p1' })).rejects.toThrow();
    await expect(executeAgentAction({ tool: 'playbook', op: 'capture', title: 'x' })).rejects.toThrow();
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

// ── Pre-approval target resolution ───────────────────────────────────────────
import { invoke } from '@tauri-apps/api/core';
import { resolveActionTargets, isCardAction, renderCardActionBlocks } from '../../services/agentActions';

describe('resolveActionTargets — approve the real destination, not the guess', () => {
  it('stamps the resolved chat guid and display name for message.send', async () => {
    (invoke as any).mockResolvedValueOnce([
      { guid: 'g-1', name: 'Bobby & the group' },
      { guid: 'g-2', name: 'Bob Smith' },
    ]);
    const a = await resolveActionTargets({ tool: 'message', op: 'send', to: 'bobby', text: 'hi' });
    expect(a.chatGuid).toBe('g-1');
    expect(a.resolvedName).toBe('Bobby & the group');
    expect(describeAction(a)).toContain('Bobby & the group');
  });

  it('marks the action unresolved when no conversation matches', async () => {
    (invoke as any).mockResolvedValueOnce([{ guid: 'g-1', name: 'Alice' }]);
    const a = await resolveActionTargets({ tool: 'message', op: 'send', to: 'Zed', text: 'hi' });
    expect(a.chatGuid).toBeUndefined();
    expect(a.unresolved).toContain('Zed');
    expect(describeAction(a)).toContain('no conversation matching');
  });

  it('keeps an explicit chatGuid untouched', async () => {
    const a = await resolveActionTargets({ tool: 'message', op: 'send', chatGuid: 'g-9', text: 'hi' });
    expect(a.chatGuid).toBe('g-9');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('marks mail.send unresolved when no account is connected', async () => {
    const a = await resolveActionTargets({ tool: 'mail', op: 'send', to: 'x@y.com', subject: 's', body: 'b' });
    expect(a.unresolved).toBeTruthy();
    expect(describeAction(a)).toContain('Send email —');
  });

  it('passes non-send actions through unchanged', async () => {
    const a = { tool: 'task', op: 'create', title: 'T' };
    expect(await resolveActionTargets(a)).toEqual(a);
  });
});

describe('card actions — event/library/profile route to cards, not execution', () => {
  it('recognizes card ops and excludes connector ops', () => {
    expect(isCardAction({ tool: 'event', op: 'create', title: 'Trip' })).toBe(true);
    expect(isCardAction({ tool: 'library', op: 'save', content: 'x' })).toBe(true);
    expect(isCardAction({ tool: 'profile', op: 'update', fact: 'likes tea' })).toBe(true);
    expect(isCardAction({ tool: 'task', op: 'create', title: 'x' })).toBe(false);
    expect(isCardAction({ tool: 'message', op: 'send', to: 'a', text: 'b' })).toBe(false);
  });

  it('renders card actions back into the legacy fenced blocks the message renderer displays', () => {
    const out = renderCardActionBlocks([
      { tool: 'event', op: 'create', type: 'date', title: 'Dentist', dueDate: '2026-08-01' },
      { tool: 'library', op: 'save', title: 'Plan', content: 'the plan' },
      { tool: 'task', op: 'create', title: 'not a card' },
    ]);
    expect(out).toContain('```event\n');
    expect(out).toContain('"title":"Dentist"');
    expect(out).toContain('```save\n');
    expect(out).not.toContain('not a card'); // non-card ops are skipped
    // tool/op keys are stripped from the rendered block payload (renderer keys off the fence lang)
    expect(out).not.toContain('"op":"create"');
  });

  it('maps event update/delete to their legacy fence languages', () => {
    expect(renderCardActionBlocks([{ tool: 'event', op: 'update', id: 'e1', dueDate: '2026-09-01' }])).toContain('```event_update\n');
    expect(renderCardActionBlocks([{ tool: 'event', op: 'delete', id: 'e1' }])).toContain('```event_delete\n');
    expect(renderCardActionBlocks([{ tool: 'profile', op: 'update', fact: 'likes tea' }])).toContain('```profile\n');
  });
});

describe('parseAgentActions — card ops validate through the same grammar', () => {
  it('accepts a valid event.create and drops an event.update missing its id', () => {
    const good = parseAgentActions('```forge:action\n{"tool":"event","op":"create","type":"date","title":"X","dueDate":"2026-08-01"}\n```');
    expect(good).toHaveLength(1);
    const bad = parseAgentActions('```forge:action\n{"tool":"event","op":"update","dueDate":"2026-08-01"}\n```');
    expect(bad).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fence drift. Reproduced from a real transcript: asked to search, the model
// emitted ```json {"tool":"web_search","query":"…"} — a tool that is a
// *capability*, not a forge:action verb. The old regex matched only
// ```forge:action, so the block was neither executed NOR stripped, and the user
// saw raw tool JSON in the middle of a reply.
// ---------------------------------------------------------------------------

describe('agentActions — fence drift', () => {
  const DRIFTED = 'Searching now.\n```json\n{\n"tool": "make_pizza",\n"query": "pepperoni"\n}\n```';

  it('never shows invented tool JSON to the user, whatever fence it arrived in', () => {
    const out = stripActionBlocks(DRIFTED);
    expect(out).not.toContain('make_pizza');
    expect(out).not.toContain('{');
    expect(out).toContain('Searching now.');
  });

  it('runs a fully valid action even when the fence drifted to ```json', () => {
    const text = 'Done.\n```json\n{"tool":"task","op":"create","title":"Buy milk"}\n```';
    const a = parseAgentActions(text);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tool: 'task', op: 'create', title: 'Buy milk' });
  });

  it('does not execute the invented call — it names no real op', () => {
    expect(parseAgentActions(DRIFTED)).toHaveLength(0);
  });

  it('leaves ordinary code blocks alone', () => {
    const code = 'Here:\n```ts\nconst tool = "hammer";\n```';
    expect(stripActionBlocks(code)).toContain('const tool');
    expect(parseAgentActions(code)).toHaveLength(0);
  });

  it('leaves non-tool JSON blocks visible', () => {
    const json = 'Config:\n```json\n{"retries": 3}\n```';
    expect(stripActionBlocks(json)).toContain('retries');
  });

  it('does not run the same action twice when both fences appear', () => {
    const text = '```forge:action\n{"tool":"task","op":"create","title":"X"}\n```\n' +
                 '```json\n{"tool":"task","op":"create","title":"X"}\n```';
    expect(parseAgentActions(text)).toHaveLength(1);
  });
});
