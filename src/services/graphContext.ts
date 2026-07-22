import { invoke } from '@tauri-apps/api/core';
import { parseNodeMetadata } from './knowledgeLibrary';

/**
 * Tier 2½ — inject what the graph knows about entities the user just named.
 *
 * The graph was write-only. Entities, relations and every extraction were stored and *visualized*,
 * but no caller outside the two UI panels ever read them, so the agent never consulted any of it
 * when answering. It was a picture, not a memory system — and all the curation work upstream (one
 * node per thing, a closed vocabulary, real entities instead of chat fragments) paid no rent at all
 * until something read it back.
 *
 * This is that read. When a message names something the graph knows, its 1-hop neighbourhood goes
 * into the prompt: what it is, and what it is connected to.
 *
 * Budgeted like the tier it sits beside — 2 entities, ~600 chars — because context is the scarcest
 * resource in the app and a graph that grows unboundedly must not grow the prompt with it. A node
 * with 200 edges contributes the same as one with 3.
 */

const MAX_ENTITIES = 2;
const MAX_RELATIONS_PER_ENTITY = 6;
const BUDGET_CHARS = 600;
/** Below this, a "match" is coincidence — "it", "the app", "a note". */
const MIN_LABEL_CHARS = 4;

const isTauri = () => typeof window !== 'undefined' && !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

interface GraphNodeRow {
  id: string;
  label: string;
  node_type: string;
  metadata_json?: string;
}
interface GraphEdgeRow {
  source_id?: string;
  target_id?: string;
  source?: string;
  target?: string;
  relation?: string;
}

/** Cached node list. Rebuilt on demand; cheap to drop because the graph is small and local. */
let _nodes: GraphNodeRow[] | null = null;

/** Call after any graph write so the next turn matches against current labels. */
export function invalidateGraphContext() { _nodes = null; }

async function loadNodes(): Promise<GraphNodeRow[]> {
  if (_nodes) return _nodes;
  try {
    const g = await invoke<{ nodes: GraphNodeRow[] }>('get_graph_full');
    _nodes = g?.nodes ?? [];
  } catch {
    _nodes = [];
  }
  return _nodes;
}

const normalize = (s: string) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * PURE — which known entities does this message name?
 *
 * Longest label first, so "Baldur's Gate 3" wins over a "Gate" node rather than both matching and
 * the more specific one losing its slot to the vaguer one.
 */
export function matchEntities(
  message: string,
  nodes: Array<{ id: string; label: string; node_type: string; aliases?: string[] }>,
  max = MAX_ENTITIES,
): Array<{ id: string; label: string; node_type: string }> {
  const hay = ` ${normalize(message)} `;
  if (hay.trim().length < MIN_LABEL_CHARS) return [];

  const candidates: Array<{ id: string; label: string; node_type: string; len: number }> = [];
  for (const n of nodes ?? []) {
    // A node's own label, plus any name folded into it by a merge.
    const names = [n.label, ...(n.aliases ?? [])].filter(Boolean);
    for (const name of names) {
      const norm = normalize(name);
      if (norm.length < MIN_LABEL_CHARS) continue;
      if (hay.includes(` ${norm} `)) {
        candidates.push({ id: n.id, label: n.label, node_type: n.node_type, len: norm.length });
        break;
      }
    }
  }
  candidates.sort((a, b) => b.len - a.len);

  const seen = new Set<string>();
  const out: Array<{ id: string; label: string; node_type: string }> = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, label: c.label, node_type: c.node_type });
    if (out.length >= max) break;
  }
  return out;
}

/** PURE — render matched entities and their relations into a prompt block, within budget. */
export function formatGraphContext(
  entries: Array<{ label: string; node_type: string; relations: string[]; summary?: string }>,
  budget = BUDGET_CHARS,
): string {
  if (!entries?.length) return '';
  const lines: string[] = [];
  for (const e of entries) {
    let line = `• ${e.label} (${e.node_type})`;
    if (e.summary) line += ` — ${e.summary}`;
    if (e.relations.length) line += `\n  connected to: ${e.relations.slice(0, MAX_RELATIONS_PER_ENTITY).join(', ')}`;
    lines.push(line);
  }
  return lines.join('\n').slice(0, budget).trim();
}

/**
 * Look up what the graph knows about entities named in this message.
 * Returns '' when nothing matches, which is the common case and costs one cached list scan.
 */
export async function retrieveGraphContext(message: string): Promise<string> {
  if (!isTauri()) return '';
  const q = (message || '').trim();
  if (q.length < MIN_LABEL_CHARS) return '';

  try {
    const nodes = await loadNodes();
    if (nodes.length === 0) return '';

    const withAliases = nodes.map(n => ({
      id: n.id,
      label: n.label,
      node_type: n.node_type,
      aliases: parseNodeMetadata(n.metadata_json).aliases,
    }));
    const matched = matchEntities(q, withAliases);
    if (matched.length === 0) return '';

    const byId = new Map(nodes.map(n => [n.id, n]));
    const entries = [];
    for (const m of matched) {
      let relations: string[] = [];
      try {
        const sub = await invoke<{ nodes: GraphNodeRow[]; edges: GraphEdgeRow[] }>(
          'get_graph_neighbors', { nodeId: m.id, maxDepth: 1 },
        );
        const labelOf = (id?: string) =>
          (sub?.nodes ?? []).find(n => n.id === id)?.label ?? byId.get(id ?? '')?.label ?? '';
        relations = (sub?.edges ?? [])
          .map(e => {
            const src = e.source_id ?? e.source;
            const tgt = e.target_id ?? e.target;
            const other = src === m.id ? tgt : src;
            const otherLabel = labelOf(other);
            if (!otherLabel) return '';
            return `${String(e.relation ?? 'related_to').replace(/_/g, ' ')} ${otherLabel}`;
          })
          .filter(Boolean)
          .slice(0, MAX_RELATIONS_PER_ENTITY);
      } catch {
        // A neighbour lookup failing shouldn't cost the entity its line — the label and type alone
        // are still worth knowing.
      }
      // No summary yet: dossiers (and the `## Summary` this would carry) arrive with Track 4's
      // enrichment. Until then a node contributes its name, type and connections, which is already
      // the difference between "who is Taylor?" being answerable and not.
      entries.push({ label: m.label, node_type: m.node_type, relations });
    }
    return formatGraphContext(entries);
  } catch {
    return '';
  }
}
