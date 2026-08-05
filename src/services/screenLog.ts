// ─── Screen Log ───────────────────────────────────────────────────────────────
// The continuous half of perception. `DesktopViewerPanel` already captures the
// selected window every 500ms and runs OCR over it — but it is a VIEWER: frames
// render and are discarded. This module is the memory behind those eyes.
//
// Design constraints, from docs/concept-canvas-design.md §The screen log:
//
//   - THE MODEL IS NEVER IN THE CAPTURE PATH. Everything here is mechanical:
//     policy checks, hashing, string matching. Enrichment (entities, themes,
//     promotion proposals) is deferred to the dream cycle, batched and local.
//     Logging is cheap; piping the log through a model is what was expensive.
//
//   - A LOG GROUNDS YOUR HISTORY, NOT THE WORLD. Entries become `observed`
//     blocks (see provenance.ts): checkable — there is a frame and a timestamp —
//     but never evidence that what was on screen is TRUE. You saw a page; you did
//     not necessarily read it, agree with it, or check it. `observed` never
//     auto-promotes to `read`.
//
//   - EXCLUSIONS COME FIRST. Windows Recall shipped capturing passwords, banking
//     and private messages, and the whole category converged on the same answer:
//     app/window exclusion, secret redaction, local-only storage. This is built
//     before the capture loop deliberately — retrofitting means the log already
//     contains exactly what should never have entered it, and there is no
//     un-seeing it. This is the line between a memory tool and a keylogger.
//
// Everything here is pure so the policy that protects the user is testable
// without a running app.

import { observedBlock, type Block } from './provenance';

// ── Windows ─────────────────────────────────────────────────────────────────

/** Shape returned by the `list_windows` Tauri command (screenshot.rs). */
export interface WindowRef {
  id: number;
  app: string;
  title: string;
}

export interface ExclusionPolicy {
  /** App names never captured. Matched case-insensitively as a whole-word-ish contains. */
  excludedApps: string[];
  /** Window-title substrings that veto capture regardless of app. */
  excludedTitlePatterns: string[];
  /**
   * When set, ONLY these apps may be captured — the "focus on specific
   * application windows" mode. The denylist still applies on top, so an
   * allowlisted app with an excluded title is still refused.
   */
  allowedApps?: string[] | null;
}

/**
 * Apps that must never be captured, by default and without the user asking.
 *
 * This list is the product's promise. Password managers and Keychain are the
 * obvious ones; Docent itself is here because a viewer capturing its own window
 * produces a hall of mirrors and, worse, would log whatever the user is reading
 * IN Docent — including content from windows that were themselves excluded.
 */
export const DEFAULT_EXCLUDED_APPS = [
  '1Password', 'Bitwarden', 'LastPass', 'Dashlane', 'KeePass', 'KeePassXC',
  'Keeper', 'Proton Pass', 'Enpass', 'NordPass', 'Keychain Access',
  'Docent', 'Agent Forge',
];

/**
 * Title markers that veto capture in ANY app.
 *
 * Deliberately narrow. Over-excluding is not "safer" in a useful sense — it makes
 * the log full of holes the user cannot see, and a log you cannot trust the
 * completeness of is worse than none. These are the markers that are unambiguous.
 */
export const DEFAULT_EXCLUDED_TITLE_PATTERNS = [
  'incognito',
  'private browsing',
  'inprivate',
  'password',
  'keychain',
  'secret key',
  'recovery phrase',
  'seed phrase',
];

export const DEFAULT_POLICY: ExclusionPolicy = {
  excludedApps: DEFAULT_EXCLUDED_APPS,
  excludedTitlePatterns: DEFAULT_EXCLUDED_TITLE_PATTERNS,
  allowedApps: null,
};

export type CaptureDecision =
  | { capture: true }
  | { capture: false; reason: 'excluded-app' | 'excluded-title' | 'not-allowlisted' | 'malformed' };

const norm = (s: unknown) => String(s ?? '').toLowerCase().trim();

/**
 * May this window be captured?
 *
 * Order matters and is deliberate: the denylist is evaluated AFTER the allowlist
 * so that adding an app to `allowedApps` can never re-enable a window the denylist
 * refuses. A user opting into "capture my browser" must not thereby opt into
 * capturing an incognito window.
 */
export function shouldCapture(win: WindowRef | null | undefined, policy: ExclusionPolicy = DEFAULT_POLICY): CaptureDecision {
  if (!win || typeof win.id !== 'number' || !Number.isFinite(win.id)) {
    return { capture: false, reason: 'malformed' };
  }
  const app = norm(win.app);
  const title = norm(win.title);

  // A window with no identifying app at all is refused: we cannot apply policy to
  // something we cannot name, and defaulting to "capture" there inverts the promise.
  if (!app) return { capture: false, reason: 'malformed' };

  if (policy.allowedApps && policy.allowedApps.length > 0) {
    const allowed = policy.allowedApps.some(a => app.includes(norm(a)));
    if (!allowed) return { capture: false, reason: 'not-allowlisted' };
  }

  if ((policy.excludedApps ?? []).some(a => norm(a) && app.includes(norm(a)))) {
    return { capture: false, reason: 'excluded-app' };
  }

  if ((policy.excludedTitlePatterns ?? []).some(p => norm(p) && title.includes(norm(p)))) {
    return { capture: false, reason: 'excluded-title' };
  }

  return { capture: true };
}

// ── Secret redaction ────────────────────────────────────────────────────────

/**
 * Mask things that look like credentials even inside an allowed window.
 *
 * The exclusion list handles apps we can name; this is the net for everything
 * else — a token pasted into a terminal, a key visible in a config file, a card
 * number on a checkout page. Patterns are deliberately shaped to need strong
 * evidence, because a redactor that eats ordinary text makes the log useless and
 * teaches the user to switch it off.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Provider-style API keys: sk-…, ghp_…, xoxb-…, AKIA…
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[redacted-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted-token]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-key]'],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]'],
  // 13–16 digit card-shaped runs, optionally space/dash grouped
  [/\b(?:\d[ -]?){13,16}\b/g, '[redacted-number]'],
  // Explicitly labelled secrets: password: hunter2 / api_key = abc123
  [/\b(password|passwd|pwd|api[_-]?key|secret|token)\b\s*[:=]\s*\S+/gi, '$1: [redacted]'],
];

export function redactSecrets(text: string): string {
  let out = String(text ?? '');
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

// ── Sampling ────────────────────────────────────────────────────────────────

/** Minimum gap between stored entries, however fast the screen changes. */
export const MIN_ENTRY_INTERVAL_MS = 2_000;
/** Below this much recognised text, there is nothing worth remembering. */
export const MIN_ENTRY_CHARS = 24;

export interface SampleInput {
  /** From `captureDesktopContextMesh()` — already computed today and currently ignored. */
  isDelta: boolean;
  text: string;
  /** Epoch ms of the previous stored entry, or null if this would be the first. */
  lastEntryAt: number | null;
  /** Text of the previous stored entry, for dedupe. */
  lastEntryText?: string | null;
  now: number;
}

export type SampleDecision =
  | { store: true }
  | { store: false; reason: 'no-change' | 'too-soon' | 'too-little-text' | 'duplicate' };

/**
 * Should this frame become a log entry?
 *
 * The delta filter is the whole reason a log is affordable. `hasFrameChanged`
 * already exists in desktopVision.ts and `captureDesktopContextMesh` already
 * returns `isDelta` — the viewer just ignores it and captures on a raw 500ms
 * timer. Gating on real change is the difference between a log and a pile of
 * near-identical frames of the same static window.
 */
export function shouldStore(input: SampleInput): SampleDecision {
  const text = String(input.text ?? '').trim();

  if (text.length < MIN_ENTRY_CHARS) return { store: false, reason: 'too-little-text' };
  if (!input.isDelta) return { store: false, reason: 'no-change' };

  if (input.lastEntryAt != null && input.now - input.lastEntryAt < MIN_ENTRY_INTERVAL_MS) {
    return { store: false, reason: 'too-soon' };
  }
  // Cheap exact-dupe guard: OCR can report a changed layout with identical text
  // (a cursor blink, a hover state), and those are not worth a row.
  if (input.lastEntryText != null && text === String(input.lastEntryText).trim()) {
    return { store: false, reason: 'duplicate' };
  }

  return { store: true };
}

// ── Entries ─────────────────────────────────────────────────────────────────

export interface ScreenLogEntry {
  id: string;
  app: string;
  windowTitle: string;
  /** Redacted OCR text. Never the raw capture. */
  text: string;
  /** Reference to the stored thumbnail — the evidence that makes this checkable. */
  frameId: string;
  seenAt: number;
}

/**
 * Build a log entry, re-checking the exclusion policy at the point of storage.
 *
 * The policy is checked here even though the caller is expected to have checked
 * it before capturing, and that redundancy is the point: this is the last gate
 * before text is persisted, and it is the one that must not be bypassable by a
 * future caller that forgets. Returns null — never throws — so a refusal is an
 * ordinary, silent non-event rather than something a caller might catch and
 * work around.
 */
export function makeEntry(
  win: WindowRef,
  rawText: string,
  frameId: string,
  seenAt: number,
  policy: ExclusionPolicy = DEFAULT_POLICY,
): ScreenLogEntry | null {
  if (shouldCapture(win, policy).capture !== true) return null;

  const text = redactSecrets(String(rawText ?? '')).trim();
  const frame = String(frameId ?? '').trim();
  if (text.length < MIN_ENTRY_CHARS || !frame) return null;
  if (!Number.isFinite(seenAt) || seenAt <= 0) return null;

  return {
    id: `screen-${seenAt}-${win.id}`,
    app: String(win.app),
    windowTitle: String(win.title ?? ''),
    text,
    frameId: frame,
    seenAt,
  };
}

/**
 * A log entry as an `observed` block — the bridge into the provenance model.
 *
 * Deliberately the ONLY way log content enters a concept, so the "grounds your
 * activity, never the world" rule holds by construction rather than by everyone
 * remembering it.
 */
export function entryToBlock(entry: ScreenLogEntry): Block | null {
  const label = entry.windowTitle
    ? `${entry.app} — ${entry.windowTitle}`
    : entry.app;
  return observedBlock(`${label}: ${entry.text}`, entry.frameId, entry.seenAt);
}

// ── Recall ──────────────────────────────────────────────────────────────────

export interface RecallHit {
  entry: ScreenLogEntry;
  score: number;
}

/**
 * Mechanical recall over the log — tier 1, no model.
 *
 * Scores on term coverage, with a mild recency lean so "that thing I was looking
 * at earlier" ranks above the same words from three weeks ago. Semantic search
 * over the log can layer on later; this exists so recall works with no model
 * available at all, which is the point of a local-first log.
 */
export function recall(
  entries: readonly ScreenLogEntry[],
  query: string,
  now: number,
  limit = 20,
): RecallHit[] {
  const terms = norm(query).split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) return [];

  const DAY = 24 * 60 * 60 * 1000;
  const hits: RecallHit[] = [];

  for (const e of entries ?? []) {
    const hay = `${norm(e.app)} ${norm(e.windowTitle)} ${norm(e.text)}`;
    const matched = terms.filter(t => hay.includes(t)).length;
    if (matched === 0) continue;

    const coverage = matched / terms.length;
    // Half-life of a week: recent things surface first without burying older ones.
    const ageDays = Math.max(0, (now - e.seenAt) / DAY);
    const recency = 1 / (1 + ageDays / 7);
    hits.push({ entry: e, score: coverage * 0.8 + recency * 0.2 });
  }

  return hits
    .sort((a, b) => b.score - a.score || b.entry.seenAt - a.entry.seenAt)
    .slice(0, limit);
}
