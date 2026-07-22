import { useCallback, useEffect, useRef, useState } from 'react';

// Module-scoped data cache for tool panels — the "state-alive, not DOM-alive" pattern.
//
// App.tsx's renderTabContent mounts a fresh panel component on every tab switch, so panels
// that fetch on mount used to open empty and flash a spinner every time (the AppleScript- and
// IMAP-bound panels were seconds-slow). Keeping panel DOM alive instead would hold RAM the
// local models need. So panels stay unmounted, and their *data* survives here: on remount a
// panel hydrates from this registry instantly and revalidates in the background.
// NotesPanel pioneered the pattern with a hand-rolled cache; this is the shared version.
//
// The key must encode every input the fetch depends on (backend, account set, folder, month
// range, chat id…) — two different sources must never share a key, or a remount can paint one
// source's data under another's label.

const registry = new Map<string, unknown>();
const stateRegistry = new Map<string, unknown>();

/** Test hook: drop all cached panel data. */
export function __clearPanelCache() {
  registry.clear();
  stateRegistry.clear();
}

/** 
 * Drop-in replacement for useState that persists UI state (like selected item, text drafts)
 * across panel remounts. State lives as long as the app session.
 */
export function usePanelState<T>(key: string, initial: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (stateRegistry.has(key)) return stateRegistry.get(key) as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  const setPersistedState = useCallback((val: React.SetStateAction<T>) => {
    setState(prev => {
      const next = typeof val === 'function' ? (val as (prev: T) => T)(prev) : val;
      stateRegistry.set(key, next);
      return next;
    });
  }, [key]);

  return [state, setPersistedState];
}

export interface PanelResource<T> {
  /** Cached-or-fresh data; undefined only before the first successful fetch for this key. */
  data: T | undefined;
  /** True only during a cold load (no cached data yet). Background refreshes never flip it. */
  loading: boolean;
  /** Last fetch error for the current key; cleared by the next successful fetch or key switch. */
  error: string | null;
  /** Re-fetch now (silent when cached data exists, spinner when cold). */
  refresh: () => Promise<void>;
  /** Optimistic local update — writes both React state and the cache so a remount keeps it. */
  mutate: (updater: (prev: T | undefined) => T) => void;
}

export function usePanelResource<T>(opts: {
  key: string;
  fetch: () => Promise<T>;
  /** Gate fetching behind setup/permissions; while false nothing fetches or polls. */
  enabled?: boolean;
  /** Background revalidation interval (always silent). */
  pollMs?: number;
}): PanelResource<T> {
  const { key, enabled = true, pollMs } = opts;

  // The fetch closure changes identity every render (it captures accounts, folders, …).
  // Effects therefore depend on `key`, never on the closure — which is why the key must
  // encode every fetch input.
  const fetchRef = useRef(opts.fetch);
  fetchRef.current = opts.fetch;
  const keyRef = useRef(key);
  const mountedRef = useRef(true);

  const [data, setData] = useState<T | undefined>(() => registry.get(key) as T | undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Key switched (folder / account / month change): hydrate the new key's cache synchronously
  // during render so the old key's data never paints under the new label.
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setData(registry.get(key) as T | undefined);
    setError(null);
    setLoading(false);
  }
  keyRef.current = key;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const forKey = keyRef.current;
    const cold = !registry.has(forKey);
    if (cold && mountedRef.current) setLoading(true);
    try {
      const result = await fetchRef.current();
      registry.set(forKey, result);
      // A late response for a key we've navigated away from still lands in the cache
      // (that key's next mount hydrates from it) but must not paint the current view.
      if (mountedRef.current && keyRef.current === forKey) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current && keyRef.current === forKey) setError(String(e));
    } finally {
      if (cold && mountedRef.current && keyRef.current === forKey) setLoading(false);
    }
  }, []);

  const mutate = useCallback((updater: (prev: T | undefined) => T) => {
    const forKey = keyRef.current;
    const next = updater(registry.get(forKey) as T | undefined);
    registry.set(forKey, next);
    if (mountedRef.current) setData(next);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    if (!pollMs) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [key, enabled, pollMs, refresh]);

  return { data, loading, error, refresh, mutate };
}
