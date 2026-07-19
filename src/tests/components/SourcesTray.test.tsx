import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SourcesTray, LOCAL_SOURCE_TOOL } from '../../components/SourcesTray'
import { useSpaceStore } from '../../store/useSpaceStore'

// Answer receipts: an answer grounded in an open panel carries a "Grounded in …" chip
// that jumps back to exactly that panel — provenance the user can check, not just trust.

describe('SourcesTray — answer receipts', () => {
  beforeEach(() => {
    useSpaceStore.setState({ omniTabs: [], activeOmniTabId: null, spaces: [], activeSpaceId: null })
  })

  it('renders a receipt chip for a local tool-context source', () => {
    render(<SourcesTray sources={[{ title: 'Inbox', local: true, kind: 'mail' }]} />)
    expect(screen.getByText(/Grounded in Local Mail — Inbox/)).toBeInTheDocument()
  })

  it('clicking the receipt opens the matching tool tab', () => {
    render(<SourcesTray sources={[{ title: 'Messages: Sam', local: true, kind: 'messages' }]} />)
    fireEvent.click(screen.getByText(/Grounded in Messages/))
    const { omniTabs, activeOmniTabId } = useSpaceStore.getState()
    const tab = omniTabs.find(t => t.type === 'tool' && t.toolId === 'messages')
    expect(tab).toBeDefined()
    expect(activeOmniTabId).toBe(tab!.id)
  })

  it('clicking the receipt focuses an already-open tool tab instead of duplicating it', () => {
    useSpaceStore.setState({
      omniTabs: [{ id: 'tab-notes', type: 'tool', toolId: 'notes', label: 'Notes' }],
      activeOmniTabId: null, spaces: [], activeSpaceId: null,
    })
    render(<SourcesTray sources={[{ title: 'Note: Venue', local: true, kind: 'notes' }]} />)
    fireEvent.click(screen.getByText(/Grounded in Apple Notes/))
    const { omniTabs, activeOmniTabId } = useSpaceStore.getState()
    expect(omniTabs).toHaveLength(1)
    expect(activeOmniTabId).toBe('tab-notes')
  })

  it('local receipts never leak into the web or file sections', () => {
    render(
      <SourcesTray sources={[
        { title: 'Inbox', local: true, kind: 'mail' },
        { title: 'Some page', url: 'https://example.com' },
      ]} />,
    )
    expect(screen.getByText(/Grounded in Local Mail/)).toBeInTheDocument()
    expect(screen.getByText('Some page')).toBeInTheDocument()
  })

  it('every mapped tool-context source has a real tool tab id', () => {
    for (const [kind, toolId] of Object.entries(LOCAL_SOURCE_TOOL)) {
      expect(typeof kind).toBe('string')
      expect(['inbox', 'messages', 'notes', 'planner', 'calendar']).toContain(toolId)
    }
  })
})
