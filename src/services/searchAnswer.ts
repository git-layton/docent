// The "AI answer" half of search: given the user's query and the local hits we already ranked,
// stream a short, grounded answer into the omni-bar. Reuses the same generateTextResponse path as
// the chat composer (so it's provider-agnostic + Tauri-fetch aware) with a search-tuned agent and
// the local hits handed in as grounding context — never the embedder, so it can't collide with the
// semantic-index work.

import { generateTextResponse } from './llm';
import { useSettingsStore } from '../store/useSettingsStore';
import { searchWebHistory, renderWebRecall } from './webHistory';
import type { SearchDoc } from './universalSearch';

const SEARCH_ASSISTANT_PROMPT = [
  "You are the search assistant inside Forge, the user's personal command center on their Mac.",
  'The user just typed a query into the global search bar. Answer directly in 1–3 short sentences —',
  "no preamble, no \"I found\", no restating the question.",
  'Ground the answer in the user\'s own items shown under [WHAT THE USER IS LOOKING AT] and',
  '[FROM YOUR BROWSING HISTORY] when they are relevant, and reference those items by name as [[Title]].',
  "If their data doesn't cover it, answer briefly from general knowledge and say so in a few words;",
  "if you're unsure, say so plainly.",
  'Never emit code blocks, action blocks, JSON, or task/event blocks here — only a short plain answer.',
].join(' ');

export interface QuickAnswerOpts {
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
  /** Only feed global browsing history into the answer when the search scope allows it (global Home).
      A space-scoped search must NOT leak pages the user read outside that space. */
  includeWebHistory?: boolean;
}

/** True when search has a usable model configured — callers can skip the AI answer cheaply otherwise. */
export function hasSearchModel(): boolean {
  const { models, selectedModelId } = useSettingsStore.getState();
  return !!(models.find((m) => m.id === selectedModelId) ?? models[0]);
}

/** Stream a short, grounded answer for `query`. Resolves to the full text; throws AbortError if cancelled. */
export async function quickSearchAnswer(query: string, hits: SearchDoc[], opts: QuickAnswerOpts): Promise<string> {
  const { models, selectedModelId, integrations, appSettings } = useSettingsStore.getState();
  const modelConfig = models.find((m) => m.id === selectedModelId) ?? models[0];
  if (!modelConfig) throw new Error('No model configured for search.');

  const grounding = hits
    .slice(0, 6)
    .map((h) => `- (${h.kind}) ${h.title}${h.sub ? ` — ${h.sub}` : ''}`)
    .join('\n');

  // Scope-gated: a space search never grounds its answer in pages read outside that space.
  const webRecall = opts.includeWebHistory ? renderWebRecall(searchWebHistory(query, 4)) : '';

  return generateTextResponse({
    messages: [{ role: 'user', content: query }],
    modelConfig,
    agent: { tools: {}, prompt: SEARCH_ASSISTANT_PROMPT },
    profile: '',
    attachedDocs: [],
    tasks: [],
    mode: 'text',
    canvasContent: null,
    isDeepThinking: false,
    agentPinnedMessages: [],
    onChunk: opts.onChunk,
    signal: opts.signal,
    appSettings,
    integrations,
    models,
    toolContext: grounding ? { label: 'your search results', text: grounding } : undefined,
    webRecall,
  });
}
