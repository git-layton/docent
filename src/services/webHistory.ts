// Searchable browsing history — so the agent can answer "remember that article I saw?". This is
// RECALL, not learning: pages are surfaced as provenance-tagged sources the agent SAW (untrusted —
// cite, don't assert as fact). Promotion to durable knowledge stays on the user's signal (Save to
// KB / a note), never automatic — see the agentActions note.create path + the dream cycle.
//
// Privacy/clutter guards: private (incognito) visits are excluded, and only pages the user actually
// dwelled on (wordCount ≥ threshold) are searchable. visitLog only stores title+url metadata, so v1
// is keyword recall (title + URL tokens); a semantic upgrade would index page digests later.

import { useBrowserStore } from '../store/useBrowserStore';

interface VisitLogEntry {
  id: string; url: string; title: string; timestamp: number; wordCount: number; wasDigested: boolean; isPrivate: boolean;
}
export interface WebRecallHit { title: string; url: string; timestamp: number; score: number }

const MIN_DWELL_WORDS = 40; // pages actually read, not redirects/blank/instant bounces
const MIN_SCORE = 2;        // need a couple of meaningful token overlaps to count as relevant

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'was', 'are', 'about', 'that',
  'this', 'with', 'from', 'you', 'your', 'my', 'me', 'it', 'what', 'when', 'where', 'how', 'remember',
  'saw', 'seen', 'read', 'article', 'page', 'site', 'website', 'link', 'find', 'show', 'tell',
]);

function tokenize(s: string): string[] {
  return ((s || '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(t => !STOP.has(t));
}

/** PURE — rank visited pages against a query by token overlap on title + URL. Unit-tested. */
export function scoreWebHistory(visits: VisitLogEntry[], query: string, limit = 5): WebRecallHit[] {
  const qSet = new Set(tokenize(query));
  if (qSet.size === 0) return [];
  const seen = new Set<string>();
  const scored: WebRecallHit[] = [];
  for (const v of visits ?? []) {
    if (v.isPrivate || (v.wordCount ?? 0) < MIN_DWELL_WORDS || seen.has(v.url)) continue;
    const hay = tokenize(`${v.title} ${v.url.replace(/^https?:\/\//, '').replace(/[/?#=&._-]+/g, ' ')}`);
    let score = 0;
    for (const t of hay) if (qSet.has(t)) score++;
    if (score >= MIN_SCORE) { seen.add(v.url); scored.push({ title: v.title, url: v.url, timestamp: v.timestamp, score }); }
  }
  scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp); // relevance, then recency
  return scored.slice(0, limit);
}

/** Live recall over the user's browsing history (privacy-filtered, dwell-gated). */
export function searchWebHistory(query: string, limit = 5): WebRecallHit[] {
  return scoreWebHistory(useBrowserStore.getState().visitLog as unknown as VisitLogEntry[], query, limit);
}

/** Render recall hits as a provenance-tagged context block ('' if none). */
export function renderWebRecall(hits: WebRecallHit[]): string {
  if (!hits.length) return '';
  const lines = hits
    .map(h => `- "${h.title || h.url}" — ${h.url} (you visited ${new Date(h.timestamp).toLocaleDateString()})`)
    .join('\n');
  return `[FROM YOUR BROWSING HISTORY]\nPages the user actually read that look relevant here. These are sources they SAW — reference/link them, don't assert their contents as verified fact:\n${lines}`;
}
