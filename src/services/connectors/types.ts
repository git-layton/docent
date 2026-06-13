// Backend-agnostic connector model.
//
// Calendar / Tasks (reminders) / Notes each expose a small interface that the UI and agents call;
// the actual data lives in a swappable backend (local store, native macOS via EventKit/AppleScript,
// or a cloud API). The active backend per domain is a user setting — see `integrations.{calendar,
// tasks,notes}.backend` in useSettingsStore. Switching backends is a setting, not a code change.

export type BackendId = 'local' | 'eventkit' | 'google' | 'applescript';

/** A calendar or reminder list the user can read from / write to (used for selection). */
export interface CalendarRef {
  id: string;
  title: string;
  color?: string;
  writable: boolean;
  account?: string; // e.g. iCloud / Gmail address, for disambiguation
}

export interface CalEvent {
  id: string;
  calendarId?: string;
  title: string;
  start: string; // ISO — date ('YYYY-MM-DD') when allDay, else datetime
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  recurrence?: 'none' | 'yearly';
  source: BackendId;
}

export interface TaskItem {
  id: string;
  listId?: string;
  title: string;
  completed: boolean;
  dueDate?: string; // ISO 'YYYY-MM-DD'
  endDate?: string; // ISO 'YYYY-MM-DD' — multi-day span
  details?: string;
  location?: string;
  source: BackendId;
}

export interface NoteItem {
  id: string;
  folder?: string;
  title: string;
  body: string;
  updatedAt: number;
  source: BackendId;
}

/** New-item payloads (no id/source — the backend assigns those). */
export type NewCalEvent = Omit<CalEvent, 'id' | 'source'>;
export type NewTaskItem = Omit<TaskItem, 'id' | 'source' | 'completed'>;

export interface CalendarConnector {
  readonly backend: BackendId;
  /** Calendars available for reading/writing (for the selection UI). */
  listCalendars(): Promise<CalendarRef[]>;
  /** Events overlapping [startISO, endISO]. */
  listEvents(startISO: string, endISO: string): Promise<CalEvent[]>;
  createEvent(e: NewCalEvent): Promise<string>;
  updateEvent(id: string, patch: Partial<NewCalEvent>): Promise<void>;
  deleteEvent(id: string): Promise<void>;
}

export interface TasksConnector {
  readonly backend: BackendId;
  /** Reminder lists (reuses CalendarRef shape). */
  listLists(): Promise<CalendarRef[]>;
  listTasks(): Promise<TaskItem[]>;
  createTask(t: NewTaskItem): Promise<string>;
  updateTask(id: string, patch: Partial<NewTaskItem>): Promise<void>;
  setCompleted(id: string, completed: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;
}

export interface NotesConnector {
  readonly backend: BackendId;
  listFolders(): Promise<string[]>;
  listNotes(folder?: string): Promise<NoteItem[]>;
  readNote(id: string): Promise<NoteItem>;
  createNote(folder: string | undefined, title: string, body: string): Promise<string>;
  updateNote(id: string, body: string): Promise<void>;
  deleteNote(id: string): Promise<void>;
}
