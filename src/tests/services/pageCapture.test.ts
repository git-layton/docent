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

// Substantial (> the 200-char retry threshold) so a single read satisfies capturePageText.
const SUBSTANTIAL = 'A'.repeat(300)

/** Pull the requestId from the MOST RECENT grabber script injected via browser_eval. */
function lastRequestId(): string {
  const evalCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'browser_eval')
  expect(evalCalls.length, 'browser_eval should have been invoked').toBeGreaterThan(0)
  const script = (evalCalls[evalCalls.length - 1]![1] as { script: string }).script
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

  it('returns the grabber\'s rendered text directly, without calling the extractor', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockResolvedValue(undefined) // browser_eval resolves

    const promise = capturePageText(PAGE_URL)
    await Promise.resolve()
    await Promise.resolve()

    const reqId = lastRequestId()
    expect(listener).toBeTruthy()
    // The grabber reports rendered innerText (not HTML) over the observation channel.
    listener!({ payload: { requestId: reqId, text: SUBSTANTIAL, title: 'Example' } })

    const result = await promise
    expect(result).toBe(SUBSTANTIAL)
    // Rendered text was available → the Rust extractor fallback must NOT run.
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'extract_page_text')).toBe(false)
    expect(lastUnlisten).toHaveBeenCalled()
  })

  it('falls back to extract_page_text with {html,url,title} when no rendered text is found', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'extract_page_text') return Promise.resolve(SUBSTANTIAL)
      return Promise.resolve(undefined)
    })

    const promise = capturePageText(PAGE_URL)
    await Promise.resolve()
    await Promise.resolve()

    const reqId = lastRequestId()
    // Empty rendered text but bounded HTML present → the extractor fallback should run on it.
    listener!({ payload: { requestId: reqId, text: '', html: '<html><body>hi</body></html>', title: 'Example' } })

    const result = await promise
    expect(result).toBe(SUBSTANTIAL)

    const extractCall = mockInvoke.mock.calls.find(([cmd]) => cmd === 'extract_page_text')
    expect(extractCall).toBeTruthy()
    expect(extractCall![1]).toEqual({
      html: '<html><body>hi</body></html>',
      url: PAGE_URL,
      title: 'Example',
    })
    expect(lastUnlisten).toHaveBeenCalled()
  })

  it('ignores observations carrying a foreign requestId and resolves to ""', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockResolvedValue(undefined)

    vi.useFakeTimers()
    const promise = capturePageText(PAGE_URL)
    await vi.advanceTimersByTimeAsync(0)

    const reqId = lastRequestId()
    expect(listener).toBeTruthy()
    // A foreign report (different requestId) and a garbage payload must NOT settle our capture.
    listener!({ payload: { requestId: `${reqId}-other`, text: SUBSTANTIAL, title: 'Foreign' } })
    listener!({ payload: null })

    // Nothing matched → all retries time out → resolves empty, extractor never runs.
    await vi.advanceTimersByTimeAsync(30000)
    const result = await promise

    expect(result).toBe('')
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'extract_page_text')).toBe(false)
    expect(lastUnlisten).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('resolves to "" (never throws) when browser_eval always fails', async () => {
    mockListen.mockResolvedValue(lastUnlisten)
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'browser_eval') return Promise.reject(new Error('webview not found'))
      return Promise.resolve(undefined)
    })

    vi.useFakeTimers()
    const promise = capturePageText(PAGE_URL)
    await vi.advanceTimersByTimeAsync(10000) // step past the retry backoffs
    const result = await promise

    expect(result).toBe('')
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'extract_page_text')).toBe(false)
    expect(lastUnlisten).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('resolves to "" when the extractor fallback throws', async () => {
    let listener: ListenCb | null = null
    mockListen.mockImplementation((event: string, cb: ListenCb) => {
      if (event === OBSERVATION_EVENT) listener = cb
      return Promise.resolve(lastUnlisten)
    })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'extract_page_text') return Promise.reject(new Error('selector parse error'))
      return Promise.resolve(undefined)
    })

    vi.useFakeTimers()
    const promise = capturePageText(PAGE_URL)
    await vi.advanceTimersByTimeAsync(0)

    const reqId = lastRequestId()
    listener!({ payload: { requestId: reqId, text: '', html: '<html>x</html>', title: 'T' } })

    await vi.advanceTimersByTimeAsync(30000) // let the remaining retries time out
    const result = await promise
    expect(result).toBe('')
    vi.useRealTimers()
  })
})
