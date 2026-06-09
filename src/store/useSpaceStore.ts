import { create } from 'zustand';
import { db } from '../services/database';
import type { OmniTab, Space } from '../types/omniTab';

const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const defaultSpace: Space = {
  id: 'space-home',
  name: 'Home',
  agentIds: ['alexis'],
  peopleIds: [],
  tabIds: ['tab-space-log-default'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const defaultTab: OmniTab = {
  id: 'tab-space-log-default',
  type: 'space-log',
  label: 'Space Log',
  spaceId: 'space-home',
  isPinned: true,
};

interface SpaceStore {
  spaces: Space[];
  activeSpaceId: string | null;
  omniTabs: OmniTab[];
  activeOmniTabId: string | null;

  setActiveTab(id: string): void;
  openTab(tab: Omit<OmniTab, 'id'>): string;
  closeTab(id: string): void;
  moveTab(fromIdx: number, toIdx: number): void;
  updateTabLabel(id: string, url: string, title: string): void;
  createSpace(name: string, agentIds?: string[]): Space;
  deleteSpace(id: string): void;
  updateSpace(id: string, patch: Partial<Space>): void;
  setActiveSpaceId(id: string | null): void;

  hydrate(): Promise<void>;
  persist(): Promise<void>;
}

export const useSpaceStore = create<SpaceStore>((set, get) => ({
  spaces: [],
  activeSpaceId: null,
  omniTabs: [],
  activeOmniTabId: null,

  setActiveTab: (id) => set({ activeOmniTabId: id }),

  openTab: (tab) => {
    const id = generateId('tab');
    const newTab: OmniTab = { ...tab, id };
    set(s => ({ omniTabs: [...s.omniTabs, newTab], activeOmniTabId: id }));
    get().persist();
    return id;
  },

  closeTab: (id) => {
    const { omniTabs, activeOmniTabId } = get();
    const tab = omniTabs.find(t => t.id === id);
    if (!tab || tab.isPinned) return;

    const remaining = omniTabs.filter(t => t.id !== id);
    let nextActiveId = activeOmniTabId;

    if (activeOmniTabId === id) {
      const idx = omniTabs.findIndex(t => t.id === id);
      if (remaining.length === 0) {
        nextActiveId = null;
      } else if (idx > 0) {
        nextActiveId = remaining[idx - 1].id;
      } else {
        nextActiveId = remaining[0].id;
      }
    }

    set({ omniTabs: remaining, activeOmniTabId: nextActiveId });
    get().persist();
  },

  moveTab: (fromIdx, toIdx) => {
    const { omniTabs } = get();
    if (
      fromIdx < 0 || fromIdx >= omniTabs.length ||
      toIdx < 0 || toIdx >= omniTabs.length ||
      fromIdx === toIdx
    ) return;

    const updated = [...omniTabs];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    set({ omniTabs: updated });
  },

  updateTabLabel: (id, url, title) => {
    set(s => ({
      omniTabs: s.omniTabs.map(t =>
        t.id === id ? { ...t, url, label: title } : t
      ),
    }));
    get().persist();
  },

  createSpace: (name, agentIds = []) => {
    const space: Space = {
      id: generateId('space'),
      name,
      agentIds,
      peopleIds: [],
      tabIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set(s => ({ spaces: [...s.spaces, space] }));
    get().persist();
    return space;
  },

  deleteSpace: (id) => {
    set(s => ({ spaces: s.spaces.filter(sp => sp.id !== id) }));
    get().persist();
  },

  updateSpace: (id, patch) => {
    set(s => ({
      spaces: s.spaces.map(sp =>
        sp.id === id ? { ...sp, ...patch, updatedAt: Date.now() } : sp
      ),
    }));
    get().persist();
  },

  setActiveSpaceId: (id) => set({ activeSpaceId: id }),

  hydrate: async () => {
    const spaces = await db.get('spaceStoreSpaces', null);
    const omniTabs = await db.get('spaceStoreOmniTabs', null);
    const activeIds = await db.get('spaceStoreActiveIds', null);

    if (spaces !== null && omniTabs !== null) {
      // Restore from persisted data
      set({
        spaces: spaces as Space[],
        omniTabs: omniTabs as OmniTab[],
        activeOmniTabId: activeIds?.activeOmniTabId ?? null,
        activeSpaceId: activeIds?.activeSpaceId ?? null,
      });
    } else {
      // First run: seed defaults
      set({
        spaces: [{ ...defaultSpace, createdAt: Date.now(), updatedAt: Date.now() }],
        omniTabs: [defaultTab],
        activeOmniTabId: 'tab-space-log-default',
        activeSpaceId: 'space-home',
      });
    }
  },

  persist: async () => {
    const { spaces, omniTabs, activeOmniTabId, activeSpaceId } = get();
    await db.set('spaceStoreSpaces', spaces);
    await db.set('spaceStoreOmniTabs', omniTabs);
    await db.set('spaceStoreActiveIds', { activeOmniTabId, activeSpaceId });
  },
}));
