import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ChatPanel } from '../../components/ChatPanel'
import { useTaskStore } from '../../store/useTaskStore'
import { useSpaceStore } from '../../store/useSpaceStore'

// ---------------------------------------------------------------------------
// Mock heavy children
// ---------------------------------------------------------------------------
vi.mock('../../components/ChatHeader', () => ({
  ChatHeader: () => <div data-testid="chat-header" />,
}))
vi.mock('../../components/MessageList', () => ({
  MessageList: (props: Record<string, unknown>) => (
    <div data-testid="message-list" data-count={(props.activeMessages as unknown[])?.length ?? 0} />
  ),
}))
vi.mock('../../components/PlannerPanel', () => ({
  PlannerPanel: () => <div data-testid="planner-panel" />,
}))
vi.mock('../../components/ChatInputBar', () => ({
  ChatInputBar: () => <div data-testid="chat-input-bar" />,
}))

const spaceLogProps = {
  activeMessages: [] as any[],
  isGenerating: false,
  activeAssistant: { name: 'Lexi' },
  forgettingIndex: -1,
  onConfirmEdit: vi.fn(),
  onBookmark: vi.fn().mockResolvedValue(undefined),
  onToggleSpeak: vi.fn(),
  onAddTask: vi.fn(),
  messagesEndRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  onRenderMessage: vi.fn().mockReturnValue(null),
  onToast: vi.fn(),
  dropdownRef: { current: null } as React.RefObject<HTMLDivElement | null>,
  llamaPaused: false,
  llamaCoolingDown: false,
  systemPromptLen: 0,
  hasErrorLogs: false,
  errorLogsCount: 0,
  onRunDreamCycle: vi.fn(),
  onDragOver: vi.fn(),
  onDragLeave: vi.fn(),
  onDrop: vi.fn(),
  isDragging: false,
  showAgentIntro: false,
  onDismissAgentIntro: vi.fn(),
}

const chatInputBarProps = {
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

function renderPanel(over: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  return render(
    <ChatPanel
      mode="inline"
      spaceLogProps={spaceLogProps}
      chatInputBarProps={chatInputBarProps}
      onSendPrompt={vi.fn()}
      {...over}
    />
  )
}

beforeEach(() => {
  useTaskStore.setState({ showPlanner: false })
  useSpaceStore.setState({ omniTabs: [], activeOmniTabId: null, spaces: [], activeSpaceId: null })
  vi.clearAllMocks()
})

describe('ChatPanel — core', () => {
  it('always renders ChatHeader + ChatInputBar', () => {
    renderPanel()
    expect(screen.getByTestId('chat-header')).toBeInTheDocument()
    expect(screen.getByTestId('chat-input-bar')).toBeInTheDocument()
  })

  it('inline renders the message list (no separate empty-state hero)', () => {
    renderPanel({ mode: 'inline' })
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('docked renders the message list', () => {
    renderPanel({ mode: 'docked' })
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('showPlanner → PlannerPanel replaces the body', () => {
    useTaskStore.setState({ showPlanner: true })
    renderPanel()
    expect(screen.getByTestId('planner-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('message-list')).not.toBeInTheDocument()
  })
})

describe('ChatPanel — docked rail', () => {
  it('shows a collapse button that calls onCollapse', () => {
    const onCollapse = vi.fn()
    renderPanel({ mode: 'docked', onCollapse })
    fireEvent.click(screen.getByTitle('Collapse chat'))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('docked context pill shows the active web tab hostname', () => {
    useSpaceStore.setState({
      omniTabs: [{ id: 'w1', type: 'web', label: 'Google', url: 'https://google.com', spaceId: 's1' }],
      activeOmniTabId: 'w1',
      spaces: [], activeSpaceId: 's1',
    })
    renderPanel({ mode: 'docked' })
    expect(screen.getByText('google.com')).toBeInTheDocument()
  })

  it('no context pill for tool tabs', () => {
    useSpaceStore.setState({
      omniTabs: [{ id: 't1', type: 'tool', toolId: 'calendar', label: 'Calendar', spaceId: 's1' }],
      activeOmniTabId: 't1',
      spaces: [], activeSpaceId: 's1',
    })
    renderPanel({ mode: 'docked' })
    expect(screen.queryByText('Calendar')).not.toBeInTheDocument()
  })

  it('inline mode renders no collapse button', () => {
    renderPanel({ mode: 'inline', onCollapse: vi.fn() })
    expect(screen.queryByTitle('Collapse chat')).not.toBeInTheDocument()
  })
})
