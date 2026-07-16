import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { db } from '../services/database';
import type { OmniTab, Space, SpaceKind } from '../types/omniTab';
import { useChatStore } from './useChatStore';
import { useAgentStore, resolveCodeyId, CODEY_ASSISTANT } from './useAgentStore';
import { normalizeChatRecord } from '../services/channels';
import { projectContextPath, AGENTS_TEMPLATE } from '../services/fileAccess/spaces';
import { generateId } from '../lib/id';

// Bump when the persisted schema changes in a breaking way — forces a clean reseed.
// v3: Spaces are unified containers — each carries `kind` + its own `chatId`.
// v4: one-time full reset — also wipes all conversations so DM/Space threads start fully isolated.
// v5: Code is a canvas, not a space — reseed to drop any stale dedicated "Code" space (space-code) +
//     its Team thread left over from the old architecture, so spaces are uniform again.
const STORE_VERSION = '5';

const HOME_CHAT_ID = 'chat-home';

// Codey's coding conversation — a standalone DM with Codey that the code canvas surfaces wherever you
// open it. NOT tied to a space: spaces are uniform (each has its own agent group chat); Codey is ONLY
// the code-canvas copilot. Stable id so the canvas always reuses the one Codey thread. (Replaces the
// old CODE_CHAT_ID / dedicated "Code" space, which incorrectly made Codey a space's chat driver.)
export const CODEY_CHAT_ID = 'chat-codey';

const defaultSpace: Space = {
  id: 'space-home',
  kind: 'space',
  name: 'Personal',
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

interface SpaceStore {
  spaces: Space[];
  activeSpaceId: string | null;
  omniTabs: OmniTab[];
  activeOmniTabId: string | null;
  /** The active space's AGENTS.md contents (project context). Empty until loaded; folded into the
   *  agent's system prompt every turn (P6). Loaded by loadProjectContext on space switch + hydrate. */
  activeProjectContext: string;

  setActiveTab(id: string): void;
  openTab(tab: Omit<OmniTab, 'id'>): string;
  /** Re-point an existing tab to new content in place (same id/position) — used so
   *  opening an app from the Home/new-tab page reuses that tab instead of stacking up. */
  replaceTab(id: string, patch: Partial<Omit<OmniTab, 'id' | 'spaceId'>>): void;
  closeTab(id: string): void;
  moveTab(fromIdx: number, toIdx: number): void;
  updateTabLabel(id: string, url: string, title: string): void;
  toggleFavorite(id: string): void;
  createSpace(name: string, agentIds?: string[], kind?: SpaceKind): Space;
  /** Open (or create) the agent's DM container. `keepTab: true` activates the DM's thread + agent
   *  WITHOUT swapping the center viewport to its Chat tab — used when the chat rides in the
   *  right-hand rail beside whatever the user is already looking at. */
  openAgentDm(agent: { id: string; name?: string }, opts?: { keepTab?: boolean }): string;
  /** Open the code canvas (Codey's coding surface) in the CURRENT space — ensures the built-in Codey
   *  + his standalone conversation exist, then opens/focuses the agentforge-code tool tab in the active
   *  space. Code is a canvas, not a space; the space's own group chat stays the rail beside it.
   *  Returns the tab id. */
  openCodeCanvas(): string;
  deleteSpace(id: string): void;
  updateSpace(id: string, patch: Partial<Space>): void;
  setAgentGoal(spaceId: string, agentId: string, goal: string): void;
  setActiveSpaceId(id: string | null): void;
  /** Read spaces/<id>/AGENTS.md into activeProjectContext, creating it from AGENTS_TEMPLATE if missing
   *  (fs_write auto-creates the dir + git-commits). Fire-and-forget; no-op outside Tauri. */
  loadProjectContext(spaceId: string | null | undefined): Promise<void>;

  hydrate(): Promise<void>;
  persist(): Promise<void>;
}

export const useSpaceStore = create<SpaceStore>((set, get) => ({
  spaces: [],
  activeSpaceId: null,
  omniTabs: [],
  activeOmniTabId: null,
  activeProjectContext: '',

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

  replaceTab: (id, patch) => {
    set(s => ({
      omniTabs: s.omniTabs.map(t =>
        t.id === id
          ? {
              // Preserve identity + placement; swap the content fields wholesale so
              // stale ones (url/toolId/canvasContentId) don't leak across a re-point.
              id: t.id,
              spaceId: t.spaceId,
              isPinned: t.isPinned,
              isFavorite: t.isFavorite,
              type: patch.type ?? t.type,
              label: patch.label ?? t.label,
              url: patch.url,
              toolId: patch.toolId,
              canvasContentId: patch.canvasContentId,
            }
          : t,
      ),
      activeOmniTabId: id,
    }));
    get().persist();
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

  openAgentDm: (agent, opts) => {
    const containerId = `dm-${agent.id}`;
    const existing = get().spaces.find(s => s.id === containerId);
    if (!existing) {
      // Deterministic, container-scoped thread id: a DM is ALWAYS its own isolated
      // conversation, never reused from (or shared with) a Space or any other chat.
      const chatId = `chat-${containerId}`;
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
    if (opts?.keepTab) {
      // Rail mode: drive the global conversation + active agent to the DM's thread WITHOUT
      // entering its container — the tab strip and center viewport stay on the space the user
      // is looking at, and the DM rides in the right-hand rail. (Entering the container would
      // also swap the tab strip, since it's scoped to activeSpaceId.)
      const dm = get().spaces.find(s => s.id === containerId);
      if (dm) {
        useChatStore.getState().setActiveChatId(dm.chatId);
        useAgentStore.getState().setActiveFolderId(agent.id);
      }
      get().persist();
    } else {
      get().setActiveSpaceId(containerId);
    }
    return containerId;
  },

  openCodeCanvas: () => {
    // Code is a CANVAS, not a space. Ensure the built-in Codey exists (reseed if the user deleted it),
    // make sure Codey's standalone conversation exists, then open the code-canvas surface IN THE CURRENT
    // space — so that space's own agent group chat stays the rail beside it. No special space, no Team
    // thread. Codey is only the code copilot; the rail is uniform with every other space.
    const agentStore = useAgentStore.getState();
    const hasCodey = agentStore.assistants.some(
      (a: any) => a.id === 'forge-dev' || a.role === 'Engineer' || a.name === 'Codey',
    );
    if (!hasCodey) {
      agentStore.setAssistants((prev: any[]) => [...prev, CODEY_ASSISTANT]);
      agentStore.persist();
    }
    const codeyId = resolveCodeyId(useAgentStore.getState().assistants) ?? 'forge-dev';
    // Codey's conversation — a DM with just Codey (he naturally drives a one-agent thread). Shared by
    // every code canvas so you keep one continuous Codey thread regardless of which space you opened it in.
    ensureChatThread(CODEY_CHAT_ID, { kind: 'dm', name: 'Codey', primaryAgentId: codeyId, agentIds: [codeyId] });

    // Open (or focus) the code canvas in the CURRENT space — reuse an existing one rather than stacking.
    const spaceId = get().activeSpaceId ?? undefined;
    const existing = get().omniTabs.find(
      t => t.spaceId === spaceId && t.type === 'tool' && t.toolId === 'agentforge-code',
    );
    if (existing) {
      set({ activeOmniTabId: existing.id });
      get().persist();
      return existing.id;
    }
    return get().openTab({ type: 'tool', toolId: 'agentforge-code', label: 'Code', spaceId });
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

  // Per-agent standing goal within a Space (spec §6) — what this agent is driving toward here.
  setAgentGoal: (spaceId, agentId, goal) => {
    set(s => ({
      spaces: s.spaces.map(sp =>
        sp.id === spaceId
          ? { ...sp, agentGoals: { ...(sp.agentGoals ?? {}), [agentId]: goal }, updatedAt: Date.now() }
          : sp,
      ),
    }));
    get().persist();
  },

  setActiveSpaceId: (id) => {
    if (!id) { set({ activeSpaceId: null }); return; }
    const { omniTabs, spaces } = get();
    const space = spaces.find(s => s.id === id);
    const spaceTabs = omniTabs.filter(t => t.spaceId === id);
    // Entering a Space lands on its conversation (the Chat tab) if present, else its first tab.
    const preferred = spaceTabs.find(t => t.type === 'space-log') ?? spaceTabs[0];
    set({ activeSpaceId: id, activeOmniTabId: preferred?.id ?? null });

    // Drive the global conversation + active agent to THIS container's thread.
    if (space) {
      useChatStore.getState().setActiveChatId(space.chatId);
      const primary = space.agentIds[0];
      if (primary) useAgentStore.getState().setActiveFolderId(primary);
    }
    get().persist();

    // Fold this space's AGENTS.md into the agent's context (P6). Fire-and-forget so a slow/failed
    // read never blocks the space switch; the prompt simply omits the block until it loads.
    get().loadProjectContext(id).catch(() => {});
  },

  // Read (or seed) the active space's AGENTS.md into activeProjectContext. Guarded with the same
  // __TAURI_INTERNALS__ check files.ts uses, so it's a no-op in non-Tauri/test environments. On a
  // missing file, write the AGENTS_TEMPLATE (fs_write auto-creates the dir + git-commits) and use it.
  loadProjectContext: async (spaceId) => {
    if (!spaceId) { set({ activeProjectContext: '' }); return; }
    if (!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) return;
    const path = projectContextPath(spaceId);
    try {
      const res = await invoke<{ ok: boolean; content?: string }>('fs_read', { path });
      if (res?.ok) {
        set({ activeProjectContext: res.content ?? '' });
      } else {
        await invoke('fs_write', { path, content: AGENTS_TEMPLATE });
        set({ activeProjectContext: AGENTS_TEMPLATE });
      }
    } catch {
      // Leave whatever's loaded; never throw out of a fire-and-forget caller.
    }
  },

  hydrate: async () => {
    const version = await db.get('spaceStoreVersion', null);
    const spaces = await db.get('spaceStoreSpaces', null);
    const omniTabs = await db.get('spaceStoreOmniTabs', null);
    const activeIds = await db.get('spaceStoreActiveIds', null);

    const isCompatible = version === STORE_VERSION && spaces !== null && omniTabs !== null;

    if (isCompatible) {
      // Chat (space-log) tabs are normal closable tabs now — clear any leftover pin
      // from older persisted state so existing installs pick up the change too.
      const tabs = (omniTabs as OmniTab[]).map(t =>
        t.type === 'space-log' && t.isPinned ? { ...t, isPinned: false } : t,
      );
      set({
        spaces: spaces as Space[],
        omniTabs: tabs,
        activeOmniTabId: activeIds?.activeOmniTabId ?? null,
        activeSpaceId: activeIds?.activeSpaceId ?? null,
      });
    } else {
      // [DATA-WIPE LANDMINE]
      // WARNING: First run or stale schema — reseed cleanly. v4 additionally wipes ALL conversation data
      // (chats + messages) so DM and Space threads start completely isolated (one-time clean reset).
      //
      // ONCE A BUILD WITH THIS SCHEMA HAS SHIPPED TO USERS, DO NOT BUMP THROUGH HERE!
      // If `STORE_VERSION` changes post-release, you MUST write a non-destructive migration runner
      // above this block instead of falling through to this wipe path.
      if (version !== null) {
        console.info(`[SpaceStore] schema v${version} → v${STORE_VERSION}, reseeding + clearing chats`);
      }
      const cs = useChatStore.getState();
      cs.setChats([]);
      cs.setMessages({});
      cs.setActiveChatId(null);
      await db.set('chats', []);
      await db.set('messages', {});
      await db.set('activeChatId', null);
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

    // Land on the HOME screen (the StartPage overview of apps + agents) on launch — not straight into a
    // conversation. Your space's chat is one click away (its Chat tab). Ensure a Home tab exists, then
    // make it active.
    {
      const st = get();
      const sid = st.activeSpaceId ?? 'space-home';
      let home = st.omniTabs.find(t => t.type === 'home' && t.spaceId === sid);
      if (!home) {
        home = { id: generateId('tab'), type: 'home', label: 'Home', spaceId: sid };
        set(s => ({ omniTabs: [...s.omniTabs, home!] }));
      }
      set({ activeOmniTabId: home.id });
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

    // Load the active space's AGENTS.md into context once the active space is settled (P6).
    // Fire-and-forget — hydrate must not block on a workspace read.
    get().loadProjectContext(get().activeSpaceId).catch(() => {});
  },

  persist: async () => {
    const { spaces, omniTabs, activeOmniTabId, activeSpaceId } = get();
    await db.set('spaceStoreVersion', STORE_VERSION);
    await db.set('spaceStoreSpaces', spaces);
    await db.set('spaceStoreOmniTabs', omniTabs);
    await db.set('spaceStoreActiveIds', { activeOmniTabId, activeSpaceId });
  },
}));
