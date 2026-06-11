import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { OmniTabBar } from '../../components/OmniTabBar'
import { useSpaceStore } from '../../store/useSpaceStore'
import type { OmniTab } from '../../types/omniTab'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SPACE_ID = 'space-test'

function makeTab(overrides: Partial<OmniTab>): OmniTab {
  return {
    id: 'tab-test',
    type: 'space-log',
    label: 'Test Tab',
    spaceId: TEST_SPACE_ID,   // tabs must belong to the active space to be visible
    ...overrides,
  }
}

function seedStore(tabs: OmniTab[], activeId: string | null = null) {
  // Ensure all tabs have the test spaceId so OmniTabBar's filter shows them
  const spacedTabs = tabs.map(t => ({ spaceId: TEST_SPACE_ID, ...t }))
  useSpaceStore.setState({
    omniTabs: spacedTabs,
    activeOmniTabId: activeId ?? (spacedTabs[0]?.id ?? null),
    spaces: [{ id: TEST_SPACE_ID, kind: 'space', name: 'Test', agentIds: [], peopleIds: [], tabIds: spacedTabs.map(t => t.id), chatId: 'chat-test', createdAt: 0, updatedAt: 0 }],
    activeSpaceId: TEST_SPACE_ID,
  })
}

beforeEach(() => {
  useSpaceStore.setState({
    omniTabs: [],
    activeOmniTabId: null,
    spaces: [],
    activeSpaceId: null,
  })
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('OmniTabBar — rendering', () => {
  it('renders nothing but the + button when there are no tabs', () => {
    seedStore([])
    render(<OmniTabBar />)
    expect(screen.getByTitle('New tab — Home')).toBeInTheDocument()
  })

  it('renders one pill per tab', () => {
    seedStore([
      makeTab({ id: 'a', label: 'Space Log', type: 'space-log' }),
      makeTab({ id: 'b', label: 'Google', type: 'web', url: 'https://google.com' }),
      makeTab({ id: 'c', label: 'My Doc', type: 'doc' }),
    ], 'a')
    render(<OmniTabBar />)
    expect(screen.getByText('Space Log')).toBeInTheDocument()
    expect(screen.getByText('Google')).toBeInTheDocument()
    expect(screen.getByText('My Doc')).toBeInTheDocument()
  })

  it('active tab gets the bg-[#12141a] class', () => {
    seedStore([
      makeTab({ id: 'a', label: 'Active Tab', type: 'space-log' }),
      makeTab({ id: 'b', label: 'Idle Tab', type: 'doc' }),
    ], 'a')
    render(<OmniTabBar />)
    const activeBtn = screen.getByText('Active Tab').closest('button')!
    const idleBtn   = screen.getByText('Idle Tab').closest('button')!
    expect(activeBtn.className).toContain('bg-[#12141a]')
    expect(idleBtn.className).not.toContain('bg-[#12141a]')
  })

  it('inactive tab gets the hover text class, not active bg', () => {
    seedStore([
      makeTab({ id: 'a', label: 'Home', type: 'space-log' }),
      makeTab({ id: 'b', label: 'Other', type: 'doc' }),
    ], 'a')
    render(<OmniTabBar />)
    const idle = screen.getByText('Other').closest('button')!
    expect(idle.className).toContain('hover:text-[rgba(255,255,255,0.7)]')
  })
})

// ---------------------------------------------------------------------------
// Tab interactions
// ---------------------------------------------------------------------------

describe('OmniTabBar — tab interactions', () => {
  it('clicking an inactive tab calls setActiveTab with its id', () => {
    seedStore([
      makeTab({ id: 'tab-a', label: 'First', type: 'space-log' }),
      makeTab({ id: 'tab-b', label: 'Second', type: 'doc' }),
    ], 'tab-a')
    const spy = vi.spyOn(useSpaceStore.getState(), 'setActiveTab')
    render(<OmniTabBar />)
    fireEvent.click(screen.getByText('Second'))
    expect(spy).toHaveBeenCalledWith('tab-b')
  })

  it('clicking the already-active tab still calls setActiveTab', () => {
    seedStore([makeTab({ id: 'tab-x', label: 'Only Tab', type: 'space-log' })], 'tab-x')
    const spy = vi.spyOn(useSpaceStore.getState(), 'setActiveTab')
    render(<OmniTabBar />)
    fireEvent.click(screen.getByText('Only Tab'))
    expect(spy).toHaveBeenCalledWith('tab-x')
  })
})

// ---------------------------------------------------------------------------
// Favorite (star) affordance
// ---------------------------------------------------------------------------

describe('OmniTabBar — favorite star', () => {
  it('renders an "Add to favorites" star on a non-favorited tab', () => {
    seedStore([makeTab({ id: 'a', label: 'Plain', isFavorite: false })], 'a')
    render(<OmniTabBar />)
    expect(screen.getByTitle('Add to favorites')).toBeInTheDocument()
  })

  it('renders "Remove from favorites" on a favorited tab', () => {
    seedStore([makeTab({ id: 'b', label: 'Starred', isFavorite: true })], 'b')
    render(<OmniTabBar />)
    expect(screen.getByTitle('Remove from favorites')).toBeInTheDocument()
  })

  it('clicking the star calls toggleFavorite with the tab id', () => {
    seedStore([makeTab({ id: 'star-me', label: 'Star Me' })], 'star-me')
    const spy = vi.spyOn(useSpaceStore.getState(), 'toggleFavorite')
    render(<OmniTabBar />)
    fireEvent.click(screen.getByTitle('Add to favorites'))
    expect(spy).toHaveBeenCalledWith('star-me')
  })

  it('star click does not propagate to setActiveTab', () => {
    seedStore([
      makeTab({ id: 'one', label: 'One' }),
      makeTab({ id: 'two', label: 'Two' }),
    ], 'one')
    const setActive = vi.spyOn(useSpaceStore.getState(), 'setActiveTab')
    render(<OmniTabBar />)
    fireEvent.click(screen.getAllByTitle('Add to favorites')[0])
    expect(setActive).not.toHaveBeenCalled()
  })

  it('pinned tabs still show a star (favorites are independent of pinning)', () => {
    seedStore([makeTab({ id: 'p', label: 'Pinned', isPinned: true })], 'p')
    render(<OmniTabBar />)
    expect(screen.getByTitle('Add to favorites')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Pinned vs closeable tabs
// ---------------------------------------------------------------------------

describe('OmniTabBar — pinned tab protection', () => {
  it('pinned tab has no close button', () => {
    seedStore([makeTab({ id: 'pinned', label: 'Pinned', isPinned: true })], 'pinned')
    render(<OmniTabBar />)
    expect(screen.queryByTitle('Close tab')).not.toBeInTheDocument()
  })

  it('non-pinned tab renders a close button', () => {
    seedStore([makeTab({ id: 'free', label: 'Closeable', isPinned: false })], 'free')
    render(<OmniTabBar />)
    expect(screen.getByTitle('Close tab')).toBeInTheDocument()
  })

  it('multiple tabs: only non-pinned ones show close buttons', () => {
    seedStore([
      makeTab({ id: 'p', label: 'Pinned',    isPinned: true }),
      makeTab({ id: 'a', label: 'Free A',    isPinned: false }),
      makeTab({ id: 'b', label: 'Free B',    isPinned: false }),
    ], 'p')
    render(<OmniTabBar />)
    expect(screen.getAllByTitle('Close tab')).toHaveLength(2)
  })

  it('close button click calls closeTab with the correct id', () => {
    seedStore([makeTab({ id: 'kill-me', label: 'Kill Me', isPinned: false })], 'kill-me')
    const spy = vi.spyOn(useSpaceStore.getState(), 'closeTab')
    render(<OmniTabBar />)
    fireEvent.click(screen.getByTitle('Close tab'))
    expect(spy).toHaveBeenCalledWith('kill-me')
  })

  it('close button click does NOT propagate to setActiveTab', () => {
    seedStore([
      makeTab({ id: 'tab-1', label: 'First', isPinned: false }),
      makeTab({ id: 'tab-2', label: 'Second', isPinned: false }),
    ], 'tab-1')
    const setActive = vi.spyOn(useSpaceStore.getState(), 'setActiveTab')
    render(<OmniTabBar />)
    // Click close on the FIRST tab (which is active)
    const closeBtns = screen.getAllByTitle('Close tab')
    fireEvent.click(closeBtns[0])
    // setActiveTab should NOT have been triggered by the close click
    expect(setActive).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// New tab button — opens the Home start page
// ---------------------------------------------------------------------------

describe('OmniTabBar — new tab button', () => {
  it('+ button is always present', () => {
    seedStore([])
    render(<OmniTabBar />)
    expect(screen.getByTitle('New tab — Home')).toBeInTheDocument()
  })

  it('does not render a tab-type dropdown (the old popover is gone)', () => {
    seedStore([])
    render(<OmniTabBar />)
    fireEvent.click(screen.getByTitle('New tab — Home'))
    expect(screen.queryByText('Web Browser')).not.toBeInTheDocument()
    expect(screen.queryByText('Code Canvas')).not.toBeInTheDocument()
  })

  it('clicking + opens a Home tab when none exists', () => {
    seedStore([])
    const spy = vi.spyOn(useSpaceStore.getState(), 'openTab')
    render(<OmniTabBar />)
    fireEvent.click(screen.getByTitle('New tab — Home'))
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'home' }),
    )
  })

  it('clicking + focuses the existing Home tab instead of opening a duplicate', () => {
    seedStore(
      [
        makeTab({ id: 'home-1', type: 'home', label: 'Home' }),
        makeTab({ id: 'log-1', type: 'space-log', label: 'Chat' }),
      ],
      'log-1',
    )
    const openSpy = vi.spyOn(useSpaceStore.getState(), 'openTab')
    const activeSpy = vi.spyOn(useSpaceStore.getState(), 'setActiveTab')
    render(<OmniTabBar />)
    fireEvent.click(screen.getByTitle('New tab — Home'))
    expect(activeSpy).toHaveBeenCalledWith('home-1')
    expect(openSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Drag-to-reorder
// ---------------------------------------------------------------------------

describe('OmniTabBar — drag-to-reorder', () => {
  it('draggable attribute is true on non-pinned tabs', () => {
    seedStore([makeTab({ id: 'x', label: 'Drag Me', isPinned: false })], 'x')
    render(<OmniTabBar />)
    const btn = screen.getByText('Drag Me').closest('button')!
    expect(btn).toHaveAttribute('draggable', 'true')
  })

  it('draggable attribute is false on pinned tabs', () => {
    seedStore([makeTab({ id: 'p', label: 'Pinned', isPinned: true })], 'p')
    render(<OmniTabBar />)
    const btn = screen.getByText('Pinned').closest('button')!
    expect(btn).toHaveAttribute('draggable', 'false')
  })

  it('drop from index 0 to index 1 calls moveTab(0, 1)', () => {
    seedStore([
      makeTab({ id: 'first',  label: 'First',  isPinned: false }),
      makeTab({ id: 'second', label: 'Second', isPinned: false }),
    ], 'first')
    const spy = vi.spyOn(useSpaceStore.getState(), 'moveTab')
    render(<OmniTabBar />)

    const [firstBtn, secondBtn] = screen.getAllByRole('button').filter(
      b => b.getAttribute('draggable') !== null,
    )

    const dt = { effectAllowed: '', dropEffect: '', getData: () => '0', setData: vi.fn() }
    fireEvent.dragStart(firstBtn, { dataTransfer: dt })
    fireEvent.dragOver(secondBtn, { dataTransfer: { ...dt, dropEffect: '' } })
    fireEvent.drop(secondBtn, { dataTransfer: { ...dt, getData: () => '0' } })

    expect(spy).toHaveBeenCalledWith(0, 1)
  })
})
