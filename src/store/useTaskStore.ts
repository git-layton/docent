import { create } from 'zustand';
import { db } from '../services/database';

const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export interface RecurringEvent {
  id: string;
  type: 'birthday' | 'anniversary' | 'custom';
  name: string;
  month: number;   // 1–12
  day: number;     // 1–31
  year?: number;   // optional birth/event year
}

/**
 * Whether a task occupies the given ISO date ('YYYY-MM-DD'), accounting for
 * multi-day spans. Lexicographic comparison is correct for zero-padded ISO
 * dates. A task with no `endDate` (or an `endDate` before its start) is treated
 * as a single-day event on `dueDate`.
 */
export function taskCoversDate(t: any, iso: string): boolean {
  if (!t?.dueDate) return false;
  const end = t.endDate && t.endDate >= t.dueDate ? t.endDate : t.dueDate;
  return iso >= t.dueDate && iso <= end;
}

interface TaskStore {
  tasks: any[];
  recurringEvents: RecurringEvent[];
  showPlanner: boolean;
  plannerView: string;
  currentMonthDate: Date;
  newTaskInput: string;
  newTaskDate: string;
  newTaskDetails: string;
  newTaskLocation: string;
  showTaskDetailsForm: boolean;
  taskToDiscuss: any;
  draggedTaskId: string | null;

  setTasks: (fn: ((prev: any[]) => any[]) | any[]) => void;
  addTask: (title: string, dueDate?: string | null, details?: string, location?: string, endDate?: string | null) => void;
  updateTask: (id: string, patch: Partial<{ title: string; dueDate: string | null; endDate: string | null; details: string; location: string }>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  addRecurringEvent: (e: Omit<RecurringEvent, 'id'>) => void;
  updateRecurringEvent: (id: string, patch: Partial<Omit<RecurringEvent, 'id'>>) => void;
  deleteRecurringEvent: (id: string) => void;
  setShowPlanner: (v: boolean | ((prev: boolean) => boolean)) => void;
  setPlannerView: (v: string) => void;
  setCurrentMonthDate: (d: Date) => void;
  setNewTaskInput: (v: string) => void;
  setNewTaskDate: (v: string) => void;
  setNewTaskDetails: (v: string) => void;
  setNewTaskLocation: (v: string) => void;
  setShowTaskDetailsForm: (v: boolean) => void;
  setTaskToDiscuss: (t: any) => void;
  setDraggedTaskId: (id: string | null) => void;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  recurringEvents: [],
  showPlanner: false,
  plannerView: 'list',
  currentMonthDate: new Date(),
  newTaskInput: '',
  newTaskDate: '',
  newTaskDetails: '',
  newTaskLocation: '',
  showTaskDetailsForm: false,
  taskToDiscuss: null,
  draggedTaskId: null,

  setTasks: (fn) =>
    set(s => ({ tasks: typeof fn === 'function' ? fn(s.tasks) : fn })),

  addTask: (title, dueDate = null, details = '', location = '', endDate = null) => {
    const toLocalISODate = (dateObj: Date) => {
      const offset = dateObj.getTimezoneOffset() * 60000;
      return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
    };
    const start = dueDate ?? toLocalISODate(new Date());
    set(s => ({
      tasks: [
        ...s.tasks,
        {
          id: generateId('t'),
          title: title.trim(),
          details,
          location,
          completed: false,
          dueDate: start,
          // Only store an endDate for genuine multi-day spans (after the start).
          endDate: endDate && endDate > start ? endDate : undefined,
          createdAt: Date.now(),
          completedAt: undefined,
        },
      ],
    }));
  },

  updateTask: (id, patch) => {
    set(s => ({
      tasks: s.tasks.map(t => {
        if (t.id !== id) return t;
        const next: any = { ...t };
        if (patch.title !== undefined) next.title = patch.title.trim();
        if (patch.details !== undefined) next.details = patch.details;
        if (patch.location !== undefined) next.location = patch.location;
        if (patch.dueDate !== undefined && patch.dueDate) next.dueDate = patch.dueDate;
        if (patch.endDate !== undefined) {
          // Clear the span when the new end isn't strictly after the start.
          next.endDate = patch.endDate && patch.endDate > next.dueDate ? patch.endDate : undefined;
        }
        return next;
      }),
    }));
  },

  toggleTask: (id) => {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const nowCompleting = !task.completed;
    const completedAt = nowCompleting ? Date.now() : undefined;

    set(s => ({
      tasks: s.tasks.map(t =>
        t.id === id ? { ...t, completed: !t.completed, completedAt } : t
      ),
    }));

    // Fire-and-forget: write completion record to ~/AgentForge/memory/completed_tasks.md
    if (nowCompleting) {
      const toISO = (ms: number) => new Date(ms).toISOString().split('T')[0];
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('complete_task', {
          title: task.title,
          details: task.details || '',
          dueDate: task.dueDate || '',
          completedAt: toISO(completedAt as number),
        }).catch(() => {});
      }).catch(() => {});
    }

    get().persist();
  },

  deleteTask: (id) =>
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id) })),

  addRecurringEvent: (e) => {
    const event: RecurringEvent = { id: generateId('ev'), ...e };
    set(s => ({ recurringEvents: [...s.recurringEvents, event] }));
    const { recurringEvents } = get();
    db.set('recurringEvents', recurringEvents);
  },

  updateRecurringEvent: (id, patch) => {
    set(s => ({ recurringEvents: s.recurringEvents.map(e => e.id === id ? { ...e, ...patch } : e) }));
    db.set('recurringEvents', get().recurringEvents);
  },

  deleteRecurringEvent: (id) => {
    set(s => ({ recurringEvents: s.recurringEvents.filter(e => e.id !== id) }));
    const { recurringEvents } = get();
    db.set('recurringEvents', recurringEvents);
  },

  setShowPlanner: (v) =>
    set(s => ({ showPlanner: typeof v === 'function' ? v(s.showPlanner) : v })),
  setPlannerView: (v) => set({ plannerView: v }),
  setCurrentMonthDate: (d) => set({ currentMonthDate: d }),
  setNewTaskInput: (v) => set({ newTaskInput: v }),
  setNewTaskDate: (v) => set({ newTaskDate: v }),
  setNewTaskDetails: (v) => set({ newTaskDetails: v }),
  setNewTaskLocation: (v) => set({ newTaskLocation: v }),
  setShowTaskDetailsForm: (v) => set({ showTaskDetailsForm: v }),
  setTaskToDiscuss: (t) => set({ taskToDiscuss: t }),
  setDraggedTaskId: (id) => set({ draggedTaskId: id }),

  hydrate: async () => {
    const tasks = await db.get('tasks', []);
    const recurringEvents = await db.get('recurringEvents', []);
    set({ tasks, recurringEvents });
  },

  persist: async () => {
    const { tasks } = get();
    await db.set('tasks', tasks);
  },
}));
