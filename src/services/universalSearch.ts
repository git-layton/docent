// Universal search — a pure, synchronous relevance ranker over a unified corpus of the user's
// stuff (apps, docs, tasks, conversations, bookmarks, web history). No store imports, so it's
// unit-testable and reusable for BOTH the global omni-bar and space-scoped agent retrieval.
//
// This is the lexical layer: whole-phrase hits, per-token coverage (title > sub > body), a
// fuzzy-subsequence fallback for typos, and a mild recency tiebreak. The semantic/embeddings
// layer is owned by a separate effort (the Rust index behind webHistory's searchWebHistory) —
// when that lands it composes with this, it doesn't replace it.

export type SearchKind = 'App' | 'Doc' | 'Bookmark' | 'Task' | 'Chat' | 'Web';

export interface SearchDoc {
  kind: SearchKind;
  id: string;
  title: string;
  /** Extra searchable text (doc contents, task details, recent messages). Matched, never displayed. */
  body?: string;
  /** Short display subtitle (also lightly searched). */
  sub?: string;
  url?: string;
  /** ms epoch — drives a mild recency tiebreak (recent wins when relevance ties). */
  timestamp?: number;
}

export type ScoredDoc<T extends SearchDoc = SearchDoc> = T & { score: number };

// Function words that carry no search signal — dropped so "find my rust notes" matches "Rust notes".
const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'was', 'are', 'about', 'that',
  'this', 'with', 'from', 'you', 'your', 'my', 'me', 'it', 'what', 'when', 'where', 'how', 'do', 'i',
  'can', 'find', 'show', 'tell', 'get', 'please', 'open', 'search',
]);

const WORD = /[a-z0-9]+/g;

export function tokenize(s: string): string[] {
  return (s || '').toLowerCase().match(WORD) ?? [];
}

/** Query tokens worth matching on: drop stopwords and 1-char noise. */
function queryTokens(s: string): string[] {
  return tokenize(s).filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Is every char of `needle` present in `hay`, in order? Cheap typo/abbreviation tolerance. */
function isSubsequence(needle: string, hay: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/** Score one doc against an already-tokenized query. Exported for tests; returns 0 for no match. */
export function scoreDoc(doc: SearchDoc, rawQuery: string, qTokens: string[], now = 0): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 0;

  const title = (doc.title || '').toLowerCase();
  const sub = (doc.sub || '').toLowerCase();
  const body = (doc.body || '').toLowerCase();
  const titleTokens = new Set(tokenize(title));

  let score = 0;

  // Whole-phrase hits — the strongest signal a user can give.
  if (title === q) score += 200;
  else if (title.startsWith(q)) score += 90;
  else if (title.includes(q)) score += 60;
  if (sub.includes(q)) score += 20;
  if (body.includes(q)) score += 25;

  // Per-token coverage, weighted by where the token landed.
  let covered = 0;
  for (const t of qTokens) {
    let best = 0;
    if (titleTokens.has(t)) best = 22;       // whole word in the title
    else if (title.includes(t)) best = 12;   // substring of the title
    else if (sub.includes(t)) best = 8;
    else if (body.includes(t)) best = 7;
    else if (t.length >= 4 && isSubsequence(t, title)) best = 4; // fuzzy / typo
    if (best > 0) covered++;
    score += best;
  }

  // Reward covering most or all of the query — rewards specificity over a single lucky token.
  if (qTokens.length > 0 && covered === qTokens.length) score += 30;
  else if (qTokens.length >= 3 && covered >= qTokens.length - 1) score += 12;

  if (score <= 0) return 0;

  // Mild recency nudge (max +12, decaying to 0 over ~45 days) — never overpowers relevance.
  if (doc.timestamp && now) {
    const days = Math.max(0, (now - doc.timestamp) / 86_400_000);
    score += Math.max(0, 12 - days * (12 / 45));
  }
  return score;
}

/**
 * Rank a corpus against a query, best first. Extra fields on each doc (icon, run, …) ride through
 * untouched, so callers can attach UI metadata and get it back on the scored result.
 */
export function rankSearchDocs<T extends SearchDoc>(docs: T[], query: string, limit = 8, now = 0): ScoredDoc<T>[] {
  const q = (query || '').trim();
  if (!q) return [];
  const qt = queryTokens(q);
  // All-stopword query (e.g. "the a of") — fall back to raw tokens so we still match something.
  const effective = qt.length ? qt : tokenize(q);

  const out: ScoredDoc<T>[] = [];
  for (const d of docs) {
    const s = scoreDoc(d, q, effective, now);
    if (s > 0) out.push({ ...d, score: s });
  }
  out.sort((a, b) => b.score - a.score || (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return out.slice(0, limit);
}
