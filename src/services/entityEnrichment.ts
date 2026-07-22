import { invoke } from '@tauri-apps/api/core';
import { fetchWithRetry } from './llm';
import { parseNodeMetadata, frontmatterValue } from './knowledgeLibrary';
import { invalidateGraphContext } from './graphContext';

/**
 * Quiet background research: give the entities you actually talk about a dossier.
 *
 * The graph learns that "Baldur's Gate 3" exists and that it appears in three notes. It does not
 * know what it *is*. This fills that in from public sources, so the read path (graphContext) has
 * something to say beyond a name and a list of edges.
 *
 * The whole feature is shaped by one constraint: it spends the user's money and touches the network
 * without being asked, so every rule below is about earning that.
 *
 *  - NEVER researches a `person` node. Looking up the people in someone's private notes on the open
 *    web is a different product from the one this is. People are enrichable only by an explicit
 *    click on their own dossier.
 *  - NEVER researches anything whose sources are private. A node that only appears in memories
 *    marked `privacy: personal|sensitive` stays unresearched even if it is a company or a city.
 *  - Capped hard: 3 entities per run, 6h apart. This cannot become a crawler.
 *  - Silent. No toasts, no modals, no chat messages. It surfaces where the user already looks —
 *    the dossier itself, and the entity's card. Deliberately unlike the toast-per-save memory path:
 *    a thing that works while you're not looking must not demand you look.
 */

const MAX_PER_RUN = 3;
const MIN_DEGREE = 2;
const REENRICH_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const isTauri = () => typeof window !== 'undefined' && !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

export interface ResearchSource { title: string; url: string; snippet: string }

interface GraphNodeRow {
  id: string;
  label: string;
  node_type: string;
  source_path?: string;
  metadata_json?: string;
}
interface GraphEdgeRow { source_id?: string; target_id?: string; source?: string; target?: string }

/**
 * Public lookup for one entity.
 *
 * Wikipedia only, and that is a deliberate narrowing rather than laziness: it is keyless, so this
 * works on a fresh install with nothing configured; it is encyclopaedic, which is exactly the
 * register a dossier wants; and it does not bill the user per call. The keyed providers in
 * webSearchCapability are better for "what happened today" and worse for "what is this thing".
 */
export async function lookupEntity(label: string): Promise<ResearchSource[]> {
  const q = String(label ?? '').trim();
  if (!q) return [];
  try {
    const data = await fetchWithRetry(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json&origin=*`,
      { method: 'GET' },
      1,
    );
    const hits = data?.query?.search ?? [];
    return hits.slice(0, 3).map((s: any) => ({
      title: s.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(s.title).replace(/ /g, '_'))}`,
      snippet: String(s.snippet ?? '').replace(/<[^>]*>?/gm, '').trim(),
    }));
  } catch (e) {
    console.warn('[entityEnrichment] lookup failed:', e);
    return [];
  }
}

/** PURE — the dossier body. Every fact carries its source; a fact without provenance is a rumour. */
export function buildDossier(label: string, nodeType: string, sources: ResearchSource[], now = new Date()): string {
  const iso = now.toISOString();
  const facts = sources.length
    ? sources.map(s => `- ${s.snippet || s.title} [${s.url}]`).join('\n')
    : '- Nothing found in public sources yet.';
  return [
    '---',
    `title: "${label.replace(/"/g, '\\"')}"`,
    `type: ${nodeType}`,
    `created_at: "${iso}"`,
    `updated_at: "${iso}"`,
    'tags: [entity, researched]',
    `source_urls: [${sources.map(s => `"${s.url}"`).join(', ')}]`,
    'confidence: medium',
    '---',
    '',
    `# ${label}`,
    '',
    '## Summary',
    sources[0]?.snippet ? sources[0].snippet : `A ${nodeType} referenced in your notes. No public summary found yet.`,
    '',
    '## Facts',
    facts,
    '',
    '## Relationships',
    '_Mirrored from the knowledge graph._',
    '',
    '## Open questions',
    '- Is this the same one referenced in your notes? Researched from the name alone.',
    '',
    '## Log',
    `- ${iso.slice(0, 10)} — researched automatically from ${sources.length} public source(s).`,
    '',
  ].join('\n');
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'entity';

/**
 * PURE — is this node worth researching right now?
 *
 * Exported so the selection rules are testable without a graph, a network or a clock.
 */
export function isEnrichable(
  node: { node_type: string; metadata_json?: string },
  degree: number,
  now = Date.now(),
): boolean {
  // The consent boundary, first and non-negotiable.
  if (String(node.node_type).toLowerCase() === 'person') return false;

  const meta = parseNodeMetadata(node.metadata_json);
  if (meta.curated) return false;       // the user has taken ownership; don't overwrite their work
  if (meta.dossierPath) return false;   // already has one

  let enrichedAt = 0;
  try { enrichedAt = Number(JSON.parse(node.metadata_json || '{}')?.enriched_at ?? 0) || 0; } catch { /* absent */ }
  if (enrichedAt && now - enrichedAt < REENRICH_AFTER_MS) return false;

  // Something mentioned once might be a passing reference or an extraction mistake. Twice means it
  // matters to this user, which is the only signal worth spending a lookup on.
  return degree >= MIN_DEGREE;
}

/** Are ALL of this node's sources private? Then it stays unresearched. */
async function sourcesArePrivate(node: GraphNodeRow): Promise<boolean> {
  const path = node.source_path;
  if (!path) return false; // no known source — nothing private to protect
  try {
    const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path });
    if (!read?.ok) return false;
    const privacy = (frontmatterValue(read.content, 'privacy') ?? 'normal').toLowerCase();
    return privacy === 'personal' || privacy === 'sensitive';
  } catch {
    // Unreadable source: treat as private. Failing closed is the only safe direction when the
    // question is "may I put this on the internet".
    return true;
  }
}

export async function runEntityEnrichment(rootPath: string | null | undefined): Promise<number> {
  if (!isTauri() || !rootPath) return 0;
  try {
    const graph = await invoke<{ nodes: GraphNodeRow[]; edges: GraphEdgeRow[] }>('get_graph_full').catch(() => null);
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];
    if (nodes.length === 0) return 0;

    const degree = new Map<string, number>();
    for (const e of edges) {
      const s = e.source_id ?? e.source;
      const t = e.target_id ?? e.target;
      if (s) degree.set(s, (degree.get(s) ?? 0) + 1);
      if (t) degree.set(t, (degree.get(t) ?? 0) + 1);
    }

    const candidates = nodes
      .filter(n => isEnrichable(n, degree.get(n.id) ?? 0))
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

    let written = 0;
    for (const node of candidates) {
      if (written >= MAX_PER_RUN) break;
      if (await sourcesArePrivate(node)) continue;

      const sources = await lookupEntity(node.label);
      if (sources.length === 0) continue;

      const dossierPath = `${rootPath}/entities/${slugify(node.label)}.md`;
      const content = buildDossier(node.label, node.node_type, sources);
      const res = await invoke<{ blocked?: boolean }>('write_memory', {
        path: dossierPath,
        content,
        commitMessage: `research: ${node.label}`,
        agentId: null, contextTokens: null, ramState: null,
      }).catch(() => ({ blocked: true }));
      if (res?.blocked) continue;

      await invoke('update_graph_node', {
        id: node.id,
        metadataPatch: JSON.stringify({
          dossier_path: `entities/${slugify(node.label)}.md`,
          enriched_at: Date.now(),
        }),
      }).catch(() => {});
      written++;
    }

    if (written > 0) invalidateGraphContext();
    return written;
  } catch (e) {
    console.warn('[entityEnrichment] run failed:', e);
    return 0;
  }
}
