import { create } from 'zustand';
import { db } from '../services/database';

const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface TaskStore {
  tasks: any[];
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
  addTask: (title: string, dueDate?: string | null, details?: string, location?: string) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
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

  addTask: (title, dueDate = null, details = '', location = '') => {
    const toLocalISODate = (dateObj: Date) => {
      const offset = dateObj.getTimezoneOffset() * 60000;
      return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
    };
    set(s => ({
      tasks: [
        ...s.tasks,
        {
          id: generateId('t'),
          title: title.trim(),
          details,
          location,
          completed: false,
          dueDate: dueDate ?? toLocalISODate(new Date()),
          createdAt: Date.now(),
        },
      ],
    }));
  },

  toggleTask: (id) =>
    set(s => ({
      tasks: s.tasks.map(t => (t.id === id ? { ...t, completed: !t.completed } : t)),
    })),

  deleteTask: (id) =>
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id) })),

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
    set({ tasks });
  },

  persist: async () => {
    const { tasks } = get();
    await db.set('tasks', tasks);
  },
}));
