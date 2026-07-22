import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { generateStructuredResponse, salvageArray, toWireSchema } from './structured';
import { buildEntityExtractionPrompt } from './semantic';

export interface ExtractedGraph {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
  }>;
  edges: Array<{
    sourceId: string;
    targetId: string;
    relation: string;
  }>;
}

// Skip extraction on fragments too short to contain real entities, and cap what a runaway model
// can write in one pass (each entity/relation is its own IPC upsert).
const MIN_EXTRACTION_CHARS = 200;
const MAX_ENTITIES = 40;
const MAX_RELATIONS = 60;

export function generateNodeId(prefix: string, key: string): string {
  const slug = key
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) >>> 0;
  }
  return `${prefix}-${slug}-${hash.toString(16)}`;
}

export function generatePageNodeId(url: string): string {
  return generateNodeId('page', url);
}

// ── Direct upserts (no LLM) ─────────────────────────────────────────────────
// The backend requires metadataJson and enforces edge FKs (source/target nodes must exist first).
// Both helpers swallow errors: the graph is a best-effort mirror, never a failure path for the
// ingestion that triggered it.

export async function upsertGraphNode(node: {
  id: string;
  nodeType: string;
  label: string;
  sourceUrl?: string;
  sourcePath?: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await invoke('upsert_graph_node', {
      id: node.id,
      nodeType: node.nodeType,
      label: node.label,
      sourceUrl: node.sourceUrl ?? null,
      sourcePath: node.sourcePath ?? null,
      metadataJson: JSON.stringify(node.metadata ?? {}),
    });
    return true;
  } catch (err) {
    console.warn(`[graph] upsert_graph_node failed for "${node.id}":`, err);
    return false;
  }
}

export async function upsertGraphEdge(edge: {
  sourceId: string;
  targetId: string;
  relation: string;
  weight?: number;
}): Promise<boolean> {
  try {
    await invoke('upsert_graph_edge', {
      id: `${edge.sourceId}-${edge.relation}-${edge.targetId}`,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relation: edge.relation,
      weight: edge.weight ?? 1.0,
      metadataJson: '{}',
    });
    return true;
  } catch (err) {
    console.warn(`[graph] upsert_graph_edge failed for "${edge.sourceId}->${edge.targetId}":`, err);
    return false;
  }
}

interface BatchNode {
  id: string;
  nodeType: string;
  label: string;
  sourceUrl?: string;
  sourcePath?: string;
  /** JSON object merged into the node's existing metadata (backend patches, never clobbers). */
  metadataJson?: string;
}

interface BatchEdge {
  sourceId: string;
  targetId: string;
  relation: string;
  weight?: number;
  metadataJson?: string;
}

// One transactional write for a whole extraction (nodes then edges) instead of dozens of separate
// IPC round-trips. Best-effort: a backend failure is logged, never thrown.
export async function upsertGraphBatch(nodes: BatchNode[], edges: BatchEdge[]): Promise<boolean> {
  if (nodes.length === 0 && edges.length === 0) return true;
  try {
    await invoke('upsert_graph_batch', {
      nodes: nodes.map(n => ({
        id: n.id,
        nodeType: n.nodeType,
        label: n.label,
        sourceUrl: n.sourceUrl ?? null,
        sourcePath: n.sourcePath ?? null,
        metadataJson: n.metadataJson ?? '{}',
      })),
      edges: edges.map(e => ({
        id: `${e.sourceId}-${e.relation}-${e.targetId}`,
        sourceId: e.sourceId,
        targetId: e.targetId,
        relation: e.relation,
        weight: e.weight ?? 1.0,
        metadataJson: e.metadataJson ?? '{}',
      })),
    });
    return true;
  } catch (err) {
    console.warn('[graph] upsert_graph_batch failed:', err);
    return false;
  }
}

// ── LLM extraction pipeline ─────────────────────────────────────────────────

const EntitySchema = z.object({
  id: z.coerce.string().min(1),
  type: z.string().catch('entity'),
  label: z.coerce.string().min(1),
});
const RelationSchema = z.object({
  source: z.coerce.string().min(1),
  target: z.coerce.string().min(1),
  relation: z.string().catch('related_to'),
});
// Wire: strict shape guiding the grammar. Validation: each entity/relation salvaged individually.
const ExtractionWireSchema = z.object({ entities: z.array(EntitySchema), relations: z.array(RelationSchema) });
const ExtractionSchema = z.object({
  entities: salvageArray(EntitySchema),
  relations: salvageArray(RelationSchema),
});

function sanitizeEntityId(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function extractAndWriteGraph(opts: {
  text: string;
  sourceTitle: string;
  sourceNodeId: string;
  /** 'page' | 'file' | 'note' — what kind of thing the entities were extracted from. */
  sourceNodeType?: string;
  sourceUrl?: string;
  sourcePath?: string;
  modelConfig: Record<string, unknown>;
}): Promise<ExtractedGraph> {
  const { text, sourceTitle, sourceNodeId, sourceNodeType = 'page', sourceUrl, sourcePath, modelConfig } = opts;

  const sourceNode: BatchNode = {
    id: sourceNodeId,
    nodeType: sourceNodeType,
    label: sourceTitle || sourceUrl || sourcePath || sourceNodeId,
    sourceUrl,
    sourcePath,
  };

  // Always record the source node itself, even when extraction is skipped or fails — the graph
  // should at least show what was ingested. It must also exist before any appears_in edge (FK); the
  // batch below inserts nodes before edges, so ordering holds inside the transaction.
  //
  // Written unconditionally, BEFORE any early return, because this comment used to promise an
  // invariant the code didn't keep: the upsert sat inside the short-text branch only, so the
  // `!extraction` bail below returned having written nothing. pageDigest passes
  // `modelConfig: (modelConfig ?? {})`, which makes the structured call throw whenever no model is
  // configured — caught, null, silent return. That is why 22 saved page digests produced ZERO
  // `page` nodes in a database created before the oldest of them. Any early return past this point
  // must still leave the source node behind.
  await upsertGraphNode(sourceNode);

  if (text.trim().length < MIN_EXTRACTION_CHARS) {
    return { nodes: [], edges: [] };
  }

  const prompt = buildEntityExtractionPrompt(text.slice(0, 4000), sourceTitle, sourceUrl ?? sourcePath ?? '');

  const extraction = await generateStructuredResponse({
    schema: ExtractionSchema,
    wireSchema: toWireSchema(ExtractionWireSchema),
    schemaName: 'entity_extraction',
    system: 'You are a knowledge graph extraction assistant. Return only valid JSON.',
    user: prompt,
    modelConfig: modelConfig as any,
  }).catch((err) => {
    console.warn('[graphEntityExtractor] AI call failed:', err);
    return null;
  });
  if (!extraction) return { nodes: [], edges: [] };

  const entities = extraction.entities.slice(0, MAX_ENTITIES);
  const relations = extraction.relations.slice(0, MAX_RELATIONS);

  const nodes: ExtractedGraph['nodes'] = [];
  const edges: ExtractedGraph['edges'] = [];
  const writtenIds = new Set<string>();

  // Source node leads the batch so the appears_in edges resolve against it inside the transaction.
  const batchNodes: BatchNode[] = [sourceNode];
  const batchEdges: BatchEdge[] = [];

  for (const entity of entities) {
    const id = sanitizeEntityId(entity.id);
    const label = String(entity.label ?? '').trim();
    if (!id || !label || writtenIds.has(id)) continue;
    const type = sanitizeEntityId(entity.type) || 'entity';

    writtenIds.add(id);
    nodes.push({ id, type, label });
    batchNodes.push({ id, nodeType: type, label, sourceUrl, sourcePath });
    edges.push({ sourceId: id, targetId: sourceNodeId, relation: 'appears_in' });
    batchEdges.push({ sourceId: id, targetId: sourceNodeId, relation: 'appears_in' });
  }

  for (const rel of relations) {
    const source = sanitizeEntityId(rel.source);
    const target = sanitizeEntityId(rel.target);
    const relation = String(rel.relation ?? '').trim();
    if (!source || !target || !relation) continue;
    // Both endpoints must have been written this pass — the FK would reject dangling edges anyway.
    if (!writtenIds.has(source) || !writtenIds.has(target)) continue;

    edges.push({ sourceId: source, targetId: target, relation });
    batchEdges.push({ sourceId: source, targetId: target, relation });
  }

  await upsertGraphBatch(batchNodes, batchEdges);

  return { nodes, edges };
}
