import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { capturePageText } from '../../services/pageCapture'

// `@tauri-apps/api/core` and `@tauri-apps/api/event` are mocked globally in src/tests/setup.ts.
const mockInvoke = invoke as ReturnType<typeof vi.fn>
const mockListen = listen as ReturnType<typeof vi.fn>

const OBSERVATION_EVENT = 'browser-agent:observation'
const PAGE_URL = 'https://example.com/article'

type ListenCb = (event: { payload: unknown }) => void

/** Pull the `requestId` the grabber script embeds out of the browser_eval call. */
function requestIdFromEvalScript(): string {
  const evalCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'browser_eval')
  expect(evalCall, 'browser_eval should have been invoked').toBeTruthy()
  const script = (evalCall![1] as { script: string }).script
  const m = script.match(/var REQ = "([^"]+)"/)
  expect(m, 'script should embed a requestId').toBeTruthy()
  return m![1]
}

describe('capturePageText', () => {
  let lastUnlisten: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useRealTimers()
    mockInvoke.mockReset()
    mockListen.mockReset()
    lastUnlisten = vi.fn()
  })

  it('injects a grabber, receives HTML, and calls extract_page_text with {html,url,title}', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'extract_page_text') return Promise.resolve('Clean extracted text')
      return Promise.resolve(null)
    })

    const promise = capturePageText(PAGE_URL)

    // Wait a microtask so the listener subscription + browser_eval injection complete.
    await Promise.resolve()
    await Promise.resolve()

    const reqId = requestIdFromEvalScript()
    expect(listener).toBeTruthy()
    // The grabber reports the page HTML + title back over the observation channel.
    listener!({ payload: { requestId: reqId, html: '<html><body>hi</body></html>', title: 'Example' } })

    const result = await promise
    expect(result).toBe('Clean extracted text')

    const extractCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'extract_page_text')
    expect(extractCall).toBeTruthy()
    expect(extractCall![1]).toEqual({
      html: '<html><body>hi</body></html>',
      url: PAGE_URL,
      title: 'Example',
    })
    // Listener must be cleaned up.
    expect(lastUnlisten).toHaveBeenCalled()
  })

  it('ignores observations carrying a foreign requestId (e.g. the agentic browse loop)', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'extract_page_text') return Promise.resolve('SHOULD NOT BE CALLED')
      return Promise.resolve(null)
    })

    vi.useFakeTimers()
    const promise = capturePageText(PAGE_URL)
    // Flush the async subscription/injection without advancing fake timers.
    await vi.advanceTimersByTimeAsync(0)

    const reqId = requestIdFromEvalScript()
    expect(listener).toBeTruthy()

    // A foreign report (different requestId) must NOT settle our capture.
    listener!({ payload: { requestId: `${reqId}-other`, html: '<html>foreign</html>', title: 'Foreign' } })
    // A null/garbage payload must also be ignored.
    listener!({ payload: null })

    // Nothing matched, so it should fall through to the timeout and resolve empty.
    await vi.advanceTimersByTimeAsync(10000)
    const result = await promise

    expect(result).toBe('')
    const extractCalled = mockInvoke.mock.calls.some(([cmd]) => cmd === 'extract_page_text')
    expect(extractCalled).toBe(false)
    expect(lastUnlisten).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('resolves to "" (never throws) when browser_eval fails', async () => {
    mockListen.mockResolvedValue(lastUnlisten)
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'browser_eval') return Promise.reject(new Error('webview not found'))
      return Promise.resolve(null)
    })

    const result = await capturePageText(PAGE_URL)
    expect(result).toBe('')
    const extractCalled = mockInvoke.mock.calls.some(([cmd]) => cmd === 'extract_page_text')
    expect(extractCalled).toBe(false)
    expect(lastUnlisten).toHaveBeenCalled()
  })

  it('resolves to "" when the extractor throws', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'extract_page_text') return Promise.reject(new Error('selector parse error'))
      return Promise.resolve(null)
    })

    const promise = capturePageText(PAGE_URL)
    await Promise.resolve()
    await Promise.resolve()

    const reqId = requestIdFromEvalScript()
    listener!({ payload: { requestId: reqId, html: '<html>x</html>', title: 'T' } })

    const result = await promise
    expect(result).toBe('')
  })

  it('resolves to "" on empty/blocked HTML without calling the extractor', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockResolvedValue(null)

    const promise = capturePageText(PAGE_URL)
    await Promise.resolve()
    await Promise.resolve()

    const reqId = requestIdFromEvalScript()
    listener!({ payload: { requestId: reqId, html: '', title: '' } })

    const result = await promise
    expect(result).toBe('')
    const extractCalled = mockInvoke.mock.calls.some(([cmd]) => cmd === 'extract_page_text')
    expect(extractCalled).toBe(false)
  })

  it('resolves to "" on timeout when no observation arrives', async () => {
    mockListen.mockResolvedValue(lastUnlisten)
    mockInvoke.mockResolvedValue(null)

    vi.useFakeTimers()
    const promise = capturePageText(PAGE_URL)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10000)
    const result = await promise

    expect(result).toBe('')
    expect(lastUnlisten).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
