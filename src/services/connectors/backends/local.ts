// Local backend — wraps the existing IndexedDB-backed stores so "local" is just another connector.
// Calendar events ← useTaskStore.recurringEvents (yearly all-day). Tasks ← useTaskStore.tasks.
// Notes ← a dedicated `db` key (no prior local notes store existed).

import { db } from '../../database';
import { useTaskStore } from '../../../store/useTaskStore';
import type {
  CalEvent, CalendarConnector, CalendarRef, NewCalEvent, NewTaskItem,
  NoteItem, NotesConnector, TasksConnector,
} from '../types';
import {
  recurringEventOccurrence, taskToTaskItem, yearsInRange,
} from '../mappers';

const genId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const stripEmoji = (s: string) => s.replace(/^\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, '').trim();

// occurrence id ↔ recurringEvent id (occurrence id = `local-ev-<recurringId>-<year>`).
function recurringIdFromOccurrence(occId: string): string | null {
  const m = occId.match(/^local-ev-(.+)-(\d{4})$/);
  return m ? m[1] : null;
}

const LOCAL_CAL: CalendarRef = { id: 'local', title: 'On this Mac', writable: true };

export const localCalendar: CalendarConnector = {
  backend: 'local',
  async listCalendars() {
    return [LOCAL_CAL];
  },
  async listEvents(startISO, endISO) {
    const events = useTaskStore.getState().recurringEvents;
    const years = yearsInRange(startISO, endISO);
    const out: CalEvent[] = [];
    for (const ev of events) {
      for (const y of years) {
        const occ = recurringEventOccurrence(ev, y);
        if (occ.start >= startISO && occ.start <= endISO) out.push(occ);
      }
    }
    return out;
  },
  async createEvent(e: NewCalEvent) {
    // The local store only models yearly recurring all-day events (birthdays/anniversaries/custom).
    const [y, m, d] = e.start.split('-').map(Number);
    useTaskStore.getState().addRecurringEvent({
      type: 'custom',
      name: stripEmoji(e.title),
      month: m || 1,
      day: d || 1,
      year: y || undefined,
    });
    // addRecurringEvent assigns its own id; return a best-effort occurrence id for the start year.
    const all = useTaskStore.getState().recurringEvents;
    const created = all[all.length - 1];
    return created ? `local-ev-${created.id}-${y}` : 'local-ev-unknown';
  },
  async updateEvent(id, patch) {
    const rid = recurringIdFromOccurrence(id);
    if (!rid) return;
    const p: any = {};
    if (patch.title !== undefined) p.name = stripEmoji(patch.title);
    if (patch.start) {
      const [, m, d] = patch.start.split('-').map(Number);
      if (m) p.month = m;
      if (d) p.day = d;
    }
    useTaskStore.getState().updateRecurringEvent(rid, p);
  },
  async deleteEvent(id) {
    const rid = recurringIdFromOccurrence(id);
    if (rid) useTaskStore.getState().deleteRecurringEvent(rid);
  },
};

const LOCAL_LIST: CalendarRef = { id: 'local', title: 'On this Mac', writable: true };

export const localTasks: TasksConnector = {
  backend: 'local',
  async listLists() {
    return [LOCAL_LIST];
  },
  async listTasks() {
    return useTaskStore.getState().tasks.map(taskToTaskItem);
  },
  async createTask(t: NewTaskItem) {
    const before = new Set(useTaskStore.getState().tasks.map((x: any) => x.id));
    useTaskStore.getState().addTask(t.title, t.dueDate ?? null, t.details ?? '', t.location ?? '', t.endDate ?? null);
    await useTaskStore.getState().persist();
    const created = useTaskStore.getState().tasks.find((x: any) => !before.has(x.id));
    return created?.id ?? 'local-task-unknown';
  },
  async updateTask(id, patch) {
    useTaskStore.getState().updateTask(id, {
      title: patch.title,
      dueDate: patch.dueDate ?? null,
      endDate: patch.endDate ?? null,
      details: patch.details,
      location: patch.location,
    } as any);
    await useTaskStore.getState().persist();
  },
  async setCompleted(id, completed) {
    const cur = useTaskStore.getState().tasks.find((t: any) => t.id === id);
    if (cur && !!cur.completed !== completed) useTaskStore.getState().toggleTask(id); // toggleTask persists
  },
  async deleteTask(id) {
    useTaskStore.getState().deleteTask(id);
    await useTaskStore.getState().persist();
  },
};

// ── Local notes (db-backed; no prior store) ──
const NOTES_KEY = 'localNotes';
async function readNotes(): Promise<NoteItem[]> {
  return (await db.get(NOTES_KEY, [])) as NoteItem[];
}
async function writeNotes(notes: NoteItem[]): Promise<void> {
  await db.set(NOTES_KEY, notes);
}

export const localNotes: NotesConnector = {
  backend: 'local',
  async listFolders() {
    const folders = new Set((await readNotes()).map(n => n.folder).filter(Boolean) as string[]);
    return ['Notes', ...[...folders].filter(f => f !== 'Notes')];
  },
  async listNotes(folder) {
    const all = await readNotes();
    return (folder ? all.filter(n => (n.folder ?? 'Notes') === folder) : all)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async readNote(id) {
    const note = (await readNotes()).find(n => n.id === id);
    if (!note) throw new Error('note not found');
    return note;
  },
  async createNote(folder, title, body) {
    const note: NoteItem = { id: genId('note'), folder: folder ?? 'Notes', title, body, updatedAt: Date.now(), source: 'local' };
    await writeNotes([note, ...(await readNotes())]);
    return note.id;
  },
  async updateNote(id, body) {
    const all = await readNotes();
    await writeNotes(all.map(n => (n.id === id ? { ...n, body, updatedAt: Date.now() } : n)));
  },
  async deleteNote(id) {
    await writeNotes((await readNotes()).filter(n => n.id !== id));
  },
};
