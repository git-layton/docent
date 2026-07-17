import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useReceiptStore, __resetReceipts } from '../../services/receipts';

// The trust ledger: agent actions land here with honest reversibility — a receipt is undoable
// only while a live handler is registered, and a failed undo leaves the record untouched.

describe('receipt ledger', () => {
  beforeEach(() => {
    __resetReceipts();
  });

  it('records newest-first with done status', () => {
    const s = useReceiptStore.getState();
    s.record({ surface: 'notes', action: 'Created note “A”', summary: 'Create note “A”' });
    s.record({ surface: 'mail', action: 'Sent email', summary: 'Send email to sam@x.com: “Hi”' });
    const receipts = useReceiptStore.getState().receipts;
    expect(receipts).toHaveLength(2);
    expect(receipts[0].surface).toBe('mail'); // newest first
    expect(receipts.every(r => r.status === 'done')).toBe(true);
  });

  it('a receipt without an undo handler is not undoable, and undo() refuses it', async () => {
    const r = useReceiptStore.getState().record({ surface: 'messages', action: 'Sent iMessage', summary: 'Send iMessage to Sam' });
    expect(useReceiptStore.getState().isUndoable(r.id)).toBe(false);
    await expect(useReceiptStore.getState().undo(r.id)).rejects.toThrow(/no longer be undone/);
    expect(useReceiptStore.getState().receipts[0].status).toBe('done');
  });

  it('undo runs the handler once, marks the receipt undone, and deregisters', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const r = useReceiptStore.getState().record({ surface: 'tasks', action: 'Added to-do “x”', summary: 'Add to-do “x”' }, undo);
    expect(useReceiptStore.getState().isUndoable(r.id)).toBe(true);

    await useReceiptStore.getState().undo(r.id);
    expect(undo).toHaveBeenCalledTimes(1);
    const after = useReceiptStore.getState().receipts[0];
    expect(after.status).toBe('undone');
    expect(after.undoneAt).toBeGreaterThan(0);
    expect(useReceiptStore.getState().isUndoable(r.id)).toBe(false);
    await expect(useReceiptStore.getState().undo(r.id)).rejects.toThrow(); // no double-undo
  });

  it('a failed undo leaves the receipt done and the handler registered for retry', async () => {
    const undo = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const r = useReceiptStore.getState().record({ surface: 'calendar', action: 'Added event', summary: 'Add event' }, undo);

    await expect(useReceiptStore.getState().undo(r.id)).rejects.toThrow('offline');
    expect(useReceiptStore.getState().receipts[0].status).toBe('done');
    expect(useReceiptStore.getState().isUndoable(r.id)).toBe(true); // retry allowed

    await useReceiptStore.getState().undo(r.id);
    expect(useReceiptStore.getState().receipts[0].status).toBe('undone');
  });

  it('caps the ledger at 200 receipts', () => {
    for (let i = 0; i < 210; i++) {
      useReceiptStore.getState().record({ surface: 'system', action: `a${i}`, summary: `s${i}` });
    }
    const receipts = useReceiptStore.getState().receipts;
    expect(receipts).toHaveLength(200);
    expect(receipts[0].action).toBe('a209'); // newest kept, oldest dropped
  });
});
