import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CmdKPalette } from '../../components/CmdKPalette'
import { useSpaceStore } from '../../store/useSpaceStore'
import { useAgentStore } from '../../store/useAgentStore'

function openPalette() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
  })
}

beforeEach(() => {
  cleanup()
  useSpaceStore.setState({
    spaces: [{ id: 'sp1', kind: 'space', name: 'Q4 Launch', agentIds: [], peopleIds: [], tabIds: [], chatId: 'chat-sp1', createdAt: 0, updatedAt: 0 }],
    omniTabs: [
      { id: 'tab-doc', type: 'doc', label: 'Spec Doc' },
      { id: 'tab-web', type: 'web', label: 'GitHub', url: 'https://github.com' },
    ],
    activeOmniTabId: 'tab-doc',
    activeSpaceId: 'sp1',
  })
  useAgentStore.setState({ assistants: [{ id: 'lexi', name: 'Lexi' }, { id: 'f-default', name: 'Hidden' }] } as any)
  vi.clearAllMocks()
})

describe('CmdKPalette — open/close', () => {
  it('is hidden initially', () => {
    render(<CmdKPalette />)
    expect(screen.queryByPlaceholderText(/search spaces/i)).not.toBeInTheDocument()
  })

  it('opens on ⌘K', () => {
    render(<CmdKPalette />)
    openPalette()
    expect(screen.getByPlaceholderText(/search spaces/i)).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    render(<CmdKPalette />)
    openPalette()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(screen.queryByPlaceholderText(/search spaces/i)).not.toBeInTheDocument()
  })
})

describe('CmdKPalette — results', () => {
  it('lists spaces, tabs, and agents (excluding hidden agents)', () => {
    render(<CmdKPalette />)
    openPalette()
    expect(screen.getByText('Q4 Launch')).toBeInTheDocument()
    expect(screen.getByText('Spec Doc')).toBeInTheDocument()
    expect(screen.getByText('Lexi')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('filters results by query', () => {
    render(<CmdKPalette />)
    openPalette()
    fireEvent.change(screen.getByPlaceholderText(/search spaces/i), { target: { value: 'github' } })
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.queryByText('Q4 Launch')).not.toBeInTheDocument()
  })

  it('Enter on the highlighted result selects it (setActiveSpaceId for the first result)', () => {
    const spy = vi.spyOn(useSpaceStore.getState(), 'setActiveSpaceId')
    render(<CmdKPalette />)
    openPalette()
    const input = screen.getByPlaceholderText(/search spaces/i)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spy).toHaveBeenCalledWith('sp1')
  })

  it('clicking a tab result calls setActiveTab and closes', () => {
    const spy = vi.spyOn(useSpaceStore.getState(), 'setActiveTab')
    render(<CmdKPalette />)
    openPalette()
    fireEvent.click(screen.getByText('GitHub'))
    expect(spy).toHaveBeenCalledWith('tab-web')
    expect(screen.queryByPlaceholderText(/search spaces/i)).not.toBeInTheDocument()
  })
})
