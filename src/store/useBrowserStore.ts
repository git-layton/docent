import { create } from 'zustand';
import { db } from '../services/database';
import { generateId } from '../lib/id';

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
  // Space the page was viewed in — the consent boundary for agent recall. Optional: legacy/
  // outside-a-Space visits are un-attributable and excluded from scoped recall.
  spaceId?: string;
}

export interface Favorite {
  id: string;
  url: string;
  title: string;
}

const DEFAULT_FAVORITES: Favorite[] = [
  { id: 'fav-ddg', url: 'https://start.duckduckgo.com', title: 'DuckDuckGo' },
  { id: 'fav-gh', url: 'https://github.com', title: 'GitHub' },
  { id: 'fav-hn', url: 'https://news.ycombinator.com', title: 'Hacker News' },
];

interface BrowserStore {
  activeTab: BrowserTab | null;
  visitLog: VisitLogEntry[];
  favorites: Favorite[];
  browserChatId: string | null;
  proactiveEnabled: boolean;
  savedTabs: Array<{ id: string; url: string; title: string }>;
  savedActiveTabId: string | null;
  adminMode: boolean;
  aiTrackingEnabled: boolean;

  setActiveTab: (tab: BrowserTab | null) => void;
  updateActiveTabContent: (content: string) => void;
  addVisitLogEntry: (entry: VisitLogEntry) => Promise<void>;
  markVisitDigested: (id: string) => Promise<void>;
  updateVisitWordCount: (id: string, wordCount: number) => Promise<void>;
  setBrowserChatId: (id: string | null) => void;
  setProactiveEnabled: (v: boolean) => void;
  clearVisitLog: () => Promise<void>;
  addFavorite: (url: string, title: string) => Promise<void>;
  removeFavorite: (url: string) => Promise<void>;
  setSavedTabs: (tabs: Array<{ id: string; url: string; title: string }>, activeId: string) => Promise<void>;
  setAdminMode: (v: boolean) => Promise<void>;
  setAiTrackingEnabled: (v: boolean) => Promise<void>;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  activeTab: null,
  visitLog: [],
  favorites: DEFAULT_FAVORITES,
  browserChatId: null,
  proactiveEnabled: false,
  savedTabs: [],
  savedActiveTabId: null,
  adminMode: false,
  aiTrackingEnabled: true,

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

  // Backfill a visit's word count once the page text has been captured (it's logged as 0 at
  // navigation time, before the async content extraction settles).
  updateVisitWordCount: async (id, wordCount) => {
    set(s => ({ visitLog: s.visitLog.map(e => e.id === id ? { ...e, wordCount } : e) }));
    await get().persist();
  },

  setBrowserChatId: (id) => set({ browserChatId: id }),
  setProactiveEnabled: (v) => set({ proactiveEnabled: v }),

  clearVisitLog: async () => {
    set({ visitLog: [] });
    await get().persist();
  },

  addFavorite: async (url, title) => {
    const already = get().favorites.some(f => f.url === url);
    if (already) return;
    const fav: Favorite = { id: generateId('fav'), url, title: title || new URL(url).hostname };
    set(s => ({ favorites: [...s.favorites, fav] }));
    await get().persist();
  },

  removeFavorite: async (url) => {
    set(s => ({ favorites: s.favorites.filter(f => f.url !== url) }));
    await get().persist();
  },

  setSavedTabs: async (tabs, activeId) => {
    set({ savedTabs: tabs, savedActiveTabId: activeId });
    await get().persist();
  },

  setAdminMode: async (v) => {
    set({ adminMode: v });
    await get().persist();
  },

  setAiTrackingEnabled: async (v) => {
    set({ aiTrackingEnabled: v });
    await get().persist();
  },

  hydrate: async () => {
    const visitLog = await db.get('browserVisitLog', []);
    const proactiveEnabled = await db.get('browserProactiveEnabled', false);
    const favorites = await db.get('browserFavorites', DEFAULT_FAVORITES);
    const savedTabs = await db.get('browserSavedTabs', []);
    const savedActiveTabId = await db.get('browserSavedActiveTabId', null);
    const adminMode = await db.get('browserAdminMode', false);
    const aiTrackingEnabled = await db.get('browserAiTrackingEnabled', true);
    set({ visitLog, proactiveEnabled, favorites, savedTabs, savedActiveTabId, adminMode, aiTrackingEnabled });
  },

  persist: async () => {
    const { visitLog, proactiveEnabled, favorites, savedTabs, savedActiveTabId, adminMode, aiTrackingEnabled } = get();
    await db.set('browserVisitLog', visitLog);
    await db.set('browserProactiveEnabled', proactiveEnabled);
    await db.set('browserFavorites', favorites);
    await db.set('browserSavedTabs', savedTabs);
    await db.set('browserSavedActiveTabId', savedActiveTabId);
    await db.set('browserAdminMode', adminMode);
    await db.set('browserAiTrackingEnabled', aiTrackingEnabled);
  },
}));

export { generateId };
