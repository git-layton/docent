import { invoke } from '@tauri-apps/api/core';
import { generateTextResponse } from './llm';
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

export function generatePageNodeId(url: string): string {
  const slug = url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) >>> 0;
  }
  return `page-${slug}-${hash.toString(16)}`;
}

interface RawExtraction {
  entities?: Array<{ id: string; type: string; label: string }>;
  relations?: Array<{ source: string; target: string; relation: string }>;
}

function parseExtraction(raw: string): RawExtraction {
  const stripped = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  return JSON.parse(stripped.slice(start, end + 1));
}

export async function extractAndWriteGraph(opts: {
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  pageNodeId: string;
  modelId: string;
  modelConfig?: Record<string, unknown>;
  agentForgePath: string;
}): Promise<ExtractedGraph> {
  const { text, sourceUrl, sourceTitle, pageNodeId, modelId, modelConfig } = opts;

  const trimmedText = text.slice(0, 4000);
  const prompt = buildEntityExtractionPrompt(trimmedText, sourceTitle, sourceUrl);

  const resolvedConfig = modelConfig ?? { modelId, provider: 'openai', contextLimit: 32000 };

  let raw = '';
  try {
    raw = await generateTextResponse({
      messages: [{ id: `graph-extract-${Date.now()}`, role: 'user', content: prompt }],
      modelConfig: resolvedConfig,
      agent: { prompt: 'You are a knowledge graph extraction assistant. Return only valid JSON.', tools: {}, trainingDocs: [] },
      profile: '',
      tasks: [],
      attachedDocs: [],
      agentPinnedMessages: [],
      mode: 'text',
      canvasContent: null,
      isDeepThinking: false,
      onChunk: null,
      signal: null,
      appSettings: {},
      integrations: {},
      models: [],
    });
  } catch (err) {
    console.error('[graphEntityExtractor] AI call failed:', err);
    return { nodes: [], edges: [] };
  }

  let extraction: RawExtraction;
  try {
    extraction = parseExtraction(raw);
  } catch (err) {
    console.error('[graphEntityExtractor] JSON parse failed:', err, '\nRaw:', raw.slice(0, 200));
    return { nodes: [], edges: [] };
  }

  const entities = Array.isArray(extraction.entities) ? extraction.entities : [];
  const relations = Array.isArray(extraction.relations) ? extraction.relations : [];

  const entityIds = new Set(entities.map(e => e.id));

  const nodes: ExtractedGraph['nodes'] = [];
  const edges: ExtractedGraph['edges'] = [];

  for (const entity of entities) {
    if (!entity.id || !entity.type || !entity.label) continue;
    nodes.push({ id: entity.id, type: entity.type, label: entity.label });

    try {
      // TODO: requires Unit 7 graph backend
      await invoke('upsert_graph_node', {
        id: entity.id,
        nodeType: entity.type,
        label: entity.label,
        sourceUrl,
      });
    } catch (err) {
      console.error(`[graphEntityExtractor] upsert_graph_node failed for "${entity.id}":`, err);
    }

    edges.push({ sourceId: entity.id, targetId: pageNodeId, relation: 'appears_in' });
    try {
      // TODO: requires Unit 7 graph backend
      await invoke('upsert_graph_edge', {
        id: `${entity.id}-appears_in-${pageNodeId}`,
        sourceId: entity.id,
        targetId: pageNodeId,
        relation: 'appears_in',
        weight: 1.0,
      });
    } catch (err) {
      console.error(`[graphEntityExtractor] upsert_graph_edge (appears_in) failed for "${entity.id}":`, err);
    }
  }

  for (const rel of relations) {
    if (!rel.source || !rel.target || !rel.relation) continue;
    if (!entityIds.has(rel.source) || !entityIds.has(rel.target)) continue;

    edges.push({ sourceId: rel.source, targetId: rel.target, relation: rel.relation });
    try {
      // TODO: requires Unit 7 graph backend
      await invoke('upsert_graph_edge', {
        id: `${rel.source}-${rel.relation}-${rel.target}`,
        sourceId: rel.source,
        targetId: rel.target,
        relation: rel.relation,
        weight: 1.0,
      });
    } catch (err) {
      console.error(`[graphEntityExtractor] upsert_graph_edge failed for "${rel.source}->${rel.target}":`, err);
    }
  }

  return { nodes, edges };
}
