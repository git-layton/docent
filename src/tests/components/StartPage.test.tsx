import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { StartPage } from '../../components/StartPage'
import { useSpaceStore } from '../../store/useSpaceStore'
import { useUIStore } from '../../store/useUIStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useAgentStore } from '../../store/useAgentStore'

// Seed the four stores StartPage reads from, with one Space + its chat tab.
beforeEach(() => {
  useAgentStore.setState({ assistants: [{ id: 'docent', name: 'Docent' }] } as any)
  useSettingsStore.setState({ userName: 'Sam', integrations: {} } as any)
  useUIStore.setState({ savedApps: [] } as any)
  useSpaceStore.setState({
    spaces: [{ id: 'space-home', kind: 'space', name: 'Personal', agentIds: ['docent'], peopleIds: [], tabIds: ['log'], chatId: 'c1', createdAt: 0, updatedAt: 0 }],
    activeSpaceId: 'space-home',
    omniTabs: [{ id: 'log', type: 'space-log', label: 'Chat', spaceId: 'space-home', isPinned: true }],
    activeOmniTabId: 'home',
  } as any)
  vi.clearAllMocks()
})

const typeQuery = (value: string) => {
  const input = screen.getByPlaceholderText(/search apps/i)
  fireEvent.change(input, { target: { value } })
  return input
}

describe('StartPage — launcher', () => {
  it('renders the Chat app and a personalized greeting', () => {
    render(<StartPage />)
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('Web Browser')).toBeInTheDocument()
    expect(screen.getByText(/Sam/)).toBeInTheDocument()
  })
})

describe('StartPage — omni-bar', () => {
  it('typing shows the "Ask <agent>" row and live-filters apps', () => {
    render(<StartPage onAsk={vi.fn()} />)
    typeQuery('brow')
    expect(screen.getByText('Ask Docent')).toBeInTheDocument()
    // The section grid is hidden while searching, so "Web Browser" appears once (the result row).
    expect(screen.getByText('Web Browser')).toBeInTheDocument()
    expect(screen.queryByText('Calendar')).not.toBeInTheDocument()
  })

  it('Enter on plain text (default selection) asks the agent', () => {
    const onAsk = vi.fn()
    render(<StartPage onAsk={onAsk} />)
    const input = typeQuery('what is on my plate today')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAsk).toHaveBeenCalledWith('what is on my plate today')
  })

  it('ArrowDown then Enter opens the highlighted result instead of asking', () => {
    const onAsk = vi.fn()
    const openSpy = vi.spyOn(useSpaceStore.getState(), 'openTab')
    render(<StartPage onAsk={onAsk} />)
    const input = typeQuery('brow')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // move off the Ask row onto "Web Browser"
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'web' }))
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('Escape clears the query and restores the section grid', () => {
    render(<StartPage onAsk={vi.fn()} />)
    const input = typeQuery('brow')
    // The grid's section headings hide while searching. Target the heading role specifically —
    // the omni-bar's intent chips also carry an "Apps" label, so a plain text query is ambiguous.
    expect(screen.queryByRole('heading', { name: 'Apps' })).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument()
  })
})
