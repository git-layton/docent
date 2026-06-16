// Semantic Knowledge-Core hits for the typed search bars. This is the embeddings layer that
// the lexical ranker (universalSearch) was always meant to COMPOSE with: keyword search finds
// exact title/token hits, semantic search finds notes that match by *meaning*. Both feed the
// same result list so the omni-bar and ⌘K palette surface relevant memory even when the words
// don't line up.
//
// Backed by the Rust `search_knowledge_semantic` command (cosine over the on-disk brain index,
// with a keyword fallback when the embedder model isn't loaded). agentId=null searches the whole
// Knowledge Core (all memory + library) — the right scope for the user's own global search.

import { invoke } from '@tauri-apps/api/core';
import type { ScoredDoc } from './universalSearch';
import type { RagHit } from './memoryContext';

const isTauri = () => !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

// Min cosine similarity to surface in a search bar. Looser than the prompt-injection cutoff
// (memoryContext TIER2_MIN_SCORE = 0.35): a user actively searching wants recall, and these hits
// are clickable rows — not tokens spent dumping marginal context into a prompt.
export const KNOWLEDGE_SEARCH_MIN_SCORE = 0.3;

// Stable prefix on a knowledge doc's id, so a bar can recognise its own semantic hits and open
// them (the Knowledge Base) instead of routing through the caller's tab/app/url dispatch.
export const KNOWLEDGE_DOC_PREFIX = 'knowledge:';

/**
 * PURE — map Knowledge-Core semantic hits to ranked SearchDocs. Cosine (0–1) is scaled into the
 * lexical score range (≈0–150) so semantic and keyword hits interleave sensibly: a strong
 * semantic match (~0.8 → 120) outranks a weak keyword hit, but an exact title match (lexical 200)
 * still wins. Exported for tests.
 */
export function ragHitsToDocs(hits: RagHit[], minScore = KNOWLEDGE_SEARCH_MIN_SCORE): ScoredDoc[] {
  return (hits ?? [])
    .filter((h) => h && typeof h.path === 'string' && (h.score ?? 0) >= minScore)
    .map((h) => ({
      kind: 'Doc' as const,
      id: `${KNOWLEDGE_DOC_PREFIX}${h.path}`,
      title: h.title || h.path.split('/').pop()?.replace(/\.md$/, '') || 'Untitled',
      sub: (h.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      score: Math.round((h.score ?? 0) * 150),
    }));
}

/** True when a doc is a semantic Knowledge-Core hit produced by this module. */
export const isKnowledgeDoc = (id: string): boolean => id.startsWith(KNOWLEDGE_DOC_PREFIX);

/**
 * PURE — fold semantic hits into the lexical matches: drop any semantic hit already shown
 * lexically (same id, or same normalised title), then sort the union by score and cap. Keeps the
 * keyword results authoritative while adding meaning-based hits the lexical pass missed. Exported
 * for tests.
 */
export function mergeRanked(lexical: ScoredDoc[], semantic: ScoredDoc[], cap = 8): ScoredDoc[] {
  const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const seenIds = new Set(lexical.map((d) => d.id));
  const seenTitles = new Set(lexical.map((d) => norm(d.title)));
  const extra = (semantic ?? []).filter((d) => !seenIds.has(d.id) && !seenTitles.has(norm(d.title)));
  return [...lexical, ...extra].sort((a, b) => b.score - a.score).slice(0, cap);
}

/**
 * Tauri-guarded fetch of Knowledge-Core hits for a query. Returns [] outside Tauri, for very short
 * queries, or on any error — so callers can fire it freely as the user types without guarding.
 */
export async function searchKnowledgeDocs(
  query: string,
  opts?: { agentId?: string | null; max?: number },
): Promise<ScoredDoc[]> {
  const q = (query || '').trim();
  if (q.length < 3 || !isTauri()) return [];
  try {
    const res = await invoke<{ results: RagHit[] }>('search_knowledge_semantic', {
      query: q,
      agentId: opts?.agentId ?? null,
      maxResults: opts?.max ?? 6,
      snippetChars: 160,
    });
    return ragHitsToDocs(res?.results ?? []);
  } catch {
    return [];
  }
}
