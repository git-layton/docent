// Pure transforms between the local store shapes (RecurringEvent / Task in useTaskStore) and the
// backend-agnostic connector models. No I/O here — kept pure so it's unit-testable without any
// native APIs (these are exercised by src/tests/services/connectors.test.ts).

import type { RecurringEvent } from '../../store/useTaskStore';
import type { CalEvent, NewCalEvent, NewTaskItem, TaskItem } from './types';

const EVENT_EMOJI: Record<RecurringEvent['type'], string> = {
  birthday: '🎂',
  anniversary: '💍',
  custom: '🎉',
};

/** Display title for a recurring event, prefixed with its emoji. */
export function recurringEventTitle(ev: Pick<RecurringEvent, 'type' | 'name'>): string {
  return `${EVENT_EMOJI[ev.type] ?? '🎉'} ${ev.name}`.trim();
}

/** Zero-padded 'YYYY-MM-DD' for a given year + the event's month/day. */
export function recurringEventDate(ev: Pick<RecurringEvent, 'month' | 'day'>, year: number): string {
  const mm = String(ev.month).padStart(2, '0');
  const dd = String(ev.day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** One concrete occurrence of a recurring event, as an all-day CalEvent for the given year. */
export function recurringEventOccurrence(ev: RecurringEvent, year: number): CalEvent {
  const date = recurringEventDate(ev, year);
  return {
    id: `local-ev-${ev.id}-${year}`,
    title: recurringEventTitle(ev),
    start: date,
    end: date,
    allDay: true,
    recurrence: 'yearly',
    source: 'local',
  };
}

/**
 * Migration input: a recurring event → a native all-day, yearly-recurring event.
 * Anchored at the event's own `year` if known, otherwise the current year.
 */
export function recurringEventToNativeEvent(ev: RecurringEvent, currentYear: number): NewCalEvent {
  const date = recurringEventDate(ev, ev.year ?? currentYear);
  return {
    title: recurringEventTitle(ev),
    start: date,
    end: date,
    allDay: true,
    recurrence: 'yearly',
  };
}

/** Local store task → connector TaskItem. */
export function taskToTaskItem(t: any): TaskItem {
  return {
    id: t.id,
    title: t.title,
    completed: !!t.completed,
    dueDate: t.dueDate || undefined,
    endDate: t.endDate || undefined,
    details: t.details || undefined,
    location: t.location || undefined,
    source: 'local',
  };
}

/** Migration input: a local task → a native reminder payload. */
export function taskToNativeReminder(t: any): NewTaskItem {
  return {
    title: t.title,
    dueDate: t.dueDate || undefined,
    endDate: t.endDate || undefined,
    details: t.details || undefined,
    location: t.location || undefined,
  };
}

/** Years that the [startISO, endISO] window spans (inclusive), for expanding yearly events. */
export function yearsInRange(startISO: string, endISO: string): number[] {
  if (!/^\d{4}/.test(startISO) || !/^\d{4}/.test(endISO)) return [];
  const sy = Number(startISO.slice(0, 4));
  const ey = Number(endISO.slice(0, 4));
  if (ey < sy) return [];
  const out: number[] = [];
  for (let y = sy; y <= ey; y++) out.push(y);
  return out;
}
