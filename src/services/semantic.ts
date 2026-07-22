import { NODE_TYPE_VOCABULARY, RELATION_VOCABULARY } from './knowledgeLibrary';

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
    { "id": "<slug using only lowercase letters, digits, hyphens>", "type": "<${NODE_TYPE_VOCABULARY.join('|')}>", "label": "<display name>" }
  ],
  "relations": [
    { "source": "<entity id>", "target": "<entity id>", "relation": "<${RELATION_VOCABULARY.join('|')}>" }
  ]
}

Rules:
- EXTRACT THINGS THAT HAVE NAMES. A person, an organization, a place, a product, a technology, a
  named concept. If you could not point at it and say what it is called, it is not an entity.
- NEVER turn a sentence, question, instruction or opinion into an entity. "Baldur's Gate 3" and
  "Dark Urge" are entities; "Do it", "Ok is it too late though" and "Maybe you can create a note
  for me" are things somebody said, and must not appear at all.
- A label is a name, not a phrase: no trailing punctuation, no more than about six words.
- "type" MUST be one of: ${NODE_TYPE_VOCABULARY.join(', ')}.
- "relation" MUST be one of: ${RELATION_VOCABULARY.join(', ')}. Pick the closest one; use
  related_to when nothing else fits. Do not invent verbs.
- Only include relations where both source and target appear in the entities array.
- Keep ids as short slugs, e.g. "openai", "sam-altman", "san-francisco".
- Return at most 30 entities and 40 relations.
- If the text contains no real named entities, return {"entities": [], "relations": []}. Returning
  nothing is correct and expected for ordinary conversation.
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
