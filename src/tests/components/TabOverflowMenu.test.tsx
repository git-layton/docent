import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TabOverflowMenu } from '../../components/TabOverflowMenu'
import { useSpaceStore } from '../../store/useSpaceStore'
import { useAgentStore } from '../../store/useAgentStore'
import type { OmniTab } from '../../types/omniTab'

const SPACE = 'space-test'

function tab(overrides: Partial<OmniTab> & { id: string }): OmniTab {
  return { type: 'space-log', label: overrides.id, spaceId: SPACE, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TabOverflowMenu — trigger', () => {
  it('shows the hidden count on the trigger', () => {
    render(<TabOverflowMenu tabs={[tab({ id: 'a' }), tab({ id: 'b' }), tab({ id: 'c' })]} />)
    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('panel is closed until the trigger is clicked', () => {
    render(<TabOverflowMenu tabs={[tab({ id: 'a', label: 'Hidden A' })]} />)
    expect(screen.queryByPlaceholderText('Search tabs…')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('+1'))
    expect(screen.getByPlaceholderText('Search tabs…')).toBeInTheDocument()
    expect(screen.getByText('Hidden A')).toBeInTheDocument()
  })
})

describe('TabOverflowMenu — search', () => {
  it('filters the list live by label as you type', () => {
    render(<TabOverflowMenu tabs={[
      tab({ id: 'a', label: 'GitHub' }),
      tab({ id: 'b', label: 'Notes' }),
    ]} />)
    fireEvent.click(screen.getByText('+2'))
    const input = screen.getByPlaceholderText('Search tabs…')
    fireEvent.change(input, { target: { value: 'note' } })
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matches', () => {
    render(<TabOverflowMenu tabs={[tab({ id: 'a', label: 'Alpha' })]} />)
    fireEvent.click(screen.getByText('+1'))
    fireEvent.change(screen.getByPlaceholderText('Search tabs…'), { target: { value: 'zzz' } })
    expect(screen.getByText('No matching tabs')).toBeInTheDocument()
  })
})

describe('TabOverflowMenu — activation', () => {
  it('clicking a row activates the tab and closes the panel', () => {
    const spy = vi.spyOn(useSpaceStore.getState(), 'setActiveTab')
    render(<TabOverflowMenu tabs={[tab({ id: 'pick-me', label: 'Pick Me' })]} />)
    fireEvent.click(screen.getByText('+1'))
    fireEvent.click(screen.getByText('Pick Me'))
    expect(spy).toHaveBeenCalledWith('pick-me')
    expect(screen.queryByPlaceholderText('Search tabs…')).not.toBeInTheDocument()
  })
})

describe('TabOverflowMenu — close behavior', () => {
  it('closes on Escape', () => {
    render(<TabOverflowMenu tabs={[tab({ id: 'a' })]} />)
    fireEvent.click(screen.getByText('+1'))
    expect(screen.getByPlaceholderText('Search tabs…')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Search tabs…')).not.toBeInTheDocument()
  })

  it('closes on outside mousedown', () => {
    render(<div><TabOverflowMenu tabs={[tab({ id: 'a' })]} /><button>outside</button></div>)
    fireEvent.click(screen.getByText('+1'))
    expect(screen.getByPlaceholderText('Search tabs…')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByPlaceholderText('Search tabs…')).not.toBeInTheDocument()
  })
})

describe('TabOverflowMenu — agent grouping', () => {
  beforeEach(() => {
    useAgentStore.setState({
      assistants: [{ id: 'agent-1', name: 'Aria', avatar: { type: 'color', color: 'violet' } }],
    } as any)
  })

  it('groups agent-opened tabs under the agent name; ungrouped render too', () => {
    render(<TabOverflowMenu tabs={[
      tab({ id: 'u', label: 'Manual Tab' }),
      tab({ id: 'g', label: 'Agent Tab', openedByAgentId: 'agent-1' }),
    ]} />)
    fireEvent.click(screen.getByText('+2'))
    // Agent header label resolved from the store
    expect(screen.getByText('Aria')).toBeInTheDocument()
    expect(screen.getByText('Manual Tab')).toBeInTheDocument()
    expect(screen.getByText('Agent Tab')).toBeInTheDocument()
  })

  it('renders a flat list (no agent header) when no tabs are agent-opened', () => {
    render(<TabOverflowMenu tabs={[tab({ id: 'a', label: 'Flat A' }), tab({ id: 'b', label: 'Flat B' })]} />)
    fireEvent.click(screen.getByText('+2'))
    expect(screen.queryByText('Aria')).not.toBeInTheDocument()
    expect(screen.getByText('Flat A')).toBeInTheDocument()
    expect(screen.getByText('Flat B')).toBeInTheDocument()
  })

  it('falls back to "Agent" when the id does not resolve', () => {
    render(<TabOverflowMenu tabs={[tab({ id: 'g', label: 'Orphan', openedByAgentId: 'missing' })]} />)
    fireEvent.click(screen.getByText('+1'))
    const panel = screen.getByText('Orphan').closest('div')!
    expect(within(panel.parentElement as HTMLElement).getByText('Agent')).toBeInTheDocument()
  })
})
