import { describe, it, expect } from 'vitest';
import {
  charBudget, TOKEN_TO_CHARS, trimHistoryChars,
  RESPONSE_RESERVE_TOKENS, TEMPLATE_OVERHEAD_TOKENS,
} from '../../services/llm';

// charBudget is the INPUT budget, not the window. It used to be `contextLimit x 4` — the whole
// window handed to the prompt, with nothing left for the reply — which is what produced
// CONTEXT_LIMIT_EXCEEDED against a correctly configured local model. The reserve is now part of
// the contract, so these express it via the exported constants rather than a baked-in number.
const expected = (tokens: number) =>
  (tokens - RESPONSE_RESERVE_TOKENS - TEMPLATE_OVERHEAD_TOKENS) * TOKEN_TO_CHARS;

describe('charBudget — contextLimit is tokens, budgets are chars', () => {
  it('converts a token limit to a char budget, minus the reserved headroom', () => {
    expect(charBudget(32000)).toBe(expected(32000));
  });

  it('accepts the stringly-stored form', () => {
    expect(charBudget('128000')).toBe(expected(128000));
  });

  it('falls back to the 32k default for missing/garbage values', () => {
    expect(charBudget(undefined)).toBe(expected(32000));
    expect(charBudget(null)).toBe(expected(32000));
    expect(charBudget('not-a-number')).toBe(expected(32000));
    expect(charBudget(0)).toBe(expected(32000));
  });

  it('reserves real headroom rather than returning the whole window', () => {
    // The regression in one line: if this ever equals the full window again, a full prompt is a
    // guaranteed server-side rejection.
    expect(charBudget(32000)).toBeLessThan(32000 * TOKEN_TO_CHARS);
  });
});

describe('trimHistoryChars', () => {
  const msg = (id: string, content: string, extra: Record<string, unknown> = {}) => ({ id, role: 'user', content, ...extra });

  it('keeps the newest messages within budget and preserves order', () => {
    const msgs = [msg('m-1', 'a'.repeat(50)), msg('m-2', 'b'.repeat(50)), msg('m-3', 'c'.repeat(50))];
    const out = trimHistoryChars(msgs, 110);
    expect(out.map((m: any) => m.id)).toEqual(['m-2', 'm-3']);
  });

  it('always keeps pinned messages regardless of budget', () => {
    const msgs = [msg('m-1', 'a'.repeat(100), { isPinned: true }), msg('m-2', 'b'.repeat(100)), msg('m-3', 'c'.repeat(100))];
    const out = trimHistoryChars(msgs, 150);
    expect(out.some((m: any) => m.id === 'm-1')).toBe(true);
  });
});
