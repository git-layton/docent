import { create } from 'zustand';
import { db } from './database';
import { generateId } from '../lib/id';

// Receipts — the trust ledger for agent actions.
//
// Every action an agent executes produces a receipt: what happened, to what, when, and — when
// the action is genuinely reversible — a working undo. The record is append-only and persisted
// (an audit trail the user can always consult); undo handlers are session-scoped closures (a
// callback can't survive a restart), so "can this be undone?" is answered by the live handler
// registry, never by a stored flag that could lie about reversibility.
//
// Producers: executeAgentAction (services/agentActions.ts) records automatically for every
// agent action. Other surfaces (browser errands, memory writes, inbox routing) join the same
// ledger by calling useReceiptStore.getState().record(...).

export type ReceiptSurface =
  | 'notes' | 'tasks' | 'calendar' | 'messages' | 'mail' | 'music'
  | 'playbook' | 'memory' | 'browser' | 'inbox' | 'system';

export interface Receipt {
  id: string;
  ts: number;
  surface: ReceiptSurface;
  /** Short verb phrase — what happened: "Sent iMessage", "Created note "Groceries"". */
  action: string;
  /** Fuller human sentence with the object/destination, shown as the card body. */
  summary: string;
  /** Optional "why" — the agent's rationale for taking the action, when available. */
  detail?: string;
  status: 'done' | 'undone';
  undoneAt?: number;
}

export interface ReceiptInput {
  surface: ReceiptSurface;
  action: string;
  summary: string;
  detail?: string;
}

/** Newest receipts win; the ledger is capped so it can't grow unbounded. */
const CAP = 200;

/** Session-scoped undo closures, keyed by receipt id. Deliberately outside the store: they are
 * not serializable and must never be persisted. */
const undoHandlers = new Map<string, () => Promise<void>>();

let hydratePromise: Promise<void> | null = null;

interface ReceiptState {
  receipts: Receipt[];
  /** Load persisted history (once); session receipts recorded earlier stay newest-first. */
  hydrate: () => Promise<void>;
  /** Append a receipt; pass `undo` only when the action is genuinely reversible. */
  record: (input: ReceiptInput, undo?: () => Promise<void>) => Receipt;
  /** Run the registered undo. Throws if none is registered (restart, already undone). */
  undo: (id: string) => Promise<void>;
  /** Whether a working undo handler is still registered for this receipt. */
  isUndoable: (id: string) => boolean;
}

export const useReceiptStore = create<ReceiptState>((set, get) => ({
  receipts: [],

  hydrate: () =>
    (hydratePromise ??= (async () => {
      const saved = await db.get('receipts', [] as Receipt[]).catch(() => [] as Receipt[]);
      set(s => {
        const seen = new Set(s.receipts.map(r => r.id));
        const history = (Array.isArray(saved) ? saved : []).filter(r => r && r.id && !seen.has(r.id));
        return { receipts: [...s.receipts, ...history].slice(0, CAP) };
      });
    })()),

  record: (input, undo) => {
    const receipt: Receipt = { id: generateId('rcpt'), ts: Date.now(), status: 'done', ...input };
    if (undo) undoHandlers.set(receipt.id, undo);
    set(s => ({ receipts: [receipt, ...s.receipts].slice(0, CAP) }));
    // Persist only after history is merged, so an early-session write can't clobber the ledger.
    void get().hydrate().then(() => db.set('receipts', get().receipts)).catch(() => {});
    return receipt;
  },

  undo: async (id) => {
    const handler = undoHandlers.get(id);
    if (!handler) throw new Error('This action can no longer be undone.');
    await handler(); // a failed undo throws and the receipt stays 'done'
    undoHandlers.delete(id);
    set(s => ({ receipts: s.receipts.map(r => (r.id === id ? { ...r, status: 'undone' as const, undoneAt: Date.now() } : r)) }));
    void get().hydrate().then(() => db.set('receipts', get().receipts)).catch(() => {});
  },

  isUndoable: (id) => undoHandlers.has(id),
}));

/** Test hook: clear the ledger and all registered undo handlers. */
export function __resetReceipts() {
  undoHandlers.clear();
  hydratePromise = null;
  useReceiptStore.setState({ receipts: [] });
}
