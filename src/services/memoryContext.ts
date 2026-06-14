// Layered agent memory — the research-backed shape (MemGPT-style tiers + Generative-Agents
// relevance retrieval; the dream cycle is the RAPTOR-style consolidation that keeps Tier 1 small):
//
//   Tier 1 — a compact, ALWAYS-injected digest of the agent's consolidated memory files. Cheap
//            (cached); this is the persistent "what I've learned" the agent carries every turn.
//   Tier 2 — PER-TURN semantic retrieval over the Knowledge Core, injected only for hits above a
//            relevance cutoff (avoids the noise/cost of dumping everything — cf. "Lost in the Middle").
//
// Writing/consolidation ("knowing how to learn") already lives in the MEMS gatekeeper
// (contextEvaluator) + the dream cycle; this module is the READ path into the agent's context.

import { invoke } from '@tauri-apps/api/core';

interface MemFile { path: string; name: string }
export interface RagHit { path: string; title: string; snippet: string; score: number }

const TIER1_BUDGET = 2000;     // chars of always-on memory digest
const TIER1_PER_FILE = 400;    // chars taken from each memory file
const TIER2_MIN_SCORE = 0.35;  // cosine-sim cutoff for per-turn injection (Rust already pre-filters >0.25)
const TIER2_MAX = 4;           // max retrieved snippets injected per turn

const isTauri = () => !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

// Tier-1 cache — memory files only change on a save or a dream-cycle run, so a short TTL is plenty.
let _tier1: { agentId: string; at: number; text: string } | null = null;
let _now = () => Date.now();

/** Tier 1 — compact digest of the agent's consolidated memory files. Always injected; cached ~2 min. */
export async function loadMemorySummary(agentId: string | null | undefined): Promise<string> {
  if (!agentId || !isTauri()) return '';
  if (_tier1 && _tier1.agentId === agentId && _now() - _tier1.at < 120_000) return _tier1.text;
  try {
    const listed = await invoke<{ files: MemFile[] }>('list_agent_memory_files', { agentId });
    const files = listed?.files ?? [];
    let text = '';
    for (const f of files) {
      if (text.length >= TIER1_BUDGET) break;
      const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path: f.path })
        .catch(() => ({ ok: false, content: '' }));
      if (read?.ok && read.content) {
        const body = read.content.replace(/^---[\s\S]*?---\s*/, '').trim(); // strip frontmatter
        text += `• ${f.name.replace(/\.md$/, '')}: ${body.slice(0, TIER1_PER_FILE)}\n`;
      }
    }
    text = text.slice(0, TIER1_BUDGET).trim();
    _tier1 = { agentId, at: _now(), text };
    return text;
  } catch {
    return '';
  }
}

/** Drop the Tier-1 cache (call after a dream cycle or memory write so it re-reads). */
export function invalidateMemorySummary() { _tier1 = null; }

/** PURE — filter ranked hits to the relevant top-K and format them for the prompt. Unit-tested. */
export function formatRelevantHits(hits: RagHit[], minScore = TIER2_MIN_SCORE, max = TIER2_MAX): string {
  const kept = (hits ?? []).filter(h => (h?.score ?? 0) >= minScore).slice(0, max);
  return kept.length ? kept.map((h, i) => `[${i + 1}] ${h.title}\n${h.snippet}`).join('\n\n') : '';
}

/** Tier 2 — per-turn semantic retrieval, gated to the most relevant hits. */
export async function retrieveRelevantMemory(query: string, agentId: string | null | undefined): Promise<string> {
  const q = (query || '').trim();
  if (q.length < 4 || !isTauri()) return '';
  try {
    const res = await invoke<{ results: RagHit[] }>('search_knowledge_semantic', {
      query: q, agentId: agentId ?? null, maxResults: 8, snippetChars: 400,
    });
    return formatRelevantHits(res?.results ?? []);
  } catch {
    return '';
  }
}

// Test seam — lets unit tests pin time for the cache without a real clock.
export const __setNowForTests = (fn: () => number) => { _now = fn; };
