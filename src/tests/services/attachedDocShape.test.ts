import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateTextResponse } from '../../services/llm'

// ─── The screen read that was never sent ─────────────────────────────────────
//
// The spotlight's screen capture pushes {title, url, text, kind, thumb}. The prompt builder read
// {name, content}. So a successful OCR arrived at the model as:
//
//     [ATTACHED DOC: undefined]
//     undefined
//
// The model then reported, correctly, that it could not see the screen — and a user reasonably
// concluded screen reading was broken, when in fact it worked and the text was dropped at the last
// possible step. Nothing threw. Nothing logged. The only symptom was a model telling the truth.
//
// These assert on the REQUEST BODY, because that is the only place the difference is visible.

const okStream = (text: string) => {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('')
  return {
    ok: true, status: 200,
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close() } }),
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    text: async () => body, json: async () => ({}),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okStream('ok'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const send = (attachedDocs: any[]) =>
  generateTextResponse({
    messages: [{ id: 'u1', role: 'user', content: 'do you see what i see', timestamp: Date.now() }],
    modelConfig: { provider: 'openai', endpoint: 'http://127.0.0.1:8080/v1', modelId: 'local', contextLimit: 32768, apiKey: 'k' },
    agent: { name: 'Docent', prompt: 'be useful', tools: {}, trainingDocs: [] },
    profile: '', tasks: [], attachedDocs, agentPinnedMessages: [], mode: 'text',
    canvasContent: null, isDeepThinking: false, onChunk: null, signal: null,
    appSettings: {}, integrations: {}, models: [],
  })

const bodyOf = () => String(fetchMock.mock.calls[0][1].body)

describe('an attached doc reaches the model whichever shape it was built in', () => {
  it('sends a screen read shaped {title, text} — the shape the spotlight actually produces', async () => {
    await send([{ title: 'Read your screen', url: 'on-device OCR', kind: 'screen', text: 'INBOX_MARKER_42' }])
    expect(bodyOf()).toContain('INBOX_MARKER_42')
  })

  it('still sends a doc shaped {name, content}', async () => {
    await send([{ name: 'notes.md', content: 'NOTES_MARKER_7' }])
    expect(bodyOf()).toContain('NOTES_MARKER_7')
  })

  it('NEVER writes the string "undefined" into the prompt', async () => {
    // The exact shipped symptom: "[ATTACHED DOC: undefined]\nundefined".
    await send([{ title: 'Read your screen', text: 'visible text' }])
    expect(bodyOf()).not.toContain('ATTACHED DOC: undefined')
    expect(bodyOf()).not.toContain('undefined')
  })

  it('labels the doc with whichever name it has', async () => {
    await send([{ title: 'Read your screen', text: 'x' }])
    expect(bodyOf()).toContain('Read your screen')
  })

  it('omits a doc with no body rather than announcing an unreadable attachment', async () => {
    // Announcing a doc the model cannot read is worse than silence — it invites speculation
    // about contents that were never sent.
    await send([{ title: 'Empty capture', text: '   ' }])
    expect(bodyOf()).not.toContain('Empty capture')
  })

  it('counts a {text}-shaped doc against the context budget', async () => {
    // The size guard also read only `content`, so a huge screen read was invisible to it and
    // could push the request past the window with the guard reporting nothing attached.
    await expect(send([{ title: 'Huge screen', text: 'y'.repeat(400_000) }]))
      .rejects.toThrow(/attached documents/i)
  })
})
