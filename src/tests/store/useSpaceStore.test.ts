import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSpaceStore } from '../../store/useSpaceStore'
import type { OmniTab, Space } from '../../types/omniTab'

// ---------------------------------------------------------------------------
// Mock the database service so tests never touch Tauri/localStorage directly
// ---------------------------------------------------------------------------

vi.mock('../../services/database', () => {
  const store: Record<string, unknown> = {}
  return {
    db: {
      get: vi.fn(async (key: string, defaultVal: unknown) =>
        key in store ? store[key] : defaultVal
      ),
      set: vi.fn(async (key: string, val: unknown) => {
        store[key] = val
      }),
    },
  }
})

// Import the mocked db after vi.mock is hoisted
import { db } from '../../services/database'
import { useChatStore } from '../../store/useChatStore'
import { useAgentStore } from '../../store/useAgentStore'

// ---------------------------------------------------------------------------
// Helper: reset store to blank state before each test
// ---------------------------------------------------------------------------

function resetStore() {
  useSpaceStore.setState({
    spaces: [],
    activeSpaceId: null,
    omniTabs: [],
    activeOmniTabId: null,
  })
}

// ---------------------------------------------------------------------------
// openTab
// ---------------------------------------------------------------------------

describe('openTab', () => {
  beforeEach(resetStore)

  it('appends a new tab to omniTabs', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'Google', url: 'https://google.com' })
    expect(useSpaceStore.getState().omniTabs).toHaveLength(1)
  })

  it('returns the generated tab id', () => {
    const id = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab', url: 'https://example.com' })
    expect(typeof id).toBe('string')
    expect(id).toMatch(/^tab-/)
  })

  it('sets the returned id as activeOmniTabId', () => {
    const id = useSpaceStore.getState().openTab({ type: 'doc', label: 'Doc' })
    expect(useSpaceStore.getState().activeOmniTabId).toBe(id)
  })

  it('generated id has format tab-timestamp-random (3 parts)', () => {
    const id = useSpaceStore.getState().openTab({ type: 'tool', label: 'Planner', toolId: 'planner' })
    const parts = id.split('-')
    expect(parts[0]).toBe('tab')
    expect(parts[1]).toMatch(/^\d+$/)
    expect(parts[2]).toMatch(/^[a-z0-9]+$/)
  })

  it('accumulates multiple tabs', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 1' })
    useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 2' })
    useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 3' })
    expect(useSpaceStore.getState().omniTabs).toHaveLength(3)
  })

  it('stores all provided fields on the tab', () => {
    useSpaceStore.getState().openTab({
      type: 'web',
      label: 'Example',
      url: 'https://example.com',
      spaceId: 'space-home',
    })
    const tab = useSpaceStore.getState().omniTabs[0]
    expect(tab.type).toBe('web')
    expect(tab.label).toBe('Example')
    expect(tab.url).toBe('https://example.com')
    expect(tab.spaceId).toBe('space-home')
  })

  it('opening a second tab makes the second tab active', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'First' })
    const id2 = useSpaceStore.getState().openTab({ type: 'web', label: 'Second' })
    expect(useSpaceStore.getState().activeOmniTabId).toBe(id2)
  })
})

// ---------------------------------------------------------------------------
// closeTab
// ---------------------------------------------------------------------------

describe('closeTab', () => {
  beforeEach(resetStore)

  it('removes the tab from omniTabs (leaving only the ensured Home landing tab)', () => {
    const id = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab' })
    useSpaceStore.getState().closeTab(id)
    const tabs = useSpaceStore.getState().omniTabs
    expect(tabs.find(t => t.id === id)).toBeUndefined()
    // Closing the last tab must never leave an empty strip — a Start tab backstops it. Start is an
    // ordinary unpinned tab now (it is just what a new tab renders), not a permanent fixture.
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('home')
    expect(tabs[0].isPinned).toBe(false)
  })

  it('closes a pinned tab — pinning is a layout preference, not a lock', () => {
    useSpaceStore.setState({
      omniTabs: [{ id: 'tab-pinned', type: 'doc', label: 'Doc', isPinned: true }],
      activeOmniTabId: 'tab-pinned',
    })
    useSpaceStore.getState().closeTab('tab-pinned')
    const tabs = useSpaceStore.getState().omniTabs
    expect(tabs.find(t => t.id === 'tab-pinned')).toBeUndefined()
    // ...and the strip still backfills rather than going empty.
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('home')
  })

  it('setTabPinned toggles a tab between pinned and unpinned', () => {
    const id = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab' })
    useSpaceStore.getState().setTabPinned(id, true)
    expect(useSpaceStore.getState().omniTabs.find(t => t.id === id)?.isPinned).toBe(true)
    useSpaceStore.getState().setTabPinned(id, false)
    expect(useSpaceStore.getState().omniTabs.find(t => t.id === id)?.isPinned).toBe(false)
  })

  it('does nothing when closing a non-existent id', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'Tab' })
    expect(() => useSpaceStore.getState().closeTab('ghost-tab-id')).not.toThrow()
    expect(useSpaceStore.getState().omniTabs).toHaveLength(1)
  })

  it('lands on the permanent Home tab when the last tab is closed', () => {
    const id = useSpaceStore.getState().openTab({ type: 'web', label: 'Only Tab' })
    useSpaceStore.getState().closeTab(id)
    const { activeOmniTabId, omniTabs } = useSpaceStore.getState()
    expect(activeOmniTabId).not.toBeNull()
    expect(omniTabs.find(t => t.id === activeOmniTabId)?.type).toBe('home')
  })

  it('activates the previous tab when the active tab is closed', () => {
    const id1 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 1' })
    const id2 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 2' })
    // id2 is active; closing it should move active to id1
    useSpaceStore.getState().closeTab(id2)
    expect(useSpaceStore.getState().activeOmniTabId).toBe(id1)
  })

  it('activates first remaining tab when closing the active first tab', () => {
    const id1 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 1' })
    const id2 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 2' })
    // Manually make id1 active
    useSpaceStore.setState({ activeOmniTabId: id1 })
    useSpaceStore.getState().closeTab(id1)
    expect(useSpaceStore.getState().activeOmniTabId).toBe(id2)
  })

  it('does not change activeOmniTabId when a non-active tab is closed', () => {
    const id1 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 1' })
    const id2 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 2' })
    // id2 is active; close id1 (non-active)
    useSpaceStore.getState().closeTab(id1)
    expect(useSpaceStore.getState().activeOmniTabId).toBe(id2)
  })
})

// ---------------------------------------------------------------------------
// setActiveTab
// ---------------------------------------------------------------------------

describe('setActiveTab', () => {
  beforeEach(resetStore)

  it('sets activeOmniTabId to the given id', () => {
    const id1 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 1' })
    const id2 = useSpaceStore.getState().openTab({ type: 'web', label: 'Tab 2' })
    useSpaceStore.getState().setActiveTab(id1)
    expect(useSpaceStore.getState().activeOmniTabId).toBe(id1)
    useSpaceStore.getState().setActiveTab(id2)
    expect(useSpaceStore.getState().activeOmniTabId).toBe(id2)
  })
})

// ---------------------------------------------------------------------------
// moveTab
// ---------------------------------------------------------------------------

describe('moveTab', () => {
  beforeEach(resetStore)

  it('moves a tab from one index to another', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'A' })
    useSpaceStore.getState().openTab({ type: 'web', label: 'B' })
    useSpaceStore.getState().openTab({ type: 'web', label: 'C' })
    // Move index 0 (A) to index 2 → order becomes B, C, A
    useSpaceStore.getState().moveTab(0, 2)
    const labels = useSpaceStore.getState().omniTabs.map(t => t.label)
    expect(labels).toEqual(['B', 'C', 'A'])
  })

  it('does nothing when fromIdx equals toIdx', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'A' })
    useSpaceStore.getState().openTab({ type: 'web', label: 'B' })
    const before = useSpaceStore.getState().omniTabs.map(t => t.label)
    useSpaceStore.getState().moveTab(1, 1)
    const after = useSpaceStore.getState().omniTabs.map(t => t.label)
    expect(after).toEqual(before)
  })

  it('does nothing when fromIdx is out of bounds', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'A' })
    const before = useSpaceStore.getState().omniTabs.map(t => t.label)
    useSpaceStore.getState().moveTab(5, 0)
    expect(useSpaceStore.getState().omniTabs.map(t => t.label)).toEqual(before)
  })

  it('does nothing when toIdx is out of bounds', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'A' })
    const before = useSpaceStore.getState().omniTabs.map(t => t.label)
    useSpaceStore.getState().moveTab(0, 99)
    expect(useSpaceStore.getState().omniTabs.map(t => t.label)).toEqual(before)
  })

  it('can move a tab from last to first position', () => {
    useSpaceStore.getState().openTab({ type: 'web', label: 'X' })
    useSpaceStore.getState().openTab({ type: 'web', label: 'Y' })
    useSpaceStore.getState().openTab({ type: 'web', label: 'Z' })
    useSpaceStore.getState().moveTab(2, 0)
    const labels = useSpaceStore.getState().omniTabs.map(t => t.label)
    expect(labels).toEqual(['Z', 'X', 'Y'])
  })
})

// ---------------------------------------------------------------------------
// toggleFavorite
// ---------------------------------------------------------------------------

describe('toggleFavorite', () => {
  beforeEach(resetStore)

  it('marks an unfavorited tab as favorite', () => {
    useSpaceStore.setState({
      omniTabs: [{ id: 'fav-a', type: 'web', label: 'A', url: 'https://a.com' }],
    })
    useSpaceStore.getState().toggleFavorite('fav-a')
    expect(useSpaceStore.getState().omniTabs[0].isFavorite).toBe(true)
  })

  it('unfavorites a favorited tab (toggles off)', () => {
    useSpaceStore.setState({
      omniTabs: [{ id: 'fav-b', type: 'doc', label: 'B', isFavorite: true }],
    })
    useSpaceStore.getState().toggleFavorite('fav-b')
    expect(useSpaceStore.getState().omniTabs[0].isFavorite).toBe(false)
  })

  it('only affects the targeted tab', () => {
    useSpaceStore.setState({
      omniTabs: [
        { id: 'x', type: 'web', label: 'X' },
        { id: 'y', type: 'web', label: 'Y' },
      ],
    })
    useSpaceStore.getState().toggleFavorite('y')
    const tabs = useSpaceStore.getState().omniTabs
    expect(tabs.find(t => t.id === 'x')?.isFavorite).toBeFalsy()
    expect(tabs.find(t => t.id === 'y')?.isFavorite).toBe(true)
  })

  it('persists after toggling', async () => {
    useSpaceStore.setState({ omniTabs: [{ id: 'p', type: 'web', label: 'P' }] })
    useSpaceStore.getState().toggleFavorite('p')
    await useSpaceStore.getState().persist()
    expect(vi.mocked(db.set).mock.calls.some(c => c[0] === 'spaceStoreOmniTabs')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// createSpace
// ---------------------------------------------------------------------------

describe('createSpace', () => {
  beforeEach(resetStore)

  it('appends a new space to spaces', () => {
    useSpaceStore.getState().createSpace('Work')
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
  })

  it('returns the created space', () => {
    const space = useSpaceStore.getState().createSpace('Research')
    expect(space.name).toBe('Research')
    expect(space.id).toMatch(/^space-/)
  })

  it('id starts with "space-" prefix', () => {
    const space = useSpaceStore.getState().createSpace('Dev')
    expect(space.id).toMatch(/^space-/)
  })

  it('stores provided agentIds', () => {
    const space = useSpaceStore.getState().createSpace('Team', ['agent-1', 'agent-2'])
    expect(space.agentIds).toEqual(['agent-1', 'agent-2'])
  })

  it('defaults to empty agentIds when not provided', () => {
    const space = useSpaceStore.getState().createSpace('Empty')
    expect(space.agentIds).toEqual([])
  })

  it('initialises peopleIds as empty array and auto-creates a chat tab', () => {
    const space = useSpaceStore.getState().createSpace('Fresh')
    expect(space.peopleIds).toEqual([])
    // createSpace seeds one space-log (Chat) tab automatically — a normal, closable tab.
    expect(space.tabIds).toHaveLength(1)
    const tab = useSpaceStore.getState().omniTabs.find(t => t.id === space.tabIds[0])
    expect(tab?.type).toBe('space-log')
    expect(tab?.isPinned).toBeFalsy()
    expect(tab?.spaceId).toBe(space.id)
  })

  it('createdAt and updatedAt are numeric timestamps', () => {
    const before = Date.now()
    const space = useSpaceStore.getState().createSpace('Timed')
    const after = Date.now()
    expect(space.createdAt).toBeGreaterThanOrEqual(before)
    expect(space.createdAt).toBeLessThanOrEqual(after)
    expect(space.updatedAt).toBeGreaterThanOrEqual(before)
    expect(space.updatedAt).toBeLessThanOrEqual(after)
  })

  it('accumulates multiple spaces', () => {
    useSpaceStore.getState().createSpace('Alpha')
    useSpaceStore.getState().createSpace('Beta')
    expect(useSpaceStore.getState().spaces).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// hydrate — seeding on first run
// ---------------------------------------------------------------------------

describe('hydrate — first-run seeding', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(db.get).mockResolvedValue(null)
  })

  it('seeds a default Home space when no data is stored', async () => {
    await useSpaceStore.getState().hydrate()
    const { spaces } = useSpaceStore.getState()
    expect(spaces).toHaveLength(1)
    expect(spaces[0].name).toBe('Personal')
    expect(spaces[0].id).toBe('space-home')
  })

  it('seeds a default Space Log tab when no data is stored', async () => {
    await useSpaceStore.getState().hydrate()
    const { omniTabs } = useSpaceStore.getState()
    const log = omniTabs.find(t => t.type === 'space-log')
    expect(log?.id).toBe('tab-space-log-default')
    expect(log?.isPinned).toBeFalsy()
    // hydrate keeps a Home (StartPage) tab available alongside the chat.
    expect(omniTabs.some(t => t.type === 'home')).toBe(true)
  })

  it('lands on the Home screen (home tab) on first run', async () => {
    await useSpaceStore.getState().hydrate()
    const { omniTabs, activeOmniTabId } = useSpaceStore.getState()
    expect(omniTabs.find(t => t.id === activeOmniTabId)?.type).toBe('home')
  })

  it('sets activeSpaceId to space-home on first run', async () => {
    await useSpaceStore.getState().hydrate()
    expect(useSpaceStore.getState().activeSpaceId).toBe('space-home')
  })
})

// ---------------------------------------------------------------------------
// hydrate — restoring from DB
// ---------------------------------------------------------------------------

describe('hydrate — restore from DB', () => {
  beforeEach(resetStore)

  it('restores spaces and omniTabs from persisted data', async () => {
    const savedSpaces: Space[] = [
      {
        id: 'space-test',
        kind: 'space',
        name: 'Test Space',
        agentIds: [],
        peopleIds: [],
        tabIds: ['tab-test'],
        chatId: 'chat-test',
        createdAt: 1000,
        updatedAt: 1001,
      },
    ]
    const savedTabs: OmniTab[] = [
      { id: 'tab-test', type: 'web', label: 'Test Tab', url: 'https://test.com' },
    ]
    const savedActiveIds = { activeOmniTabId: 'tab-test', activeSpaceId: 'space-test' }

    vi.mocked(db.get).mockImplementation(async (key: string) => {
      if (key === 'spaceStoreVersion') return '5'
      if (key === 'spaceStoreSpaces') return savedSpaces
      if (key === 'spaceStoreOmniTabs') return savedTabs
      if (key === 'spaceStoreActiveIds') return savedActiveIds
      return null
    })

    await useSpaceStore.getState().hydrate()

    const st = useSpaceStore.getState()
    expect(st.spaces).toHaveLength(1)
    expect(st.spaces[0].name).toBe('Test Space')
    // The persisted tab is restored…
    expect(st.omniTabs.find(t => t.id === 'tab-test')?.label).toBe('Test Tab')
    expect(st.activeSpaceId).toBe('space-test')
    // …and on launch we always land on a Home tab (created here since the Space has none).
    expect(st.omniTabs.some(t => t.type === 'home')).toBe(true)
    expect(st.omniTabs.find(t => t.id === st.activeOmniTabId)?.type).toBe('home')
  })

  it('does not seed defaults when persisted data exists', async () => {
    const savedSpaces: Space[] = [
      { id: 'space-a', kind: 'space', name: 'A', agentIds: [], peopleIds: [], tabIds: [], chatId: 'chat-a', createdAt: 0, updatedAt: 0 },
    ]
    const savedTabs: OmniTab[] = [
      { id: 'tab-a', type: 'doc', label: 'Doc A' },
    ]

    vi.mocked(db.get).mockImplementation(async (key: string) => {
      if (key === 'spaceStoreVersion') return '5'
      if (key === 'spaceStoreSpaces') return savedSpaces
      if (key === 'spaceStoreOmniTabs') return savedTabs
      if (key === 'spaceStoreActiveIds') return { activeOmniTabId: 'tab-a', activeSpaceId: 'space-a' }
      return null
    })

    await useSpaceStore.getState().hydrate()

    // Should have exactly the saved data, not the default Home space too
    expect(useSpaceStore.getState().spaces).toHaveLength(1)
    expect(useSpaceStore.getState().spaces[0].id).toBe('space-a')
  })
})

// ---------------------------------------------------------------------------
// persist
// ---------------------------------------------------------------------------

describe('persist', () => {
  beforeEach(() => {
    resetStore()
    vi.mocked(db.set).mockClear()
  })

  it('calls db.set for spaceStoreSpaces, spaceStoreOmniTabs, and spaceStoreActiveIds', async () => {
    useSpaceStore.getState().createSpace('Persisted')
    await useSpaceStore.getState().persist()

    const setCalls = vi.mocked(db.set).mock.calls.map(c => c[0])
    expect(setCalls).toContain('spaceStoreSpaces')
    expect(setCalls).toContain('spaceStoreOmniTabs')
    expect(setCalls).toContain('spaceStoreActiveIds')
  })

  it('persists current spaces array', async () => {
    const persisted: Record<string, unknown> = {}
    vi.mocked(db.set).mockImplementation(async (key: string, val: unknown) => {
      persisted[key] = val
    })

    useSpaceStore.getState().createSpace('Saved Space')
    await useSpaceStore.getState().persist()

    const storedSpaces = persisted['spaceStoreSpaces'] as Space[]
    expect(storedSpaces).toHaveLength(1)
    expect(storedSpaces[0].name).toBe('Saved Space')
  })

  it('persists activeOmniTabId and activeSpaceId in spaceStoreActiveIds', async () => {
    const persisted: Record<string, unknown> = {}
    vi.mocked(db.set).mockImplementation(async (key: string, val: unknown) => {
      persisted[key] = val
    })

    useSpaceStore.setState({ activeOmniTabId: 'tab-xyz', activeSpaceId: 'space-abc' })
    await useSpaceStore.getState().persist()

    const activeIds = persisted['spaceStoreActiveIds'] as { activeOmniTabId: string; activeSpaceId: string }
    expect(activeIds.activeOmniTabId).toBe('tab-xyz')
    expect(activeIds.activeSpaceId).toBe('space-abc')
  })
})

// ---------------------------------------------------------------------------
// Unified container model — each container (DM or Space) owns its own thread.
// This is the fix for "DMs bleeding into Spaces".
// ---------------------------------------------------------------------------

describe('container model — per-container threads', () => {
  beforeEach(() => {
    resetStore()
    useChatStore.setState({ chats: [], messages: {}, activeChatId: null })
  })

  it('createSpace gives the space its own chatId and a backing chat thread', () => {
    const space = useSpaceStore.getState().createSpace('Project X')
    expect(space.kind).toBe('space')
    expect(space.chatId).toBeTruthy()
    // a chat record + messages bucket now exist for that thread
    expect(useChatStore.getState().chats.some(c => c.id === space.chatId)).toBe(true)
    expect(useChatStore.getState().messages[space.chatId]).toEqual([])
  })

  it('openAgentDm creates a DM container with the stable id dm-<agentId>', () => {
    const id = useSpaceStore.getState().openAgentDm({ id: 'lexi', name: 'Lexi' })
    expect(id).toBe('dm-lexi')
    const dm = useSpaceStore.getState().spaces.find(s => s.id === 'dm-lexi')
    expect(dm?.kind).toBe('dm')
    expect(dm?.agentIds).toEqual(['lexi'])
    expect(dm?.chatId).toBeTruthy()
  })

  it('openAgentDm is idempotent — clicking the same agent twice reuses the container', () => {
    useSpaceStore.getState().openAgentDm({ id: 'aria', name: 'Aria' })
    useSpaceStore.getState().openAgentDm({ id: 'aria', name: 'Aria' })
    const dms = useSpaceStore.getState().spaces.filter(s => s.id === 'dm-aria')
    expect(dms).toHaveLength(1)
  })

  it('openAgentDm with keepTab points the conversation at the DM WITHOUT entering its container', () => {
    // Rail mode: the DM thread + agent go live, but the center tab strip (activeSpaceId /
    // activeOmniTabId) stays wherever the user was — the chat rides in the right-hand rail.
    const space = useSpaceStore.getState().createSpace('Work')
    useSpaceStore.getState().setActiveSpaceId(space.id)
    const tabBefore = useSpaceStore.getState().activeOmniTabId
    useSpaceStore.getState().openAgentDm({ id: 'lexi', name: 'Lexi' }, { keepTab: true })
    const dm = useSpaceStore.getState().spaces.find(s => s.id === 'dm-lexi')!
    expect(useChatStore.getState().activeChatId).toBe(dm.chatId)
    expect(useAgentStore.getState().activeFolderId).toBe('lexi')
    expect(useSpaceStore.getState().activeSpaceId).toBe(space.id)
    expect(useSpaceStore.getState().activeOmniTabId).toBe(tabBefore)
  })

  it('selecting a container drives activeChatId to ITS thread (no bleed)', () => {
    const space = useSpaceStore.getState().createSpace('Work')
    useSpaceStore.getState().openAgentDm({ id: 'dev', name: 'Dev' })
    // Now in the DM — activeChatId is the DM's thread
    const dm = useSpaceStore.getState().spaces.find(s => s.id === 'dm-dev')!
    expect(useChatStore.getState().activeChatId).toBe(dm.chatId)
    // Switch to the Space — activeChatId follows to the Space's own thread
    useSpaceStore.getState().setActiveSpaceId(space.id)
    expect(useChatStore.getState().activeChatId).toBe(space.chatId)
    expect(space.chatId).not.toBe(dm.chatId)
  })

  it('selecting a container sets the active agent to its primary', () => {
    useSpaceStore.getState().createSpace('Team', ['dev', 'aria'])
    const team = useSpaceStore.getState().spaces.find(s => s.name === 'Team')!
    useSpaceStore.getState().setActiveSpaceId(team.id)
    expect(useAgentStore.getState().activeFolderId).toBe('dev')
  })
})
