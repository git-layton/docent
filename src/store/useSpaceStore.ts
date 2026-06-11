import { create } from 'zustand';
import { db } from '../services/database';
import type { OmniTab, Space, SpaceKind } from '../types/omniTab';
import { useChatStore } from './useChatStore';
import { useAgentStore } from './useAgentStore';
import { normalizeChatRecord } from '../services/channels';

const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Bump when the persisted schema changes in a breaking way — forces a clean reseed.
// v3: Spaces are unified containers — each carries `kind` + its own `chatId`.
const STORE_VERSION = '3';

const HOME_CHAT_ID = 'chat-home';

const defaultSpace: Space = {
  id: 'space-home',
  kind: 'space',
  name: 'Home',
  agentIds: ['alexis'],
  peopleIds: [],
  tabIds: ['tab-space-log-default'],
  chatId: HOME_CHAT_ID,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const defaultTab: OmniTab = {
  id: 'tab-space-log-default',
  type: 'space-log',
  label: 'Chat',
  spaceId: 'space-home',
  isPinned: true,
};

// ---------------------------------------------------------------------------
// Cross-store helpers — a container's conversation lives in useChatStore.
// These only call plain setters, so coupling stays shallow.
// ---------------------------------------------------------------------------

/** Ensure a chat record + messages bucket exist for `chatId` (no-op if present). */
function ensureChatThread(
  chatId: string,
  opts: { kind: 'dm' | 'channel'; name: string; primaryAgentId: string; agentIds: string[] },
) {
  const cs = useChatStore.getState();
  if (cs.chats.some((c: any) => c.id === chatId)) return;
  const rec = normalizeChatRecord(
    {
      id: chatId,
      folderId: opts.primaryAgentId,
      primaryAgentId: opts.primaryAgentId,
      participantAgentIds: opts.agentIds,
      kind: opts.kind,
      name: opts.name,
      goal: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    opts.primaryAgentId,
  );
  cs.setChats((prev: any[]) => [rec, ...prev]);
  cs.setMessages((prev: Record<string, any[]>) => ({ ...prev, [chatId]: prev[chatId] ?? [] }));
}

/** Find an existing DM chat for an agent (preserves history across the migration). */
function findExistingDmChatId(agentId: string): string | null {
  const { chats } = useChatStore.getState();
  const dm = chats.find(
    (c: any) => c.kind === 'dm' && (c.primaryAgentId === agentId || c.folderId === agentId),
  );
  return dm?.id ?? null;
}

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
  createSpace(name: string, agentIds?: string[], kind?: SpaceKind): Space;
  openAgentDm(agent: { id: string; name?: string }): string;
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
    const spaceId = tab.spaceId ?? activeSpaceId ?? undefined;
    const newTab: OmniTab = { ...tab, id, spaceId };
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
      const spaceRemaining = remaining.filter(t => t.spaceId === (tab.spaceId ?? activeSpaceId));
      const allIdx = omniTabs.findIndex(t => t.id === id);
      if (spaceRemaining.length > 0) {
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

  createSpace: (name, agentIds = [], kind = 'space') => {
    const spaceId = generateId('space');
    const tabId = generateId('tab');
    const chatId = generateId('chat');
    const primaryAgentId = agentIds[0] ?? 'alexis';
    const participants = agentIds.length > 0 ? agentIds : [primaryAgentId];

    // Each container owns its own conversation thread.
    ensureChatThread(chatId, {
      kind: kind === 'dm' ? 'dm' : 'channel',
      name,
      primaryAgentId,
      agentIds: participants,
    });

    const chatTab: OmniTab = {
      id: tabId,
      type: 'space-log',
      label: 'Chat',
      spaceId,
      isPinned: true,
    };
    const space: Space = {
      id: spaceId,
      kind,
      name,
      agentIds,
      peopleIds: [],
      tabIds: [tabId],
      chatId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set(s => ({ spaces: [...s.spaces, space], omniTabs: [...s.omniTabs, chatTab] }));
    get().persist();
    return space;
  },

  openAgentDm: (agent) => {
    const containerId = `dm-${agent.id}`;
    const existing = get().spaces.find(s => s.id === containerId);
    if (!existing) {
      // Reuse an existing DM chat (preserves history) or start a fresh one.
      const chatId = findExistingDmChatId(agent.id) ?? generateId('chat');
      ensureChatThread(chatId, {
        kind: 'dm',
        name: agent.name ?? 'Agent',
        primaryAgentId: agent.id,
        agentIds: [agent.id],
      });
      const tabId = `tab-${containerId}`;
      const chatTab: OmniTab = {
        id: tabId,
        type: 'space-log',
        label: 'Chat',
        spaceId: containerId,
        isPinned: true,
      };
      const dm: Space = {
        id: containerId,
        kind: 'dm',
        name: agent.name ?? 'Agent',
        agentIds: [agent.id],
        peopleIds: [],
        tabIds: [tabId],
        chatId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      set(s => ({ spaces: [...s.spaces, dm], omniTabs: [...s.omniTabs, chatTab] }));
    }
    get().setActiveSpaceId(containerId);
    return containerId;
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
    const { omniTabs, spaces } = get();
    const space = spaces.find(s => s.id === id);
    const spaceTabs = omniTabs.filter(t => t.spaceId === id);
    const pinned = spaceTabs.find(t => t.isPinned);
    const first = spaceTabs[0];
    set({ activeSpaceId: id, activeOmniTabId: (pinned ?? first)?.id ?? null });

    // Drive the global conversation + active agent to THIS container's thread.
    if (space) {
      useChatStore.getState().setActiveChatId(space.chatId);
      const primary = space.agentIds[0];
      if (primary) useAgentStore.getState().setActiveFolderId(primary);
    }
    get().persist();
  },

  hydrate: async () => {
    const version = await db.get('spaceStoreVersion', null);
    const spaces = await db.get('spaceStoreSpaces', null);
    const omniTabs = await db.get('spaceStoreOmniTabs', null);
    const activeIds = await db.get('spaceStoreActiveIds', null);

    const isCompatible = version === STORE_VERSION && spaces !== null && omniTabs !== null;

    if (isCompatible) {
      set({
        spaces: spaces as Space[],
        omniTabs: omniTabs as OmniTab[],
        activeOmniTabId: activeIds?.activeOmniTabId ?? null,
        activeSpaceId: activeIds?.activeSpaceId ?? null,
      });
    } else {
      // First run or stale schema (pre-v3 had no kind/chatId) — reseed cleanly.
      if (version !== null) {
        console.info(`[SpaceStore] schema v${version} → v${STORE_VERSION}, reseeding`);
      }
      set({
        spaces: [{ ...defaultSpace, createdAt: Date.now(), updatedAt: Date.now() }],
        omniTabs: [defaultTab],
        activeOmniTabId: 'tab-space-log-default',
        activeSpaceId: 'space-home',
      });
      const { spaces: s, omniTabs: t, activeOmniTabId, activeSpaceId } = get();
      await db.set('spaceStoreVersion', STORE_VERSION);
      await db.set('spaceStoreSpaces', s);
      await db.set('spaceStoreOmniTabs', t);
      await db.set('spaceStoreActiveIds', { activeOmniTabId, activeSpaceId });
    }

    // Reconcile the active conversation with the active container's own thread,
    // so the chat panel never shows a leftover DM when a Space is active.
    const active = get().spaces.find(s => s.id === get().activeSpaceId);
    if (active) {
      ensureChatThread(active.chatId, {
        kind: active.kind === 'dm' ? 'dm' : 'channel',
        name: active.name,
        primaryAgentId: active.agentIds[0] ?? 'alexis',
        agentIds: active.agentIds.length > 0 ? active.agentIds : ['alexis'],
      });
      useChatStore.getState().setActiveChatId(active.chatId);
      const primary = active.agentIds[0];
      if (primary) useAgentStore.getState().setActiveFolderId(primary);
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
