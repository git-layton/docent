import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CommandNode } from '../../components/CommandNode'
import { useSpaceStore } from '../../store/useSpaceStore'
import type { OmniTab } from '../../types/omniTab'

// ---------------------------------------------------------------------------
// Mock ChatInputBar — avoids pulling in its entire prop chain
// ---------------------------------------------------------------------------
vi.mock('../../components/ChatInputBar', () => ({
  ChatInputBar: (props: Record<string, unknown>) => (
    <div data-testid="chat-input-bar" data-is-generating={String(props.isGenerating)} />
  ),
}))

// ---------------------------------------------------------------------------
// Minimal valid props for CommandNode
// ---------------------------------------------------------------------------
const minimalChatInputBarProps = {
  isGenerating: false,
  isEnhancing: false,
  selectedModel: null,
  modelDropdownRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  onSend: vi.fn(),
  onStop: vi.fn(),
  onChatFileUpload: vi.fn(),
  onEnhancePrompt: vi.fn(),
  fileInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
  activeAssistant: null,
  llamaServerPid: null,
  llamaPaused: false,
  setLlamaPaused: vi.fn(),
  llamaCoolingDown: false,
  isListening: false,
  onToggleListening: vi.fn(),
  onSlashCommand: vi.fn(),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setActiveTab(tab: OmniTab | null) {
  if (tab) {
    useSpaceStore.setState({ omniTabs: [tab], activeOmniTabId: tab.id })
  } else {
    useSpaceStore.setState({ omniTabs: [], activeOmniTabId: null })
  }
}

beforeEach(() => {
  useSpaceStore.setState({ omniTabs: [], activeOmniTabId: null, spaces: [], activeSpaceId: null })
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// ChatInputBar forwarding
// ---------------------------------------------------------------------------

describe('CommandNode — ChatInputBar forwarding', () => {
  it('always renders ChatInputBar', () => {
    setActiveTab(null)
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.getByTestId('chat-input-bar')).toBeInTheDocument()
  })

  it('forwards isGenerating=true to ChatInputBar', () => {
    setActiveTab(null)
    render(<CommandNode chatInputBarProps={{ ...minimalChatInputBarProps, isGenerating: true }} />)
    expect(screen.getByTestId('chat-input-bar')).toHaveAttribute('data-is-generating', 'true')
  })

  it('forwards isGenerating=false to ChatInputBar', () => {
    setActiveTab(null)
    render(<CommandNode chatInputBarProps={{ ...minimalChatInputBarProps, isGenerating: false }} />)
    expect(screen.getByTestId('chat-input-bar')).toHaveAttribute('data-is-generating', 'false')
  })
})

// ---------------------------------------------------------------------------
// Context pill — no pill cases
// ---------------------------------------------------------------------------

describe('CommandNode — context pill hidden cases', () => {
  it('no pill when there is no active tab', () => {
    setActiveTab(null)
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    // Tool tabs have no pill; no tab = no pill
    expect(screen.queryByText(/https?:\/\/|hostname/)).not.toBeInTheDocument()
  })

  it('no pill for tool tabs (knowledge-graph)', () => {
    setActiveTab({ id: 't1', type: 'tool', toolId: 'knowledge-graph', label: 'Knowledge Graph' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.queryByText('Knowledge Graph')).not.toBeInTheDocument()
  })

  it('no pill for tool tabs (planner)', () => {
    setActiveTab({ id: 't2', type: 'tool', toolId: 'planner', label: 'Planner' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.queryByText('Planner')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Context pill — space-log tab
// ---------------------------------------------------------------------------

describe('CommandNode — context pill for space-log', () => {
  it('shows the space-log label text in the pill', () => {
    setActiveTab({ id: 'sl', type: 'space-log', label: 'Lexi' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.getByText('Lexi')).toBeInTheDocument()
  })

  it('space-log pill is inside the container (not standalone)', () => {
    setActiveTab({ id: 'sl', type: 'space-log', label: 'Aria' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    const pill = screen.getByText('Aria').parentElement!
    expect(pill.className).toContain('text-[10px]')
  })
})

// ---------------------------------------------------------------------------
// Context pill — web tab
// ---------------------------------------------------------------------------

describe('CommandNode — context pill for web tabs', () => {
  it('shows the hostname from the URL', () => {
    setActiveTab({ id: 'w1', type: 'web', label: 'Google', url: 'https://google.com/search?q=test' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.getByText('google.com')).toBeInTheDocument()
  })

  it('shows just the URL string for a malformed URL', () => {
    setActiveTab({ id: 'w2', type: 'web', label: 'Bad URL', url: 'not-a-valid-url' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.getByText('not-a-valid-url')).toBeInTheDocument()
  })

  it('shows empty string pill body for a web tab with no URL', () => {
    setActiveTab({ id: 'w3', type: 'web', label: 'Empty', url: '' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    // pill is shown (type is web, not tool), content may be empty — just check no crash
    expect(screen.getByTestId('chat-input-bar')).toBeInTheDocument()
  })

  it('HTTPS URL shows Lock icon (svg present in pill row)', () => {
    setActiveTab({ id: 'w4', type: 'web', label: 'Secure', url: 'https://example.com' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    // pill wraps: icon + hostname text
    const pilledHostname = screen.getByText('example.com')
    // The parent should contain an SVG (the Lock icon)
    expect(pilledHostname.parentElement?.querySelector('svg')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Context pill — doc and code-canvas tabs
// ---------------------------------------------------------------------------

describe('CommandNode — context pill for doc / code-canvas', () => {
  it('shows the doc label text', () => {
    setActiveTab({ id: 'd1', type: 'doc', label: 'Architecture Notes' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.getByText('Architecture Notes')).toBeInTheDocument()
  })

  it('shows the code-canvas label text', () => {
    setActiveTab({ id: 'cc1', type: 'code-canvas', label: 'My Canvas' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    expect(screen.getByText('My Canvas')).toBeInTheDocument()
  })

  it('doc and code-canvas have different icons (both render an svg)', () => {
    setActiveTab({ id: 'd2', type: 'doc', label: 'Doc' })
    const { unmount } = render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    const docPill = screen.getByText('Doc').parentElement!
    expect(docPill.querySelector('svg')).toBeInTheDocument()
    unmount()

    setActiveTab({ id: 'c2', type: 'code-canvas', label: 'Canvas' })
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    const canvasPill = screen.getByText('Canvas').parentElement!
    expect(canvasPill.querySelector('svg')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Positioning / container styles
// ---------------------------------------------------------------------------

describe('CommandNode — container layout', () => {
  it('is absolutely positioned at the bottom-center', () => {
    setActiveTab(null)
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    const wrapper = screen.getByTestId('chat-input-bar').closest(
      '.absolute.bottom-4',
    )
    expect(wrapper).toBeInTheDocument()
  })

  it('has z-index 50 to float above tab content', () => {
    setActiveTab(null)
    render(<CommandNode chatInputBarProps={minimalChatInputBarProps} />)
    const wrapper = screen.getByTestId('chat-input-bar').closest('.z-50')
    expect(wrapper).toBeInTheDocument()
  })
})
