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

export interface ActivityStep {
  label: string;
  status: 'pending' | 'running' | 'done';
}

interface AgentActivityState {
  /** Present-tense phrase for the step in flight, e.g. "Saving to memory". Null when idle. */
  label: string | null;
  /** How many actions this turn will apply, for "2 of 5" style progress. 0 when not applying. */
  total: number;
  done: number;
  /**
   * Every step this turn will take, in order, each carrying its own status.
   *
   * `label` alone could only ever show the step in flight: each new action overwrote the last and
   * the whole lot was cleared at the end, so actions flickered past and vanished. You could watch
   * five things happen and be unable to say what any of them were. The list is what lets the UI
   * show the shape of the work — what is done, what is happening, what is still coming.
   */
  steps: ActivityStep[];

  begin: (label: string, total?: number) => void;
  /** Seed the whole plan up front. Callers know every action before applying the first. */
  beginSteps: (labels: string[]) => void;
  advance: (label: string) => void;
  end: () => void;
}

export const useAgentActivityStore = create<AgentActivityState>((set) => ({
  label: null,
  total: 0,
  done: 0,
  steps: [],

  begin: (label, total = 0) => set({ label, total, done: 0, steps: [] }),

  beginSteps: (labels) => set({
    label: labels[0] ?? null,
    total: labels.length,
    done: 0,
    steps: labels.map((l, i) => ({ label: l, status: i === 0 ? 'running' : 'pending' })),
  }),

  // Advancing means: whatever was running is finished, and this is what's running now. Matched by
  // position rather than by label text, since two identical actions in one turn share a label.
  advance: (label) => set(s => {
    const nextDone = Math.min(s.done + 1, s.total || s.done + 1);
    const steps = s.steps.length
      ? s.steps.map((st, i) => (
          i < nextDone ? { ...st, status: 'done' as const }
          : i === nextDone ? { ...st, status: 'running' as const }
          : st
        ))
      : s.steps;
    return { label, done: nextDone, steps };
  }),

  end: () => set({ label: null, total: 0, done: 0, steps: [] }),
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
