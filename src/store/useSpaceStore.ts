import { create } from 'zustand';
import { db } from '../services/database';
import type { OmniTab, Space } from '../types/omniTab';

const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Bump this when the persisted schema changes in a breaking way — forces a clean reseed
const STORE_VERSION = '2';

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
  toggleFavorite(id: string): void;
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
    const { activeSpaceId, spaces } = get();
    // Auto-assign spaceId from active space if not explicitly set
    const spaceId = tab.spaceId ?? activeSpaceId ?? undefined;
    const newTab: OmniTab = { ...tab, id, spaceId };
    // Also record the new tab id in the owning space's tabIds
    const updatedSpaces = spaceId
      ? spaces.map(s => s.id === spaceId
          ? { ...s, tabIds: [...s.tabIds, id], updatedAt: Date.now() }
          : s)
      : spaces;
    set(s => ({ omniTabs: [...s.omniTabs, newTab], activeOmniTabId: id, spaces: updatedSpaces }));
    get().persist();
    return id;
  },

  closeTab: (id) => {
    const { omniTabs, activeOmniTabId, activeSpaceId } = get();
    const tab = omniTabs.find(t => t.id === id);
    if (!tab || tab.isPinned) return;

    const remaining = omniTabs.filter(t => t.id !== id);
    let nextActiveId = activeOmniTabId;

    if (activeOmniTabId === id) {
      // Prefer to land on another tab in the same space
      const spaceRemaining = remaining.filter(t => t.spaceId === (tab.spaceId ?? activeSpaceId));
      const allIdx = omniTabs.findIndex(t => t.id === id);
      if (spaceRemaining.length > 0) {
        // Pick the closest tab in the space (pinned first, then by position)
        const pinned = spaceRemaining.find(t => t.isPinned);
        nextActiveId = pinned?.id ?? spaceRemaining[Math.max(0, allIdx - 1) % spaceRemaining.length]?.id ?? null;
      } else if (remaining.length > 0) {
        nextActiveId = remaining[Math.max(0, allIdx - 1)]?.id ?? remaining[0].id;
      } else {
        nextActiveId = null;
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

  toggleFavorite: (id) => {
    set(s => ({
      omniTabs: s.omniTabs.map(t =>
        t.id === id ? { ...t, isFavorite: !t.isFavorite } : t
      ),
    }));
    get().persist();
  },

  createSpace: (name, agentIds = []) => {
    const spaceId = generateId('space');
    const tabId = generateId('tab');
    // Every new space gets a pinned chat tab automatically
    const chatTab: OmniTab = {
      id: tabId,
      type: 'space-log',
      label: name,
      spaceId,
      isPinned: true,
    };
    const space: Space = {
      id: spaceId,
      name,
      agentIds,
      peopleIds: [],
      tabIds: [tabId],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set(s => ({ spaces: [...s.spaces, space], omniTabs: [...s.omniTabs, chatTab] }));
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

  setActiveSpaceId: (id) => {
    if (!id) { set({ activeSpaceId: null }); return; }
    const { omniTabs } = get();
    const spaceTabs = omniTabs.filter(t => t.spaceId === id);
    const pinned = spaceTabs.find(t => t.isPinned);
    const first = spaceTabs[0];
    set({ activeSpaceId: id, activeOmniTabId: (pinned ?? first)?.id ?? null });
  },

  hydrate: async () => {
    const version = await db.get('spaceStoreVersion', null);
    const spaces = await db.get('spaceStoreSpaces', null);
    const omniTabs = await db.get('spaceStoreOmniTabs', null);
    const activeIds = await db.get('spaceStoreActiveIds', null);

    const isCompatible = version === STORE_VERSION && spaces !== null && omniTabs !== null;

    if (isCompatible) {
      // Restore from persisted data — tabs already have spaceId from v2+
      set({
        spaces: spaces as Space[],
        omniTabs: omniTabs as OmniTab[],
        activeOmniTabId: activeIds?.activeOmniTabId ?? null,
        activeSpaceId: activeIds?.activeSpaceId ?? null,
      });
    } else {
      // First run OR stale schema (v1 tabs had no spaceId) — reseed cleanly
      if (version !== null) {
        console.info(`[SpaceStore] schema v${version} → v${STORE_VERSION}, reseeding`);
      }
      set({
        spaces: [{ ...defaultSpace, createdAt: Date.now(), updatedAt: Date.now() }],
        omniTabs: [defaultTab],
        activeOmniTabId: 'tab-space-log-default',
        activeSpaceId: 'space-home',
      });
      // Persist new clean state immediately
      const { spaces: s, omniTabs: t, activeOmniTabId, activeSpaceId } = get();
      await db.set('spaceStoreVersion', STORE_VERSION);
      await db.set('spaceStoreSpaces', s);
      await db.set('spaceStoreOmniTabs', t);
      await db.set('spaceStoreActiveIds', { activeOmniTabId, activeSpaceId });
    }
  },

  persist: async () => {
    const { spaces, omniTabs, activeOmniTabId, activeSpaceId } = get();
    await db.set('spaceStoreVersion', STORE_VERSION);
    await db.set('spaceStoreSpaces', spaces);
    await db.set('spaceStoreOmniTabs', omniTabs);
    await db.set('spaceStoreActiveIds', { activeOmniTabId, activeSpaceId });
  },
}));
