import { describe, it, expect } from 'vitest';
import {
  recurringEventTitle,
  recurringEventDate,
  recurringEventOccurrence,
  recurringEventToNativeEvent,
  taskToTaskItem,
  taskToNativeReminder,
  yearsInRange,
} from '../../services/connectors/mappers';
import type { RecurringEvent } from '../../store/useTaskStore';

const bday: RecurringEvent = { id: 'ev-1', type: 'birthday', name: 'Ada', month: 3, day: 7, year: 1990 };

describe('connector mappers — recurring events', () => {
  it('titles with the type emoji', () => {
    expect(recurringEventTitle(bday)).toBe('🎂 Ada');
    expect(recurringEventTitle({ type: 'anniversary', name: 'Us' })).toBe('💍 Us');
    expect(recurringEventTitle({ type: 'custom', name: 'Launch' })).toBe('🎉 Launch');
  });

  it('zero-pads month/day for a given year', () => {
    expect(recurringEventDate(bday, 2026)).toBe('2026-03-07');
    expect(recurringEventDate({ month: 12, day: 25 }, 2026)).toBe('2026-12-25');
  });

  it('expands to an all-day yearly occurrence', () => {
    const occ = recurringEventOccurrence(bday, 2026);
    expect(occ).toMatchObject({ start: '2026-03-07', end: '2026-03-07', allDay: true, recurrence: 'yearly', source: 'local' });
    expect(occ.id).toBe('local-ev-ev-1-2026'); // must round-trip in the local backend's id parser
  });

  it('migrates anchored at the event year, else current year', () => {
    expect(recurringEventToNativeEvent(bday, 2026).start).toBe('1990-03-07');
    const noYear: RecurringEvent = { id: 'ev-2', type: 'custom', name: 'X', month: 1, day: 1 };
    expect(recurringEventToNativeEvent(noYear, 2026).start).toBe('2026-01-01');
    expect(recurringEventToNativeEvent(bday, 2026)).toMatchObject({ allDay: true, recurrence: 'yearly' });
  });
});

describe('connector mappers — tasks', () => {
  it('maps a local task to a TaskItem (drops empty fields)', () => {
    const item = taskToTaskItem({ id: 't1', title: 'Pay rent', completed: false, dueDate: '2026-06-01', details: '', location: '' });
    expect(item).toEqual({ id: 't1', title: 'Pay rent', completed: false, dueDate: '2026-06-01', endDate: undefined, details: undefined, location: undefined, source: 'local' });
  });

  it('builds a native reminder payload', () => {
    const r = taskToNativeReminder({ id: 't1', title: 'Pay rent', dueDate: '2026-06-01', details: 'via bank' });
    expect(r).toMatchObject({ title: 'Pay rent', dueDate: '2026-06-01', details: 'via bank' });
  });
});

describe('connector mappers — yearsInRange', () => {
  it('lists inclusive years spanned', () => {
    expect(yearsInRange('2026-01-01', '2026-12-31')).toEqual([2026]);
    expect(yearsInRange('2025-11-01', '2027-02-01')).toEqual([2025, 2026, 2027]);
  });
  it('returns empty for malformed/backwards ranges', () => {
    expect(yearsInRange('2027-01-01', '2025-01-01')).toEqual([]);
    expect(yearsInRange('', '')).toEqual([]);
  });
});
