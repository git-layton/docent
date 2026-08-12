import { describe, it, expect } from 'vitest'
import { charBudget, TOKEN_TO_CHARS, humanizeLlmError } from '../../services/llm'

// ─── The budget has to fit the REPLY too ──────────────────────────────────────
//
// Shipped bug: `charBudget` returned contextLimit x 4 chars and the send path filled it to the
// brim. Docent's own Context Health panel read "135,167 / 131,072 chars · 100%" and llama.cpp
// rejected the request before generating a word — surfaced to the user as
// "GENERATION FAILED / CONTEXT_LIMIT_EXCEEDED", with no way to act on it.
//
// Three separate errors stacked up, each individually plausible:
//   1. 100% of the window budgeted for INPUT — nothing held back for the completion.
//   2. Per-message chat-template tokens (role markers, turn delimiters) never counted; at
//      ~4 tokens x 241 messages that was ~960 unbudgeted tokens.
//   3. 4.0 chars/token, which real content does not hit.
//
// The ground truth below came from the model's OWN tokenizer (llama-server /tokenize,
// gemma-4-12b-it-Q4_K_M) run over a real 241-message conversation:
//
//     123,680 chars -> 31,661 tokens  =  3.91 chars/token
//
// Synthetic text is wildly more optimistic — repeated common words measured 6.66 chars/token —
// which is exactly why 4.0 survived review. Any test here must use the MEASURED ratio, never
// generated filler, or it will re-certify the bug.

const MEASURED_CHARS_PER_TOKEN = 3.91
const SERVER_N_CTX = 32768

describe('charBudget leaves room for the response', () => {
  it('does not hand the whole window to the input', () => {
    expect(charBudget(SERVER_N_CTX)).toBeLessThan(SERVER_N_CTX * TOKEN_TO_CHARS)
  })

  it('a FULL budget still fits the server window once tokenized for real', () => {
    // The regression, stated as arithmetic: fill the budget completely, convert at the ratio
    // real conversations actually hit, add the reply, and it must still fit.
    const budgetChars = charBudget(SERVER_N_CTX)
    const inputTokens = budgetChars / MEASURED_CHARS_PER_TOKEN
    const replyTokens = 2048
    expect(inputTokens + replyTokens).toBeLessThan(SERVER_N_CTX)
  })

  it('leaves headroom for content that tokenizes WORSE than prose', () => {
    // Code, file paths, JSON and OCR output all tokenize worse than 3.91. The budget should
    // survive a meaningfully worse ratio without hitting the wall.
    const worstCase = 3.0
    const inputTokens = charBudget(SERVER_N_CTX) / worstCase
    expect(inputTokens).toBeLessThan(SERVER_N_CTX)
  })

  it('scales with the model rather than assuming 32k', () => {
    expect(charBudget(200_000)).toBeGreaterThan(charBudget(32_768))
    expect(charBudget(8_192)).toBeLessThan(charBudget(32_768))
  })

  it('never returns a budget so small the app cannot send anything', () => {
    // A tiny or nonsensical contextLimit must not produce a zero/negative budget — that would
    // reject every message instead of just long ones.
    for (const bad of [0, 512, 1024, -1, NaN, null, undefined, 'garbage']) {
      expect(charBudget(bad as any)).toBeGreaterThan(0)
    }
  })

  it('an unparseable limit falls back to the documented default, not to zero', () => {
    expect(charBudget('not-a-number')).toBe(charBudget(32000))
  })
})

describe('humanizeLlmError', () => {
  it('translates the sentinel into something actionable', () => {
    const out = humanizeLlmError('CONTEXT_LIMIT_EXCEEDED')
    expect(out).not.toContain('CONTEXT_LIMIT_EXCEEDED')
    // It must say what to DO. The old bubble named the machine's problem and stopped there.
    expect(out).toMatch(/new chat|dream cycle/i)
  })

  it('passes real error text through untouched', () => {
    expect(humanizeLlmError('Model server unreachable')).toBe('Model server unreachable')
  })

  it('never renders an empty or undefined bubble', () => {
    expect(humanizeLlmError(undefined)).toBeTruthy()
    expect(humanizeLlmError('')).toBeTruthy()
    expect(humanizeLlmError(null)).toBeTruthy()
  })
})
