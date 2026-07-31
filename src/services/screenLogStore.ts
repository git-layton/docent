// ─── Screen Log Store ─────────────────────────────────────────────────────────
// Persistence for screenLog.ts. `db` is a key-value store, so the log lives as a
// bounded, append-only array under one key — adequate at the volumes a
// change-gated log produces (Recall-class systems run ~300 MB per 8h storing
// FRAMES; this stores text plus a frame reference).
//
// The pure half is separated from the db calls on purpose, matching the house
// pattern in knowledgeLibrary.ts: retention and ordering are the rules most
// likely to be wrong, and they are exactly the rules a test can pin down without
// a running app.
//
// Retention is a HARD bound, not a suggestion. A log that grows forever is a
// liability rather than a feature — and the older an entry is, the less it is
// worth against the privacy cost of still holding it.

import { db } from './database';
import type { ScreenLogEntry } from './screenLog';

const LOG_KEY = 'screen-log:entries';

/** Entries older than this are dropped. Recall keeps ~3 months; 30 days is the
 *  conservative default, and it is a ceiling the user can lower, never raise blindly. */
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Absolute cap regardless of age, so a pathological day cannot unbound the store. */
export const DEFAULT_MAX_ENTRIES = 20_000;

// ── Pure ────────────────────────────────────────────────────────────────────

/**
 * Apply retention: drop anything too old, then trim to the newest N.
 *
 * Age is applied BEFORE count so a burst of activity cannot push older entries
 * out by volume alone while still inside their retention window — the user's
 * expectation is "the last 30 days", not "the last 20k frames".
 */
export function pruneEntries(
  entries: readonly ScreenLogEntry[],
  now: number,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): ScreenLogEntry[] {
  const cutoff = now - maxAgeMs;
  const fresh = (entries ?? []).filter(e => e && Number.isFinite(e.seenAt) && e.seenAt >= cutoff);
  // Newest first, so recall and trimming agree on what "most recent" means.
  fresh.sort((a, b) => b.seenAt - a.seenAt);
  return fresh.slice(0, Math.max(0, maxEntries));
}

/** Append one entry and re-apply retention. Duplicate ids replace rather than stack. */
export function withEntry(
  entries: readonly ScreenLogEntry[],
  entry: ScreenLogEntry,
  now: number,
  maxAgeMs?: number,
  maxEntries?: number,
): ScreenLogEntry[] {
  const without = (entries ?? []).filter(e => e.id !== entry.id);
  return pruneEntries([entry, ...without], now, maxAgeMs, maxEntries);
}

/** Entries whose frames are no longer referenced — what a frame-file GC would delete. */
export function orphanedFrameIds(
  before: readonly ScreenLogEntry[],
  after: readonly ScreenLogEntry[],
): string[] {
  const kept = new Set(after.map(e => e.frameId));
  const gone = new Set<string>();
  for (const e of before) if (!kept.has(e.frameId)) gone.add(e.frameId);
  return [...gone];
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function loadEntries(): Promise<ScreenLogEntry[]> {
  try {
    const raw = await db.get(LOG_KEY, []);
    return Array.isArray(raw) ? (raw as ScreenLogEntry[]) : [];
  } catch (e) {
    console.warn('[screenLogStore] load failed:', e);
    return [];
  }
}

/**
 * Persist one entry. Returns the frame ids that retention just orphaned, so the
 * caller can delete the corresponding thumbnails — an entry pruned from the index
 * while its frame lingers on disk is the privacy leak this whole module exists to
 * avoid.
 */
export async function saveEntry(entry: ScreenLogEntry, now = Date.now()): Promise<string[]> {
  const before = await loadEntries();
  const after = withEntry(before, entry, now);
  await db.set(LOG_KEY, after);
  return orphanedFrameIds(before, after);
}

/** Drop the entire log. The user-facing "forget everything I've seen". */
export async function clearLog(): Promise<string[]> {
  const before = await loadEntries();
  await db.set(LOG_KEY, []);
  return orphanedFrameIds(before, []);
}

/**
 * Drop everything captured from one app — the targeted version of clearing.
 * Needed because the realistic user request is "forget what you saw in Messages",
 * not "forget everything".
 */
export async function forgetApp(app: string, now = Date.now()): Promise<string[]> {
  const target = String(app ?? '').toLowerCase().trim();
  if (!target) return [];
  const before = await loadEntries();
  const after = pruneEntries(
    before.filter(e => !String(e.app ?? '').toLowerCase().includes(target)),
    now,
  );
  await db.set(LOG_KEY, after);
  return orphanedFrameIds(before, after);
}
