import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from '../../store/useUIStore'

// Default initial state values mirrored from the store definition
const initialState = {
  isSidebarOpen: true,
  isAgentDropdownOpen: false,
  isModelDropdownOpen: false,
  showConsole: false,
  logs: [],
  toastMessage: null,
  toastAction: null,
  input: '',
  attachedDocs: [],
  generationMode: 'text',
  isDeepThinking: false,
  forcedTool: null,
  isPlanMode: false,
  isDragging: false,
  uploadError: '',
  slashHighlight: 0,
  canvasContent: null,
  canvasTab: 'preview',
  viewMode: 'chat',
  archiveSubView: 'code',
  archiveSearchQuery: '',
  savedApps: [],
  showSaveModal: false,
  saveAppData: { title: '' },
  ramStats: null,
  hwProfile: null,
  isDbLoaded: false,
}

beforeEach(() => {
  useUIStore.setState(initialState)
})

// ---------------------------------------------------------------------------
// Log circular buffer
// ---------------------------------------------------------------------------
describe('log circular buffer', () => {
  it('starts with an empty log array', () => {
    const { logs } = useUIStore.getState()
    expect(logs).toHaveLength(0)
  })

  it('accumulates logs up to 500 entries', () => {
    const store = useUIStore.getState()
    for (let i = 0; i < 500; i++) {
      store.addLog('info', `msg-${i}`)
    }
    expect(useUIStore.getState().logs).toHaveLength(500)
  })

  it('caps at 500 entries after 501 pushes', () => {
    const store = useUIStore.getState()
    for (let i = 0; i < 501; i++) {
      store.addLog('info', `msg-${i}`)
    }
    expect(useUIStore.getState().logs).toHaveLength(500)
  })

  it('drops the oldest entry when the buffer overflows', () => {
    const store = useUIStore.getState()
    for (let i = 0; i < 500; i++) {
      store.addLog('info', `msg-${i}`)
    }
    // Push one more to trigger overflow
    store.addLog('info', 'overflow-entry')
    const { logs } = useUIStore.getState()
    // msg-0 (the very first entry) should have been dropped
    expect(logs[0].msg).toBe('msg-1')
    expect(logs[499].msg).toBe('overflow-entry')
  })

  it('clearLogs resets the log array to empty', () => {
    const store = useUIStore.getState()
    store.addLog('info', 'some log')
    store.clearLogs()
    expect(useUIStore.getState().logs).toHaveLength(0)
  })

  it('stores level and msg on each log entry', () => {
    useUIStore.getState().addLog('warn', 'something happened')
    const { logs } = useUIStore.getState()
    expect(logs[0].level).toBe('warn')
    expect(logs[0].msg).toBe('something happened')
  })
})

// ---------------------------------------------------------------------------
// Toast auto-dismiss
// ---------------------------------------------------------------------------
describe('toast auto-dismiss', () => {
  it('sets toastMessage when showToast is called', () => {
    vi.useFakeTimers()
    useUIStore.getState().showToast('Hello world')
    expect(useUIStore.getState().toastMessage).toBe('Hello world')
    vi.useRealTimers()
  })

  it('clears toastMessage to null after 4000ms', () => {
    vi.useFakeTimers()
    useUIStore.getState().showToast('Auto-dismiss me')
    expect(useUIStore.getState().toastMessage).toBe('Auto-dismiss me')
    vi.advanceTimersByTime(4000)
    expect(useUIStore.getState().toastMessage).toBeNull()
    vi.useRealTimers()
  })

  it('does NOT clear toastMessage before 4000ms have elapsed', () => {
    vi.useFakeTimers()
    useUIStore.getState().showToast('Still visible')
    vi.advanceTimersByTime(3999)
    expect(useUIStore.getState().toastMessage).toBe('Still visible')
    vi.useRealTimers()
  })

  it('stores the optional action when provided', () => {
    vi.useFakeTimers()
    const action = { label: 'Undo', onClick: vi.fn() }
    useUIStore.getState().showToast('With action', action)
    expect(useUIStore.getState().toastAction).toEqual(action)
    vi.useRealTimers()
  })

  it('clearToast immediately nullifies toastMessage and toastAction', () => {
    vi.useFakeTimers()
    useUIStore.getState().showToast('Dismiss early')
    useUIStore.getState().clearToast()
    expect(useUIStore.getState().toastMessage).toBeNull()
    expect(useUIStore.getState().toastAction).toBeNull()
    vi.useRealTimers()
  })

  it('clears toastAction after 4000ms', () => {
    vi.useFakeTimers()
    const action = { label: 'OK', onClick: vi.fn() }
    useUIStore.getState().showToast('With action', action)
    vi.advanceTimersByTime(4000)
    expect(useUIStore.getState().toastAction).toBeNull()
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// isSidebarOpen
// ---------------------------------------------------------------------------
describe('isSidebarOpen', () => {
  it('defaults to true', () => {
    expect(useUIStore.getState().isSidebarOpen).toBe(true)
  })

  it('sets to false via direct value', () => {
    useUIStore.getState().setIsSidebarOpen(false)
    expect(useUIStore.getState().isSidebarOpen).toBe(false)
  })

  it('toggles via updater function', () => {
    useUIStore.getState().setIsSidebarOpen((prev) => !prev)
    expect(useUIStore.getState().isSidebarOpen).toBe(false)
    useUIStore.getState().setIsSidebarOpen((prev) => !prev)
    expect(useUIStore.getState().isSidebarOpen).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// generationMode
// ---------------------------------------------------------------------------
describe('generationMode', () => {
  it('defaults to "text"', () => {
    expect(useUIStore.getState().generationMode).toBe('text')
  })

  it('sets to a new value', () => {
    useUIStore.getState().setGenerationMode('image')
    expect(useUIStore.getState().generationMode).toBe('image')
  })

  it('sets to another value', () => {
    useUIStore.getState().setGenerationMode('code')
    expect(useUIStore.getState().generationMode).toBe('code')
  })
})

// ---------------------------------------------------------------------------
// isDeepThinking
// ---------------------------------------------------------------------------
describe('isDeepThinking', () => {
  it('defaults to false', () => {
    expect(useUIStore.getState().isDeepThinking).toBe(false)
  })

  it('sets to true', () => {
    useUIStore.getState().setIsDeepThinking(true)
    expect(useUIStore.getState().isDeepThinking).toBe(true)
  })

  it('sets back to false', () => {
    useUIStore.getState().setIsDeepThinking(true)
    useUIStore.getState().setIsDeepThinking(false)
    expect(useUIStore.getState().isDeepThinking).toBe(false)
  })

  it('toggles via updater function', () => {
    useUIStore.getState().setIsDeepThinking((prev) => !prev)
    expect(useUIStore.getState().isDeepThinking).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// canvasContent
// ---------------------------------------------------------------------------
describe('canvasContent', () => {
  it('defaults to null', () => {
    expect(useUIStore.getState().canvasContent).toBeNull()
  })

  it('stores a string value', () => {
    useUIStore.getState().setCanvasContent('console.log("hello")')
    expect(useUIStore.getState().canvasContent).toBe('console.log("hello")')
  })

  it('stores an object value', () => {
    const obj = { html: '<p>hi</p>' }
    useUIStore.getState().setCanvasContent(obj)
    expect(useUIStore.getState().canvasContent).toEqual(obj)
  })

  it('updates via updater function', () => {
    useUIStore.getState().setCanvasContent('initial')
    useUIStore.getState().setCanvasContent((prev: string) => prev + '-updated')
    expect(useUIStore.getState().canvasContent).toBe('initial-updated')
  })
})

// ---------------------------------------------------------------------------
// showConsole
// ---------------------------------------------------------------------------
describe('showConsole', () => {
  it('defaults to false', () => {
    expect(useUIStore.getState().showConsole).toBe(false)
  })

  it('sets to true', () => {
    useUIStore.getState().setShowConsole(true)
    expect(useUIStore.getState().showConsole).toBe(true)
  })

  it('toggles via updater function', () => {
    useUIStore.getState().setShowConsole((prev) => !prev)
    expect(useUIStore.getState().showConsole).toBe(true)
    useUIStore.getState().setShowConsole((prev) => !prev)
    expect(useUIStore.getState().showConsole).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Additional state mutations
// ---------------------------------------------------------------------------
describe('additional state mutations', () => {
  it('setInput stores the given string', () => {
    useUIStore.getState().setInput('hello there')
    expect(useUIStore.getState().input).toBe('hello there')
  })

  it('setIsDbLoaded sets isDbLoaded', () => {
    useUIStore.getState().setIsDbLoaded(true)
    expect(useUIStore.getState().isDbLoaded).toBe(true)
  })

  it('setViewMode stores the new view mode', () => {
    useUIStore.getState().setViewMode('archive')
    expect(useUIStore.getState().viewMode).toBe('archive')
  })

  it('setArchiveSearchQuery stores search query', () => {
    useUIStore.getState().setArchiveSearchQuery('my query')
    expect(useUIStore.getState().archiveSearchQuery).toBe('my query')
  })

  it('setUploadError stores upload error message', () => {
    useUIStore.getState().setUploadError('File too large')
    expect(useUIStore.getState().uploadError).toBe('File too large')
  })
})
