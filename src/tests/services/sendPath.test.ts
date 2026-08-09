import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateTextResponse, buildSystemPrompt } from '../../services/llm'

// ─── Seam ②: the send path ────────────────────────────────────────────────────
//
// "Type a message, get a reply" is the thing that was broken, and nothing asserted it end to
// end. tauri-driver cannot drive a Tauri app on macOS (no WKWebView driver exists), so the
// real app can't be automated here — but the send path is plain TypeScript over fetch, and
// that is where every failure actually lived: a crash while ASSEMBLING the request.
//
// The bugs this covers all shared one shape — an unguarded read of data that is normally
// present and occasionally isn't — and all of them killed the send outright rather than
// degrading:
//   browserContext.pageContent   undefined while a page is still extracting
//   f.content.split(',')[1]      undefined content threw; bare base64 posted `undefined`
//   uncapped artifact            prompt outgrew the window before a word was typed

const okStream = (text: string) => {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(body)); c.close() },
    }),
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    text: async () => body,
    json: async () => ({}),
  } as unknown as Response
}

const modelConfig = {
  provider: 'openai',
  endpoint: 'http://127.0.0.1:8080/v1',
  modelId: 'local-model',
  contextLimit: 32768,
  apiKey: 'test',
}

const send = (over: Record<string, any> = {}) =>
  generateTextResponse({
    messages: [{ id: 'u1', role: 'user', content: 'hello', timestamp: Date.now() }],
    modelConfig,
    agent: { name: 'Docent', prompt: 'be useful', tools: {}, trainingDocs: [] },
    profile: '',
    tasks: [],
    attachedDocs: [],
    agentPinnedMessages: [],
    mode: 'text',
    canvasContent: null,
    isDeepThinking: false,
    onChunk: null,
    signal: null,
    appSettings: {},
    integrations: {},
    models: [],
    ...over,
  })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okStream('hi there'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

// ---------------------------------------------------------------------------
// The baseline nobody was asserting
// ---------------------------------------------------------------------------

describe('send path — a plain message reaches the model and comes back', () => {
  it('sends and returns the reply', async () => {
    const out = await send()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(out)).toContain('hi there')
  })

  it('posts to the configured endpoint, not a default', async () => {
    await send()
    expect(String(fetchMock.mock.calls[0][0])).toContain('127.0.0.1:8080')
  })

  it('includes the system prompt in the request', async () => {
    await send()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('be useful')
  })
})

// ---------------------------------------------------------------------------
// The crash class — assembling the request must never throw
// ---------------------------------------------------------------------------

describe('send path — context that is present but incomplete must not kill the send', () => {
  it('survives a browser tab whose page has not extracted yet', async () => {
    // Shipped bug: browserContext is built whenever a tab is active, but `content` is empty
    // until extraction finishes, and pageContent was read unguarded. Sending was impossible
    // while a page loaded.
    await expect(send({
      browserContext: { title: 'Loading', url: 'https://example.com', pageContent: undefined },
    })).resolves.toBeDefined()
  })

  it('survives an enormous open artifact instead of overflowing the window', async () => {
    await expect(send({
      canvasContent: { title: 'Huge', content: 'x'.repeat(600_000) },
    })).resolves.toBeDefined()
  })

  it('survives every optional context being null', async () => {
    await expect(send({
      canvasContent: null, browserContext: null, toolContext: null, ambientContext: null,
      memorySummary: null, relevantMemory: null, graphContext: null, knownProcedures: null,
      webRecall: null, goal: null, projectContext: null, voiceProfile: null,
    })).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Attachments — the silent-corruption class
// ---------------------------------------------------------------------------

describe('send path — image attachments', () => {
  const withImage = (content: any) => ({
    messages: [{
      id: 'u1', role: 'user', content: 'what is this', timestamp: Date.now(),
      attachedFiles: [{ name: 'shot.png', type: 'image/png', isImage: true, content }],
    }],
    modelConfig: { ...modelConfig, provider: 'google', modelId: 'gemini-2.5-flash' },
  })

  it('does not throw when an attachment never loaded', async () => {
    // `f.content.split(',')[1]` on undefined threw and killed the entire send.
    await expect(send(withImage(undefined))).resolves.toBeDefined()
  })

  it('drops an empty attachment rather than posting an empty image part', async () => {
    await send(withImage(undefined))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const parts = body.contents?.[0]?.parts ?? []
    expect(parts.some((p: any) => p.inlineData)).toBe(false)
  })

  it('NEVER posts `undefined` as image data for a bare base64 attachment', async () => {
    // The silent one: a payload without a `data:` prefix made split(',')[1] undefined, which
    // was then sent to the API as the image. No throw, no error — just a broken request.
    await send(withImage('iVBORw0KGgoAAAANSUhEUg=='))
    const raw = fetchMock.mock.calls[0][1].body as string
    expect(raw).not.toContain('"data":null')
    expect(raw).not.toContain('"data":undefined')
    const body = JSON.parse(raw)
    const part = (body.contents?.[0]?.parts ?? []).find((p: any) => p.inlineData)
    expect(part?.inlineData?.data).toBe('iVBORw0KGgoAAAANSUhEUg==')
  })

  it('strips the data: prefix from a proper data URL', async () => {
    await send(withImage('data:image/png;base64,AAAA'))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const part = (body.contents?.[0]?.parts ?? []).find((p: any) => p.inlineData)
    expect(part?.inlineData?.data).toBe('AAAA')
  })
})

// ---------------------------------------------------------------------------
// The guard that reports the wrong cause
// ---------------------------------------------------------------------------

describe('send path — the context guard', () => {
  it('does not blame attachments when there are none', async () => {
    // "Attached documents exceed the context limit" fired on messages with NO attachments,
    // because the artifact had already filled the window. Whatever the limit does, it must
    // not accuse the user of something they did not do.
    const huge = { title: 'Huge', content: 'x'.repeat(900_000) }
    await expect(send({ canvasContent: huge, attachedDocs: [] })).resolves.toBeDefined()
  })

  it('still refuses when the ATTACHMENTS genuinely do not fit', async () => {
    // The guard must keep working — this is a real condition, just not the one that was firing.
    await expect(send({
      attachedDocs: [{ name: 'big.txt', content: 'y'.repeat(400_000), isImage: false }],
    })).rejects.toThrow(/context limit/i)
  })
})

// ---------------------------------------------------------------------------
// Prompt assembly stays inside the window
// ---------------------------------------------------------------------------

describe('send path — the assembled request fits the model', () => {
  it('keeps the system prompt inside the window with heavy context', () => {
    const prompt = buildSystemPrompt({
      agent: { name: 'Docent', prompt: 'be useful', tools: {}, trainingDocs: [] },
      tasks: [],
      contextLimit: 32768,
      canvasContent: { title: 'Doc', content: 'x'.repeat(400_000) },
      browserContext: { title: 'P', url: 'u', pageContent: 'y'.repeat(60_000) },
      toolContext: { label: 'Inbox', text: 'z'.repeat(60_000), source: 'mail' },
      profile: 'p'.repeat(40_000),
    })
    expect(prompt.length).toBeLessThan(32768 * 4)
  })
})
