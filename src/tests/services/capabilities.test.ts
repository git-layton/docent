import { describe, it, expect } from 'vitest';
import {
  capabilityForRoute,
  availableCapabilities,
  allCapabilities,
  registerCapability,
  type CapabilityContext,
} from '../../services/capabilities';
import type { ToolRoute } from '../../services/memoryGatekeeper';
import type { OmniTab } from '../../types/omniTab';

// Minimal context factory — only `openTabs` matters for resolution/scoping.
const ctx = (openTabs: OmniTab[] = []): CapabilityContext => ({
  userMsg: { content: '' },
  chatId: 'c',
  agentId: null,
  assistant: null,
  hwProfile: null,
  integrations: {},
  model: null,
  signal: undefined,
  openTabs,
  setStatus: () => {},
});

describe('capability registry — route parity with the former App.tsx if-chain', () => {
  const base = ctx();

  // Each legacy `primaryToolRoute` must resolve to a capability whose title matches the legacy
  // `toolUsed` string exactly — otherwise the status chip / behavior would drift.
  it('maps the four handled routes to the same tool titles', () => {
    expect(capabilityForRoute('memory_search', base)?.title).toBe('Knowledge Search');
    expect(capabilityForRoute('web_search', base)?.title).toBe('Web Search');
    expect(capabilityForRoute('browser', base)?.title).toBe('Browse');
    expect(capabilityForRoute('calendar', base)?.title).toBe('Calendar');
  });

  it('returns null for routes the if-chain never ran a tool for (and for none/null)', () => {
    const unhandled: ToolRoute[] = ['integrations', 'another_agent', 'none'];
    for (const route of unhandled) {
      expect(capabilityForRoute(route, base)).toBeNull();
    }
    expect(capabilityForRoute(null, base)).toBeNull();
  });

  it('maps the files route to the Files capability (workspace read context)', () => {
    const files = capabilityForRoute('files', base);
    expect(files?.title).toBe('Files');
    expect(files?.effect).toBe('read');
  });

  it('maps the preview route to the Observe preview capability (read-only, "Codey, look at this")', () => {
    const preview = capabilityForRoute('preview', base);
    expect(preview?.id).toBe('preview-observe');
    expect(preview?.title).toBe('Observe preview');
    expect(preview?.effect).toBe('read');
  });

  it('the four built-ins are always available (surface-* — preserves old behavior)', () => {
    const titles = availableCapabilities(ctx()).map(c => c.title);
    for (const t of ['Knowledge Search', 'Web Search', 'Browse', 'Calendar']) {
      expect(titles).toContain(t);
    }
  });

  it('Calendar is the only write-effect built-in; the rest are read', () => {
    const byTitle = (t: string) => allCapabilities().find(c => c.title === t)!;
    expect(byTitle('Calendar').effect).toBe('write');
    expect(byTitle('Knowledge Search').effect).toBe('read');
    expect(byTitle('Web Search').effect).toBe('read');
    expect(byTitle('Browse').effect).toBe('read');
  });
});

describe('capability registry — surface scoping machinery (for future capabilities)', () => {
  it('gates a surface-scoped capability on whether a matching tab is open', () => {
    registerCapability({
      id: '__test_web_only',
      title: 'TestWebOnly',
      description: 'test',
      effect: 'read',
      surfaces: ['web'],
      routes: [],
      execute: async () => ({ toolData: '', sources: [], status: { type: 'remove' } }),
    });

    const closed = availableCapabilities(ctx([])).some(c => c.id === '__test_web_only');
    expect(closed).toBe(false);

    const webTab: OmniTab = { id: 't1', type: 'web', label: 'Browse', url: 'https://x' };
    const open = availableCapabilities(ctx([webTab])).some(c => c.id === '__test_web_only');
    expect(open).toBe(true);
  });
});
