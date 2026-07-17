// The "AI answer" half of search: given the user's query and the local hits we already ranked,
// stream a short, grounded answer into the omni-bar. Reuses the same generateTextResponse path as
// the chat composer (so it's provider-agnostic + Tauri-fetch aware) with a search-tuned agent and
// the local hits handed in as grounding context — never the embedder, so it can't collide with the
// semantic-index work.
//
// Transparency contract: the model must open with a machine-readable `BASIS:` line saying whether
// the answer is grounded in the user's data, general knowledge, or unsure. The tag is parsed and
// stripped DETERMINISTICALLY (never shown); the UI renders it as a badge. A missing/garbled tag
// degrades to basis "unknown" — the answer still streams, only the badge is withheld.

import { generateTextResponse } from './llm';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { searchWebHistory, renderWebRecall } from './webHistory';
import type { SearchDoc } from './universalSearch';

const SEARCH_ASSISTANT_PROMPT = [
  "You are the search assistant inside Forge, the user's personal command center on their Mac.",
  'The user just typed a query into the global search bar.',
  'Your reply MUST start with a single line stating your basis, then the answer on the next line:',
  "BASIS: grounded — when the answer comes from the user's own items shown under [WHAT THE USER IS LOOKING AT] or [FROM YOUR BROWSING HISTORY].",
  'BASIS: general — when their data does not cover it and you are answering from general knowledge.',
  'BASIS: unsure — when you cannot answer confidently either way.',
  'After the BASIS line, answer directly in 1–3 short sentences — no preamble, no "I found", no restating the question.',
  'When their items are relevant, ground the answer in them and reference them by name as [[Title]].',
  'Never emit code blocks, action blocks, JSON, or task/event blocks here — only the BASIS line and a short plain answer.',
].join(' ');

export type AnswerBasis = 'grounded' | 'general' | 'unsure' | 'unknown';

export interface QuickAnswerOpts {
  onChunk: (chunk: string) => void;
  /** Fired once, as soon as the BASIS line resolves (or is given up on). */
  onBasis?: (basis: AnswerBasis) => void;
  signal?: AbortSignal;
  /** Only feed global browsing history into the answer when the search scope allows it (global Home).
      A space-scoped search must NOT leak pages the user read outside that space. */
  includeWebHistory?: boolean;
}

const BASIS_LINE_RE = /^\s*BASIS:\s*(grounded|general|unsure)\b[^\n]*/i;

/** Streaming filter that swallows the leading `BASIS: …` line, reports it, and forwards the rest.
 * Deterministic and fail-soft: anything that doesn't look like a BASIS line streams through
 * untouched with basis "unknown". Exported for unit tests. */
export function createBasisFilter(onChunk: (c: string) => void, onBasis?: (b: AnswerBasis) => void) {
  let buffer = '';
  let resolved = false;

  const resolve = (basis: AnswerBasis, rest: string) => {
    resolved = true;
    onBasis?.(basis);
    const text = rest.replace(/^\n+/, '');
    if (text) onChunk(text);
  };

  const push = (chunk: string) => {
    if (resolved) { if (chunk) onChunk(chunk); return; }
    buffer += chunk;
    const nl = buffer.indexOf('\n');
    if (nl !== -1) {
      const first = buffer.slice(0, nl);
      const m = first.match(BASIS_LINE_RE);
      if (m) resolve(m[1].toLowerCase() as AnswerBasis, buffer.slice(nl + 1));
      else resolve('unknown', buffer);
    } else if (buffer.length > 48 && !/^\s*BASIS:/i.test(buffer)) {
      // Long enough to know it isn't a BASIS line — stop holding the stream back.
      resolve('unknown', buffer);
    }
  };

  /** Call after the stream ends — handles a reply that never contained a newline. */
  const flush = () => {
    if (resolved) return;
    const m = buffer.match(BASIS_LINE_RE);
    if (m) resolve(m[1].toLowerCase() as AnswerBasis, buffer.slice(m[0].length));
    else resolve('unknown', buffer);
  };

  return { push, flush };
}

/** Strip a leading BASIS line from a completed answer (mirror of the streaming filter). */
export function stripBasisLine(text: string): string {
  return String(text ?? '').replace(/^\s*BASIS:\s*(grounded|general|unsure)\b[^\n]*\n?/i, '').trim();
}

/** True when search has a usable model configured — callers can skip the AI answer cheaply otherwise. */
export function hasSearchModel(): boolean {
  const { models, selectedModelId } = useSettingsStore.getState();
  return !!(models.find((m) => m.id === selectedModelId) ?? models[0]);
}

/** Stream a short, grounded answer for `query`. Resolves to the display text (BASIS line already
 * stripped); throws AbortError if cancelled. */
export async function quickSearchAnswer(query: string, hits: SearchDoc[], opts: QuickAnswerOpts): Promise<string> {
  const { models, selectedModelId, integrations, appSettings } = useSettingsStore.getState();
  const modelConfig = models.find((m) => m.id === selectedModelId) ?? models[0];
  if (!modelConfig) throw new Error('No model configured for search.');

  // Real content, not just titles: the hit's body (doc text, task details, message text) is what
  // lets the model actually answer from the user's data instead of guessing from its weights.
  // Snippets share the hardware-scaled RAG budget the knowledge-search capability uses.
  const snippetChars = useUIStore.getState().hwProfile?.rag_snippet_chars ?? 400;
  const grounding = hits
    .slice(0, 6)
    .map((h) => {
      const head = `- (${h.kind}) ${h.title}${h.sub ? ` — ${h.sub}` : ''}`;
      const body = String(h.body ?? '').replace(/\s+/g, ' ').trim().slice(0, snippetChars);
      return body ? `${head}\n  ${body}` : head;
    })
    .join('\n');

  // Scope-gated: a space search never grounds its answer in pages read outside that space.
  const webRecall = opts.includeWebHistory ? renderWebRecall(searchWebHistory(query, 4)) : '';

  const filter = createBasisFilter(opts.onChunk, opts.onBasis);
  const raw = await generateTextResponse({
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
    onChunk: filter.push,
    signal: opts.signal,
    appSettings,
    integrations,
    models,
    toolContext: grounding ? { label: 'your search results', text: grounding } : undefined,
    webRecall,
  });
  filter.flush();
  return stripBasisLine(raw);
}
