// EventKit (native macOS Calendar) backend — talks to the Rust `eventkit_*` commands.
//
// The Rust side speaks epoch-milliseconds; the connector model speaks ISO. All-day events use a
// bare 'YYYY-MM-DD' date both ways; timed events use full ISO datetimes. The date<->ms helpers are
// pure and exported so they're unit-testable without the native bridge.

import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../../store/useSettingsStore';
import type {
  CalEvent, CalendarConnector, CalendarRef, NewCalEvent, NewTaskItem, TasksConnector,
} from '../types';

const isDateOnly = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso);

/** ISO -> epoch ms. All-day dates anchor to local midnight so they land on the intended day. */
export function isoToMs(iso: string, allDay: boolean): number {
  if (allDay && isDateOnly(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(iso);
}

/** epoch ms -> ISO. All-day collapses to 'YYYY-MM-DD' (local); timed keeps the full datetime. */
export function msToIso(ms: number, allDay: boolean): string {
  const d = new Date(ms);
  if (allDay) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return d.toISOString();
}

/** Widen a list window to whole local days so all-day events on the boundary aren't missed. */
export function rangeToMs(startISO: string, endISO: string): { startMs: number; endMs: number } {
  const startMs = isoToMs(startISO, isDateOnly(startISO));
  const endBase = isoToMs(endISO, isDateOnly(endISO));
  // For a date-only end, include the whole day.
  const endMs = isDateOnly(endISO) ? endBase + 24 * 60 * 60 * 1000 - 1 : endBase;
  return { startMs, endMs };
}

interface RustCalRef { id: string; title: string; writable: boolean; account: string }
interface RustEkEvent {
  id: string; calendarId: string; title: string;
  start: number; end: number; allDay: boolean; location: string; notes: string;
}

export const eventkitCalendar: CalendarConnector = {
  backend: 'eventkit',

  async listCalendars(): Promise<CalendarRef[]> {
    const cals = await invoke<RustCalRef[]>('eventkit_list_calendars', { kind: 'event' });
    return cals.map(c => ({ id: c.id, title: c.title, writable: c.writable, account: c.account || undefined }));
  },

  async listEvents(startISO, endISO): Promise<CalEvent[]> {
    const { startMs, endMs } = rangeToMs(startISO, endISO);
    const evs = await invoke<RustEkEvent[]>('eventkit_list_events', { startMs, endMs });
    // Honor the user's calendar selection (empty = show all).
    const selected: string[] = (useSettingsStore.getState().integrations as any).calendar?.selectedCalendarIds ?? [];
    const visible = selected.length ? evs.filter(e => selected.includes(e.calendarId)) : evs;
    return visible.map(e => ({
      id: e.id,
      calendarId: e.calendarId,
      title: e.title,
      start: msToIso(e.start, e.allDay),
      end: msToIso(e.end, e.allDay),
      allDay: e.allDay,
      location: e.location || undefined,
      notes: e.notes || undefined,
      source: 'eventkit',
    }));
  },

  async createEvent(e: NewCalEvent): Promise<string> {
    return invoke<string>('eventkit_save_event', {
      calendarId: e.calendarId ?? null,
      title: e.title,
      startMs: isoToMs(e.start, e.allDay),
      endMs: isoToMs(e.end, e.allDay),
      allDay: e.allDay,
      location: e.location ?? null,
      notes: e.notes ?? null,
      yearly: e.recurrence === 'yearly',
    });
  },

  async updateEvent(id, patch): Promise<void> {
    const allDay = patch.allDay ?? false;
    await invoke('eventkit_update_event', {
      id,
      title: patch.title ?? null,
      startMs: patch.start != null ? isoToMs(patch.start, allDay) : null,
      endMs: patch.end != null ? isoToMs(patch.end, allDay) : null,
      allDay: patch.allDay ?? null,
      location: patch.location ?? null,
      notes: patch.notes ?? null,
    });
  },

  async deleteEvent(id): Promise<void> {
    await invoke('eventkit_delete_event', { id });
  },
};

interface RustEkReminder { id: string; listId: string; title: string; completed: boolean; due: string | null }

export const eventkitTasks: TasksConnector = {
  backend: 'eventkit',

  async listLists(): Promise<CalendarRef[]> {
    const lists = await invoke<RustCalRef[]>('eventkit_list_calendars', { kind: 'reminder' });
    return lists.map(c => ({ id: c.id, title: c.title, writable: c.writable, account: c.account || undefined }));
  },

  async listTasks() {
    const rs = await invoke<RustEkReminder[]>('eventkit_list_reminders');
    return rs.map(r => ({
      id: r.id,
      listId: r.listId || undefined,
      title: r.title,
      completed: r.completed,
      dueDate: r.due || undefined,
      source: 'eventkit' as const,
    }));
  },

  async createTask(t: NewTaskItem): Promise<string> {
    return invoke<string>('eventkit_save_reminder', {
      listId: t.listId ?? null,
      title: t.title,
      due: t.dueDate ?? null,
    });
  },

  async updateTask(id, patch): Promise<void> {
    await invoke('eventkit_update_reminder', {
      id,
      title: patch.title ?? null,
      due: patch.dueDate ?? null,
    });
  },

  async setCompleted(id, completed): Promise<void> {
    await invoke('eventkit_set_reminder_completed', { id, completed });
  },

  async deleteTask(id): Promise<void> {
    await invoke('eventkit_delete_reminder', { id });
  },
};
