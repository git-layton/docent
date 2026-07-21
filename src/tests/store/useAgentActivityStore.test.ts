import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentActivityStore, activityLabel, receiptsSince } from '../../store/useAgentActivityStore';

describe('receiptsSince', () => {
  // The ledger is newest-first, so a turn's receipts sit AHEAD of the mark that was on top
  // when the turn began. Getting the direction wrong would silently pin the previous turn's
  // actions onto this reply — the exact failure the trail exists to prevent.
  const ledger = ['r5', 'r4', 'r3', 'r2', 'r1']; // r5 newest

  it('returns only what was appended after the mark', () => {
    expect(receiptsSince(ledger, 'r3')).toEqual(['r5', 'r4']);
  });

  it('returns nothing when the mark is still on top (turn wrote no receipts)', () => {
    expect(receiptsSince(ledger, 'r5')).toEqual([]);
  });

  it('claims the whole ledger when there was no mark (ledger started empty)', () => {
    expect(receiptsSince(ledger, null)).toEqual(ledger);
  });

  it('claims everything rather than nothing if the mark aged off the cap', () => {
    expect(receiptsSince(ledger, 'long-gone')).toEqual(ledger);
  });

  it('does not alias the caller’s array', () => {
    const out = receiptsSince(ledger, null);
    out.push('mutated');
    expect(ledger).toHaveLength(5);
  });
});

describe('activityLabel', () => {
  it('gives known tool/op pairs a human present-tense phrase', () => {
    expect(activityLabel('calendar', 'create')).toBe('Creating a calendar event');
    expect(activityLabel('memory', 'save')).toBe('Saving to memory');
  });

  it('still says something readable for an unmapped tool', () => {
    // A new tool must never silently fall back to anonymous dots.
    expect(activityLabel('widget', 'frobnicate')).toBe('Frobnicate widget');
  });
});

describe('activity lifecycle', () => {
  beforeEach(() => useAgentActivityStore.getState().end());

  it('tracks progress across steps and clears on end', () => {
    const s = () => useAgentActivityStore.getState();
    s().begin('Working', 3);
    expect(s().label).toBe('Working');
    expect(s().total).toBe(3);

    s().advance('Writing a note');
    expect(s().label).toBe('Writing a note');
    expect(s().done).toBe(1);

    s().advance('Adding a task');
    expect(s().done).toBe(2);

    s().end();
    expect(s().label).toBeNull();
    expect(s().done).toBe(0);
  });

  it('never reports more done than total', () => {
    const s = () => useAgentActivityStore.getState();
    s().begin('Working', 1);
    s().advance('a');
    s().advance('b');
    expect(s().done).toBe(1);
  });
});
