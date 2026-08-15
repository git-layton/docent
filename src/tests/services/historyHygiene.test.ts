import { describe, it, expect } from 'vitest'
import { isConversationalMessage, trimHistoryChars } from '../../services/llm'

// ─── Error bubbles are app chrome, not conversation ───────────────────────────
//
// Failures are stored as ordinary bot messages, so they were replayed to the model as things it
// had said. Watched live after a run of CONTEXT_LIMIT_EXCEEDED errors: the model's own reasoning
// read "considering the previous quota errors…" and it started explaining a Gemini quota problem
// that never happened. It was reading its own error bubbles and treating them as fact.
//
// A filter for this existed and never matched. It tested `startsWith('⚠️')`, while the bubbles are
// written `### ⚠️ Generation Failed` — the marker is at index 4, never 0. It silently did nothing,
// in one code path, and the main chat had no filter at all.
//
// Costs twice: the context each dead bubble eats, and a model reasoning from invented history,
// which is worse because it comes back looking like an answer.

const bot = (content: string) => ({ id: 'b', role: 'bot', content })

describe('isConversationalMessage', () => {
  it('drops the bubble format that is ACTUALLY written', () => {
    // The regression, exactly as App.tsx emits it.
    expect(isConversationalMessage(bot('### ⚠️ Generation Failed\nCONTEXT_LIMIT_EXCEEDED'))).toBe(false)
  })

  it('still drops the bare format the old filter was written for', () => {
    expect(isConversationalMessage(bot('⚠️ API key missing'))).toBe(false)
  })

  it('drops stopped and empty turns', () => {
    expect(isConversationalMessage(bot('_(stopped)_'))).toBe(false)
    expect(isConversationalMessage(bot(''))).toBe(false)
    expect(isConversationalMessage(bot('   \n  '))).toBe(false)
    expect(isConversationalMessage(undefined)).toBe(false)
  })

  it('keeps real answers', () => {
    expect(isConversationalMessage(bot('You have three meetings tomorrow.'))).toBe(true)
    expect(isConversationalMessage({ id: 'u', role: 'user', content: 'do you see what i see' })).toBe(true)
  })

  it('keeps an answer that merely MENTIONS a warning sign later on', () => {
    // Only the first line marks a bubble as chrome. A genuine reply discussing an error — which
    // is a normal thing to ask about — must survive, or asking "why did that fail?" erases the
    // answer from history.
    expect(isConversationalMessage(bot('Here is what went wrong:\n\n⚠️ the key had expired'))).toBe(true)
  })

  it('keeps a reply whose first line is ordinary prose about failures', () => {
    expect(isConversationalMessage(bot('The build failed because the cargo shims reverted.'))).toBe(true)
  })
})

describe('history assembly drops chrome before budgeting', () => {
  it('does not spend the history budget on dead error bubbles', () => {
    // Before: errors consumed budget AND poisoned the context. Both, from one oversight.
    const msgs = [
      bot('### ⚠️ Generation Failed\n' + 'x'.repeat(500)),
      { id: 'u1', role: 'user', content: 'real question' },
      bot('real answer'),
      bot('### ⚠️ Generation Failed\n' + 'y'.repeat(500)),
    ]
    const kept = trimHistoryChars(msgs.filter(isConversationalMessage), 10_000)
    expect(kept.map((m: any) => m.content)).toEqual(['real question', 'real answer'])
  })

  it('a conversation that is ALL errors yields no history rather than a wall of failures', () => {
    const msgs = [bot('### ⚠️ Generation Failed\nCONTEXT_LIMIT_EXCEEDED'), bot('_(stopped)_')]
    expect(trimHistoryChars(msgs.filter(isConversationalMessage), 10_000)).toEqual([])
  })
})
