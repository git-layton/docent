export interface ResearchSource {
  title: string;
  url?: string;
  path?: string;
  snippet?: string;
  text?: string;
}

export const hasResearchIntent = (input: string) => {
  const lower = input.toLowerCase();
  return /\b(search|research|look up|source|sources|verify|fact check|fact-check|current|latest|news|today|evidence|cite|citation|web)\b/.test(lower);
};

export const extractSearchQuery = (input: string) => {
  const cleaned = input
    .replace(/https?:\/\/\S+/g, ' ')
    // Strip a leading politeness / framing clause so we search the SUBJECT, not the way the user
    // phrased the ask ("Hey Alexis, can you please look up X" → "X"). The greeting strip requires a
    // trailing comma so it can never eat a real first word ("what is the weather" stays intact).
    .replace(/^\s*(hey|hi|hello|ok|okay|yo)\b[^,]*,\s*/i, ' ')
    .replace(/^\s*(can|could|would|will)\s+you\s+(please\s+)?/i, ' ')
    .replace(/^\s*i\s+(want|need|would like|wanna)\s+(you\s+)?to\s+/i, ' ')
    .replace(/^\s*please\s+/i, ' ')
    .replace(/\b(search for|search|research|look up|google|find sources for|find|who is|what is|tell me about|show me|browse to|browse|go to|navigate to|verify|fact check|fact-check)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || input.trim();
};

export const extractUrls = (input: string) =>
  Array.from(new Set(input.match(/https?:\/\/[^\s)]+/g) ?? []));

export const dedupeSources = (sources: ResearchSource[]) => {
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const source of sources) {
    const key = (source.url || source.path || source.title).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
};

export const buildSourceNotes = (sources: ResearchSource[], maxChars = 1800) => {
  if (sources.length === 0) return 'No sources were found.';
  return sources.map((source, index) => {
    const body = (source.text || source.snippet || '').replace(/\s+/g, ' ').trim();
    const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}...` : body;
    return `[${index + 1}] ${source.title}\nURL: ${source.url ?? source.path ?? 'local'}\nExcerpt: ${clipped || '(no excerpt available)'}`;
  }).join('\n\n---\n\n');
};

export const slugify = (value: string, fallback = 'note') => {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || fallback;
};
