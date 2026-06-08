import { create } from 'zustand';
import { db } from '../services/database';

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface BrowserTab {
  url: string;
  title: string;
  content: string;
  lastCapturedAt: number;
}

interface VisitLogEntry {
  id: string;
  url: string;
  title: string;
  timestamp: number;
  wordCount: number;
  wasDigested: boolean;
  isPrivate: boolean;
}

interface BrowserStore {
  activeTab: BrowserTab | null;
  visitLog: VisitLogEntry[];
  browserChatId: string | null;
  proactiveEnabled: boolean;

  setActiveTab: (tab: BrowserTab | null) => void;
  updateActiveTabContent: (content: string) => void;
  addVisitLogEntry: (entry: VisitLogEntry) => Promise<void>;
  markVisitDigested: (id: string) => Promise<void>;
  setBrowserChatId: (id: string | null) => void;
  setProactiveEnabled: (v: boolean) => void;
  clearVisitLog: () => Promise<void>;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  activeTab: null,
  visitLog: [],
  browserChatId: null,
  proactiveEnabled: false,

  setActiveTab: (tab) => set({ activeTab: tab }),
  updateActiveTabContent: (content) =>
    set(s => s.activeTab ? { activeTab: { ...s.activeTab, content, lastCapturedAt: Date.now() } } : {}),

  addVisitLogEntry: async (entry) => {
    set(s => ({ visitLog: [...s.visitLog, entry].slice(-10000) }));
    await get().persist();
  },

  markVisitDigested: async (id) => {
    set(s => ({ visitLog: s.visitLog.map(e => e.id === id ? { ...e, wasDigested: true } : e) }));
    await get().persist();
  },

  setBrowserChatId: (id) => set({ browserChatId: id }),
  setProactiveEnabled: (v) => set({ proactiveEnabled: v }),

  clearVisitLog: async () => {
    set({ visitLog: [] });
    await get().persist();
  },

  hydrate: async () => {
    const visitLog = await db.get('browserVisitLog', []);
    const proactiveEnabled = await db.get('browserProactiveEnabled', false);
    set({ visitLog, proactiveEnabled });
  },

  persist: async () => {
    const { visitLog, proactiveEnabled } = get();
    await db.set('browserVisitLog', visitLog);
    await db.set('browserProactiveEnabled', proactiveEnabled);
  },
}));

export { generateId };
