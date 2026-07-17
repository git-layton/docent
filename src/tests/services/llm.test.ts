import { describe, it, expect } from 'vitest';
import { charBudget, TOKEN_TO_CHARS, trimHistoryChars } from '../../services/llm';

describe('charBudget — contextLimit is tokens, budgets are chars', () => {
  it('converts a token limit to a char budget', () => {
    expect(charBudget(32000)).toBe(32000 * TOKEN_TO_CHARS);
  });

  it('accepts the stringly-stored form', () => {
    expect(charBudget('128000')).toBe(128000 * TOKEN_TO_CHARS);
  });

  it('falls back to the 32k default for missing/garbage values', () => {
    expect(charBudget(undefined)).toBe(32000 * TOKEN_TO_CHARS);
    expect(charBudget(null)).toBe(32000 * TOKEN_TO_CHARS);
    expect(charBudget('not-a-number')).toBe(32000 * TOKEN_TO_CHARS);
    expect(charBudget(0)).toBe(32000 * TOKEN_TO_CHARS);
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
