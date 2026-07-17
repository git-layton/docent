import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePanelResource, __clearPanelCache } from '../../lib/panelCache';

describe('usePanelResource', () => {
  beforeEach(() => {
    __clearPanelCache();
  });

  it('cold-loads with a spinner, then serves data', async () => {
    const fetch = vi.fn().mockResolvedValue(['a', 'b']);
    const { result } = renderHook(() => usePanelResource({ key: 'k1', fetch }));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual(['a', 'b']));
    expect(result.current.loading).toBe(false);
  });

  it('survives unmount/remount: hydrates instantly and revalidates silently', async () => {
    const fetch = vi.fn().mockResolvedValue(['first']);
    const first = renderHook(() => usePanelResource({ key: 'k2', fetch }));
    await waitFor(() => expect(first.result.current.data).toEqual(['first']));
    first.unmount();

    // Remount (the tab-switch case): cached data paints immediately, no cold spinner,
    // and the background revalidation replaces it with the fresh result.
    fetch.mockResolvedValue(['second']);
    const second = renderHook(() => usePanelResource({ key: 'k2', fetch }));
    expect(second.result.current.data).toEqual(['first']);
    expect(second.result.current.loading).toBe(false);
    await waitFor(() => expect(second.result.current.data).toEqual(['second']));
  });

  it('key switch hydrates the new key and never paints the old key\'s data', async () => {
    const fetch = vi.fn(async () => ['data-a']);
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => usePanelResource({ key: k, fetch: () => fetch() }),
      { initialProps: { k: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toEqual(['data-a']));

    fetch.mockImplementation(async () => ['data-b']);
    rerender({ k: 'b' });
    // Uncached new key: data resets synchronously rather than showing key a's rows under key b.
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual(['data-b']));
  });

  it('a late response for an abandoned key lands in cache but not in the view', async () => {
    let resolveA!: (v: string[]) => void;
    const slowA = new Promise<string[]>(res => { resolveA = res; });
    const fetch = vi.fn((k: string) => (k === 'a' ? slowA : Promise.resolve(['fast-b'])));
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => usePanelResource({ key: k, fetch: () => fetch(k) }),
      { initialProps: { k: 'a' } },
    );
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.data).toEqual(['fast-b']));
    // Key a's fetch finally resolves — the view (on key b) must not repaint.
    await act(async () => { resolveA(['slow-a']); });
    expect(result.current.data).toEqual(['fast-b']);
    // …but a return to key a hydrates from the late-cached result.
    rerender({ k: 'a' });
    expect(result.current.data).toEqual(['slow-a']);
  });

  it('mutate updates both the view and the cache (optimistic edits survive remount)', async () => {
    const fetch = vi.fn().mockResolvedValue([1]);
    const first = renderHook(() => usePanelResource<number[]>({ key: 'k3', fetch }));
    await waitFor(() => expect(first.result.current.data).toEqual([1]));
    act(() => first.result.current.mutate(prev => [...(prev ?? []), 2]));
    expect(first.result.current.data).toEqual([1, 2]);
    first.unmount();

    const second = renderHook(() => usePanelResource<number[]>({ key: 'k3', fetch }));
    expect(second.result.current.data).toEqual([1, 2]);
  });

  it('records errors without dropping cached data, and clears them on success', async () => {
    const fetch = vi.fn().mockResolvedValue(['good']);
    const { result } = renderHook(() => usePanelResource({ key: 'k4', fetch }));
    await waitFor(() => expect(result.current.data).toEqual(['good']));

    fetch.mockRejectedValueOnce(new Error('imap down'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toContain('imap down');
    expect(result.current.data).toEqual(['good']); // stale beats empty

    fetch.mockResolvedValue(['fresh']);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(['fresh']);
  });

  it('does not fetch while disabled, fetches once enabled', async () => {
    const fetch = vi.fn().mockResolvedValue(['x']);
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) => usePanelResource({ key: 'k5', fetch, enabled: on }),
      { initialProps: { on: false } },
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    rerender({ on: true });
    await waitFor(() => expect(result.current.data).toEqual(['x']));
  });
});
