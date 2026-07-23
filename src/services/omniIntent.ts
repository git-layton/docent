// Omni-bar intent — lets the search bar be *aimed* rather than left to guess. There are four
// intents, each reachable two ways so the bar teaches its own shortcuts: click a chip, or type a
// one-character prefix at the start of the query. This module is pure and store-free, so it unit-
// tests in isolation and both <OmniSearch> and <StartPage> share one definition of what an intent
// is and how it parses.

export type OmniIntent = 'auto' | 'app' | 'web' | 'knowledge';

export interface IntentSpec {
  intent: OmniIntent;
  /** Chip label, and the "aim" badge shown once the bar is pointed at this intent. */
  label: string;
  /** One-character prefix that aims the bar when typed at the very start. 'auto' has none. */
  prefix?: string;
  /** Placeholder shown while the bar is aimed at this intent. */
  placeholder: string;
}

// Declaration order is also the Tab-cycle order (auto → app → web → knowledge → auto).
export const INTENTS: IntentSpec[] = [
  { intent: 'auto', label: 'All', placeholder: 'Search, or ask your agent…' },
  { intent: 'app', label: 'Apps', prefix: '>', placeholder: 'Jump to an app…' },
  { intent: 'web', label: 'Web', prefix: '?', placeholder: 'Search the web…' },
  { intent: 'knowledge', label: 'Knowledge', prefix: '#', placeholder: 'Search your knowledge…' },
];

const BY_INTENT = INTENTS.reduce<Record<OmniIntent, IntentSpec>>((acc, s) => {
  acc[s.intent] = s;
  return acc;
}, {} as Record<OmniIntent, IntentSpec>);

// Only the prefixed intents land here; 'auto' is the prefix-less fallback.
const BY_PREFIX = INTENTS.reduce<Record<string, OmniIntent>>((acc, s) => {
  if (s.prefix) acc[s.prefix] = s.intent;
  return acc;
}, {});

export function specFor(intent: OmniIntent): IntentSpec {
  return BY_INTENT[intent] ?? BY_INTENT.auto;
}

export interface ParsedIntent {
  /** True only when a leading prefix was recognized AND stripped. */
  hadPrefix: boolean;
  intent: OmniIntent;
  /** The query with any recognized prefix (and the space after it) removed. */
  text: string;
}

// A leading prefix is honored only when real text follows it, so a lone ">" mid-typing isn't
// treated as an empty app query — the user is still composing. When there's no prefix (or nothing
// after it) the bar stays 'auto' and the text passes through untouched.
export function parseIntent(query: string): ParsedIntent {
  const intent = BY_PREFIX[query.charAt(0)];
  if (intent) {
    const rest = query.slice(1);
    if (rest.trim().length > 0) {
      return { hadPrefix: true, intent, text: rest.replace(/^\s+/, '') };
    }
  }
  return { hadPrefix: false, intent: 'auto', text: query };
}

// Tab advances to the next intent in INTENTS order, wrapping back to the start.
export function cycleIntent(current: OmniIntent): OmniIntent {
  const i = INTENTS.findIndex((s) => s.intent === current);
  return INTENTS[(i + 1) % INTENTS.length].intent;
}

// Web-intent ↵ (and StartPage's onWebSearch) open a DuckDuckGo search for the typed text.
export function webSearchUrl(text: string): string {
  return `https://start.duckduckgo.com/?q=${encodeURIComponent(text.trim())}`;
}

// Very basic heuristic: if it contains no spaces and looks like a domain (e.g. "foo.com", "localhost:3000")
// or starts with http/https, we treat it as a URL intent.
export function isLikelyUrl(text: string): boolean {
  const t = text.trim();
  if (t.includes(' ')) return false;
  if (/^https?:\/\//i.test(t)) return true;
  // match things like newegg.com, 127.0.0.1:8080, localhost:3000
  if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(t)) return true;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/.test(t)) return true;
  return false;
}
