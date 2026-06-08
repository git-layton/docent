export interface SemanticFactHit {
  fact: string;
  subject?: string;
  predicate?: string;
  object?: string;
  title: string;
  path: string;
  scope: string;
  evidenceState?: string;
  verification?: string;
  confidence?: string;
  score?: number;
}

export interface SemanticEntityHit {
  name: string;
  kind: string;
  title: string;
  path: string;
  scope: string;
  evidenceState?: string;
  confidence?: string;
  score?: number;
}

export interface SemanticRelationHit {
  source: string;
  relation: string;
  target: string;
  title: string;
  path: string;
  scope: string;
  evidenceState?: string;
  confidence?: string;
  score?: number;
}

export interface SemanticDocumentHit {
  title: string;
  path: string;
  scope: string;
  type?: string;
  sourceKind?: string;
  evidenceState?: string;
  verification?: string;
  confidence?: string;
  tags?: string;
  score?: number;
}

export interface SemanticLayerResult {
  documents?: SemanticDocumentHit[];
  entities?: SemanticEntityHit[];
  facts?: SemanticFactHit[];
  relations?: SemanticRelationHit[];
  error?: string;
}

const stateLabel = (value?: string) => (value || 'unknown').replace(/_/g, ' ');

const citeLocal = (hit: { title?: string; path?: string }) =>
  hit.title ? `[[${hit.title}]]` : hit.path || 'local memory';

export const hasSemanticHits = (result?: SemanticLayerResult | null) =>
  Boolean(
    result
    && ((result.facts?.length ?? 0) > 0
      || (result.relations?.length ?? 0) > 0
      || (result.entities?.length ?? 0) > 0
      || (result.documents?.length ?? 0) > 0)
  );

export function buildEntityExtractionPrompt(text: string, sourceTitle: string, sourceUrl: string): string {
  return `Extract named entities and relations from the following text. Return ONLY valid JSON — no prose, no markdown, no code fences.

Source: "${sourceTitle}" (${sourceUrl})

Text:
${text}

JSON schema to follow exactly:
{
  "entities": [
    { "id": "<slug using only lowercase letters, digits, hyphens>", "type": "<person|org|place|product|concept|technology>", "label": "<display name>" }
  ],
  "relations": [
    { "source": "<entity id>", "target": "<entity id>", "relation": "<verb phrase, e.g. created|is-a|located-in|founded|uses|part-of>" }
  ]
}

Rules:
- Extract people, organizations, places, products, concepts, and technologies.
- Only include relations where both source and target appear in the entities array.
- Keep ids as short slugs, e.g. "openai", "sam-altman", "san-francisco".
- Return at most 30 entities and 40 relations.
- Output nothing except the JSON object.`;
}

export const buildSemanticMemoryNotes = (result: SemanticLayerResult, maxPerSection = 8) => {
  if (!hasSemanticHits(result)) return 'No semantic memory facts, entities, or relations matched.';

  const sections: string[] = [];

  if (result.facts?.length) {
    sections.push(`Facts:\n${result.facts.slice(0, maxPerSection).map(hit =>
      `- ${hit.fact} (${citeLocal(hit)}; evidence: ${stateLabel(hit.evidenceState)}; verification: ${stateLabel(hit.verification)}; confidence: ${stateLabel(hit.confidence)})`
    ).join('\n')}`);
  }

  if (result.relations?.length) {
    sections.push(`Relations:\n${result.relations.slice(0, maxPerSection).map(hit =>
      `- ${hit.source} --${hit.relation}--> ${hit.target} (${citeLocal(hit)}; evidence: ${stateLabel(hit.evidenceState)}; confidence: ${stateLabel(hit.confidence)})`
    ).join('\n')}`);
  }

  if (result.entities?.length) {
    sections.push(`Entities:\n${result.entities.slice(0, maxPerSection).map(hit =>
      `- ${hit.name} [${hit.kind}] (${citeLocal(hit)}; scope: ${hit.scope}; confidence: ${stateLabel(hit.confidence)})`
    ).join('\n')}`);
  }

  if (result.documents?.length) {
    sections.push(`Relevant Grounded Documents:\n${result.documents.slice(0, Math.min(4, maxPerSection)).map(hit =>
      `- ${hit.title} (${hit.scope}/${hit.type || 'note'}; evidence: ${stateLabel(hit.evidenceState)}; verification: ${stateLabel(hit.verification)})`
    ).join('\n')}`);
  }

  return sections.join('\n\n');
};
