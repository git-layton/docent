import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network layer so we control what the API providers (Tavily/Brave/Wikipedia) return,
// while preserving the rest of the llm module.
vi.mock('../../services/llm', async (importActual) => {
  const actual = await importActual<any>();
  return { ...actual, fetchWithRetry: vi.fn(async () => ({})) };
});

// Mock the browse capability so the fallback is detectable without opening a real browser tab.
// vi.hoisted lets the (hoisted) vi.mock factory reference this spy without a TDZ error.
const { browseExecute } = vi.hoisted(() => ({ browseExecute: vi.fn() }));
vi.mock('../../services/capabilities/builtins/browse', () => ({
  browseCapability: {
    id: 'browse', title: 'Browse', description: '', effect: 'read',
    surfaces: '*', routes: ['browser'], execute: browseExecute,
  },
}));

import { webSearchCapability } from '../../services/capabilities/builtins/webSearch';
import { fetchWithRetry } from '../../services/llm';
import type { CapabilityContext } from '../../services/capabilities/types';

const makeCtx = (over: Partial<CapabilityContext> = {}): CapabilityContext => ({
  userMsg: { content: 'search for the latest mars news' },
  chatId: 'c', agentId: null, assistant: null, hwProfile: null,
  integrations: {}, model: null, signal: undefined, openTabs: [],
  setStatus: () => {}, ...over,
});

describe('web search → keyless browser fallback', () => {
  beforeEach(() => {
    browseExecute.mockReset();
    browseExecute.mockResolvedValue({
      toolData: '[SYSTEM NOTE: BROWSE FINDINGS]\nkeyless browser result\n[END BROWSE]',
      sources: [{ title: 'DuckDuckGo result', url: 'https://example.com' }],
      status: { type: 'replace', content: '🌐 Browse · 1 page' },
    });
    vi.mocked(fetchWithRetry).mockReset();
    vi.mocked(fetchWithRetry).mockResolvedValue({} as any); // default: every provider returns nothing
  });

  it('falls back to the keyless browser search when the API path yields no results', async () => {
    const result = await webSearchCapability.execute(makeCtx());
    expect(browseExecute).toHaveBeenCalledOnce();
    expect(result.sources).toEqual([{ title: 'DuckDuckGo result', url: 'https://example.com' }]);
    expect(result.toolData).toContain('keyless browser result');
  });

  it('does NOT fall back when an API provider returns results', async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (url: any) => {
      if (typeof url === 'string' && url.includes('tavily')) {
        return { results: [{ title: 'T', url: 'https://t', content: 'snippet' }], answer: 'A' } as any;
      }
      return {} as any;
    });
    const result = await webSearchCapability.execute(
      makeCtx({ integrations: { tavily: { enabled: true, apiKey: 'k' } } }),
    );
    expect(browseExecute).not.toHaveBeenCalled();
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.toolData).toContain('WEB SEARCH RESULTS');
  });
});
