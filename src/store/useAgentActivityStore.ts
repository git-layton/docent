import { create } from 'zustand';

// Live, transient "what is Docent doing right now" signal.
//
// Deliberately NOT part of the receipt ledger (services/receipts.ts). A receipt is a durable,
// persisted record of something that already happened and can be undone. This is the opposite:
// an ephemeral label for work in flight, thrown away the moment the turn ends. Persisting it
// would put half-finished steps in the audit trail.
//
// Why it exists at all: the chat previously showed three bouncing dots for the whole turn, so a
// long turn was indistinguishable from a hung one — the app read as slow when it was working.
// The label turns that dead time into progress the user can actually read.

interface AgentActivityState {
  /** Present-tense phrase for the step in flight, e.g. "Saving to memory". Null when idle. */
  label: string | null;
  /** How many actions this turn will apply, for "2 of 5" style progress. 0 when not applying. */
  total: number;
  done: number;

  begin: (label: string, total?: number) => void;
  advance: (label: string) => void;
  end: () => void;
}

export const useAgentActivityStore = create<AgentActivityState>((set) => ({
  label: null,
  total: 0,
  done: 0,

  begin: (label, total = 0) => set({ label, total, done: 0 }),
  advance: (label) => set(s => ({ label, done: Math.min(s.done + 1, s.total || s.done + 1) })),
  end: () => set({ label: null, total: 0, done: 0 }),
}));

/**
 * Which receipts were appended after `mark`, given the ledger's ids newest-first.
 *
 * `mark` is the id that sat on top before the turn began, so everything ahead of it is new. A null
 * mark means the ledger was empty, so all of it is this turn's. A mark that is no longer present
 * means it aged past the ledger cap mid-turn — vanishingly unlikely at CAP 200, and we deliberately
 * fall back to "claim everything" rather than "claim nothing", since showing a superset of what a
 * turn did is a smaller lie than silently showing none of it.
 */
export function receiptsSince(ledgerIdsNewestFirst: string[], mark: string | null): string[] {
  if (!mark) return [...ledgerIdsNewestFirst];
  const edge = ledgerIdsNewestFirst.indexOf(mark);
  return edge === -1 ? [...ledgerIdsNewestFirst] : ledgerIdsNewestFirst.slice(0, edge);
}

/** Human, present-tense phrasing for an action about to run. Falls back to the raw pair so a new
 *  tool shows *something* readable rather than silently reverting to anonymous dots. */
export function activityLabel(tool: string, op: string): string {
  const map: Record<string, string> = {
    'note:create': 'Writing a note',
    'task:create': 'Adding a task',
    'task:complete': 'Completing a task',
    'calendar:create': 'Creating a calendar event',
    'message:send': 'Sending a message',
    'mail:send': 'Sending mail',
    'memory:save': 'Saving to memory',
    'memory:update': 'Updating memory',
    'playbook:capture': 'Learning a playbook',
    'playbook:execute': 'Running a playbook',
    'browser:open': 'Opening a page',
  };
  return map[`${tool}:${op}`] ?? `${op} ${tool}`.replace(/^\w/, c => c.toUpperCase());
}
