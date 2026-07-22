// ─── Knowledge Library ────────────────────────────────────────────────────────
// One browsable model over the two knowledge systems that were previously separate surfaces:
// the graph (entities extracted from what was read) and the Knowledge Core (notes, memories and
// dossiers the user or agent wrote). The Knowledge panel showed only the former and searched only
// node labels, so saved notes were invisible there and searching for a phrase you remembered
// writing found nothing.
//
// Everything here is pure except the three `load*`/`search*` orchestrators at the bottom, so the
// shelving, matching, ranking and prompt-building rules are unit-testable without Tauri.

import { invoke } from '@tauri-apps/api/core';

/** Librarian shelves — how a person looks for something, not how the extractor labelled it. */
export type ShelfId = 'people' | 'topics' | 'things' | 'notes' | 'sources';

export const SHELVES: { id: ShelfId; label: string; blurb: string }[] = [
  { id: 'people',  label: 'People',  blurb: 'Everyone your agent has built a picture of' },
  { id: 'topics',  label: 'Topics',  blurb: 'Concepts and technologies that keep coming up' },
  { id: 'things',  label: 'Things',  blurb: 'Organizations, places and products' },
  { id: 'notes',   label: 'Notes',   blurb: 'What you and your agent have written down' },
  { id: 'sources', label: 'Sources', blurb: 'Pages and files that were read in' },
];

/**
 * Controlled vocabulary for node types (design §C). The extractor emits freeform strings, which is
 * why filters and colors only ever covered part of the graph; retyping a node offers this closed
 * set so a human correction always lands on a type the rest of the app understands.
 */
export const NODE_TYPE_VOCABULARY = [
  'person', 'org', 'place', 'product', 'project', 'event',
  'concept', 'technology', 'page', 'file', 'note', 'entity',
] as const;

export type NodeTypeVocabulary = typeof NODE_TYPE_VOCABULARY[number];

export interface LibraryItem {
  /** Graph node id for entities; file path for notes. Unique within a library. */
  id: string;
  kind: 'entity' | 'note';
  label: string;
  shelf: ShelfId;
  /** Raw graph node_type — entities only. */
  nodeType?: string;
  /** Knowledge Core path — notes only. */
  path?: string;
  sourceUrl?: string;
  /** Preview text: note body opening, or a search snippet. */
  snippet?: string;
  /** Degree in the graph — entities only. */
  connections?: number;
  /** Alternate names folded in by a merge; also matched during search. */
  aliases?: string[];
  /** A curated entity has been confirmed by the user and is never auto-rewritten. */
  curated?: boolean;
  /** Relevance from semantic search, when the item came from a query. */
  score?: number;
}

// ── Shelving ────────────────────────────────────────────────────────────────

const PEOPLE_TYPES = new Set(['person']);
const TOPIC_TYPES = new Set(['concept', 'technology', 'topic', 'skill']);
const THING_TYPES = new Set(['org', 'organization', 'place', 'product', 'project', 'event', 'entity']);
const SOURCE_TYPES = new Set(['page', 'file', 'url', 'document']);

/** Map a raw graph node_type onto the shelf a person would look on. Unknown types are "things" —
 * visible on a real shelf rather than dumped in an "other" bucket nobody opens. */
export function shelfForNodeType(nodeType: string | undefined): ShelfId {
  const t = String(nodeType ?? '').toLowerCase().trim();
  if (PEOPLE_TYPES.has(t)) return 'people';
  if (TOPIC_TYPES.has(t)) return 'topics';
  if (SOURCE_TYPES.has(t)) return 'sources';
  if (t === 'note' || t === 'memory') return 'notes';
  if (THING_TYPES.has(t)) return 'things';
  return 'things';
}

/** Words that begin an utterance rather than a name. A label opening with one of these is something
 *  the user *said*, not something that exists. */
const UTTERANCE_OPENERS = new Set([
  'i', 'you', 'we', 'it', 'ok', 'okay', 'hmm', 'um', 'well', 'no', 'yes', 'yeah', 'nope',
  'do', 'can', 'could', 'would', 'should', 'maybe', 'let', 'lets', "let's", 'what', 'why',
  'how', 'when', 'where', 'who', 'so', 'and', 'but', 'if', 'is', 'are', 'was', 'please',
  'thanks', 'thank', 'oh', 'also', 'just', 'actually', 'wait',
]);

/** The width `titleFromText` (memoryGatekeeper.ts) truncates to. A label at exactly this length was
 *  almost certainly cut mid-sentence rather than being a genuinely long name. */
const TITLE_TRUNCATION_WIDTH = 80;

/**
 * Is this label a *thing* rather than something someone said?
 *
 * The graph's entire content was chat fragments — "Do it", "Ok is it too late though", "Hmm so in
 * baldur's gate, I am playing a dark urge draw and was going to play red" — because every saved
 * memory minted a node labelled with `titleFromText`, the first sentence of the user's message.
 * Entities have names; utterances have grammar. This gate is the difference, and it is pure so the
 * junk it must reject can be pinned down in tests.
 *
 * Deliberately conservative in one direction: it is far better to drop a real entity (the next
 * mention re-adds it) than to admit a sentence, which is permanent visual noise on a shelf.
 */
export function isEntityLabel(label: string): boolean {
  const raw = String(label ?? '').trim();
  if (!raw) return false;

  // A truncated title is a sentence that ran past the cut, never a name.
  if (raw.length >= TITLE_TRUNCATION_WIDTH) return false;

  // Sentence-terminal punctuation, or the ellipsis left by truncation.
  if (/[.!?]|…|\.\.\./.test(raw)) return false;

  // Commas and semicolons join clauses; names don't need them. ("Alexander Layton, PhD" is a rare
  // enough shape to lose.)
  if (/[;,]/.test(raw)) return false;

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;

  const first = words[0].toLowerCase().replace(/[^a-z']/g, '');
  if (UTTERANCE_OPENERS.has(first)) return false;

  // Must contain at least one letter — bare numbers and punctuation aren't entities.
  if (!/[a-z]/i.test(raw)) return false;

  return true;
}

// ── Note parsing ────────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\s*/;

/** Pull a single scalar out of YAML frontmatter without a YAML dependency. Frontmatter here is
 * machine-written by the gatekeeper (memoryGatekeeper.ts), so the shapes are known and narrow. */
export function frontmatterValue(content: string, key: string): string | undefined {
  const fm = FRONTMATTER_RE.exec(content ?? '');
  if (!fm) return undefined;
  const line = fm[1].split(/\r?\n/).find(l => l.trimStart().startsWith(`${key}:`));
  if (!line) return undefined;
  const raw = line.slice(line.indexOf(':') + 1).trim();
  // Strip surrounding quotes and unescape the two sequences yamlString() escapes.
  const unquoted = /^"([\s\S]*)"$/.exec(raw)?.[1] ?? /^'([\s\S]*)'$/.exec(raw)?.[1] ?? raw;
  return unquoted.replace(/\\"/g, '"').replace(/\\\\/g, '\\') || undefined;
}

/** Body with frontmatter and the leading `# Title` heading removed. */
export function noteBody(content: string): string {
  return String(content ?? '')
    .replace(FRONTMATTER_RE, '')
    .replace(/^\s*#\s+.*(\r?\n)+/, '')
    .trim();
}

/** Display title: frontmatter title, else first heading, else the filename. */
export function noteTitle(content: string, fallbackName = ''): string {
  const fm = frontmatterValue(content, 'title');
  if (fm) return fm;
  const heading = /^\s*#\s+(.+)$/m.exec(String(content ?? '').replace(FRONTMATTER_RE, ''));
  if (heading) return heading[1].trim();
  const firstLine = noteBody(content).split(/\r?\n/).find(l => l.trim());
  return (firstLine ?? fallbackName).replace(/^[#>*\-\s]+/, '').trim().slice(0, 80) || fallbackName;
}

/** One-paragraph preview of a note, with markdown scaffolding flattened so cards read as prose. */
export function noteSnippet(content: string, max = 180): string {
  const body = noteBody(content)
    .replace(/^Gatekeeper reason:.*$/gim, '')   // internal bookkeeping, not user-facing
    .replace(/^##+\s*/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return body.length > max ? `${body.slice(0, max).trimEnd()}…` : body;
}

// ── Entity metadata ─────────────────────────────────────────────────────────

/** Read the curation fields off a node's metadata_json. This blob is written by the LLM extractor
 * as well as by the user, so every field is validated rather than trusted. */
export function parseNodeMetadata(metadataJson: string | undefined): { aliases: string[]; curated: boolean; dossierPath?: string } {
  try {
    const meta = JSON.parse(metadataJson || '{}');
    const aliases = Array.isArray(meta?.aliases)
      ? meta.aliases.filter((a: unknown): a is string => typeof a === 'string' && !!a.trim()).slice(0, 50)
      : [];
    const raw = typeof meta?.dossier_path === 'string' ? meta.dossier_path.trim() : '';
    const dossierPath = /^(people|entities)\/[A-Za-z0-9._-]+\.md$/.test(raw) && !raw.includes('..') ? raw : undefined;
    return { aliases, curated: meta?.curated === true, dossierPath };
  } catch {
    return { aliases: [], curated: false };
  }
}

// ── Building the library ────────────────────────────────────────────────────

export interface GraphNodeLike {
  id: string;
  label: string;
  node_type: string;
  source_url?: string;
  source_path?: string;
  metadata_json?: string;
}
export interface GraphEdgeLike { source: string | { id: string }; target: string | { id: string }; relation?: string }

const endpointId = (e: string | { id: string }): string =>
  typeof e === 'string' ? e : String((e as { id: string })?.id ?? e);

/** Degree per node id, counting each edge once at both ends. */
export function degreeMap(edges: GraphEdgeLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of edges ?? []) {
    const s = endpointId(e.source);
    const t = endpointId(e.target);
    map.set(s, (map.get(s) ?? 0) + 1);
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  return map;
}

export function buildEntityItems(nodes: GraphNodeLike[], edges: GraphEdgeLike[]): LibraryItem[] {
  const degrees = degreeMap(edges);
  return (nodes ?? []).map(n => {
    const { aliases, curated } = parseNodeMetadata(n.metadata_json);
    return {
      id: n.id,
      kind: 'entity' as const,
      label: n.label,
      shelf: shelfForNodeType(n.node_type),
      nodeType: n.node_type,
      sourceUrl: n.source_url,
      connections: degrees.get(n.id) ?? 0,
      aliases,
      curated,
    };
  });
}

export interface NoteFile { path: string; name: string; content?: string }

/** A file that records where it came from is a source, not a note. Web captures written by
 *  pageDigest carry `source: "https://…"` in frontmatter; gatekeeper memories never do. Routing on
 *  the field rather than the directory keeps this true for any future writer that records origin. */
function shelfForNoteFile(content: string | undefined): ShelfId {
  const src = frontmatterValue(content ?? '', 'source');
  return src && /^https?:\/\//i.test(src) ? 'sources' : 'notes';
}

export function buildNoteItems(files: NoteFile[]): LibraryItem[] {
  return (files ?? []).map(f => ({
    id: f.path,
    kind: 'note' as const,
    label: noteTitle(f.content ?? '', f.name),
    shelf: shelfForNoteFile(f.content),
    path: f.path,
    snippet: f.content ? noteSnippet(f.content) : undefined,
  }));
}

// ── Search & ranking ────────────────────────────────────────────────────────

const normalize = (s: string) => String(s ?? '').toLowerCase().trim();

/** Local match for entities: label or any alias. Aliases matter because merging duplicates folds
 * the old names in, and users search with the name they remember. */
export function matchesQuery(item: LibraryItem, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  if (normalize(item.label).includes(q)) return true;
  if (item.aliases?.some(a => normalize(a).includes(q))) return true;
  return normalize(item.snippet ?? '').includes(q);
}

/** Rank within a shelf: exact label match first, then relevance score, then connectedness, then
 * alphabetically so an unsorted tail never looks random. */
export function rankItems(items: LibraryItem[], query = ''): LibraryItem[] {
  const q = normalize(query);
  return [...items].sort((a, b) => {
    if (q) {
      const aExact = normalize(a.label) === q ? 1 : 0;
      const bExact = normalize(b.label) === q ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      const aStarts = normalize(a.label).startsWith(q) ? 1 : 0;
      const bStarts = normalize(b.label).startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
    }
    if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
    if ((b.connections ?? 0) !== (a.connections ?? 0)) return (b.connections ?? 0) - (a.connections ?? 0);
    return a.label.localeCompare(b.label);
  });
}

export function groupByShelf(items: LibraryItem[]): Record<ShelfId, LibraryItem[]> {
  const out: Record<ShelfId, LibraryItem[]> = { people: [], topics: [], things: [], notes: [], sources: [] };
  for (const item of items ?? []) out[item.shelf]?.push(item);
  return out;
}

export interface RagHitLike { path: string; title: string; snippet: string; score: number }

/**
 * Fold semantic search hits into the library. A hit that matches a note already on the shelf
 * upgrades it (better snippet + score) rather than appearing twice; a hit for a file that wasn't
 * in the listing — a dossier, a library document — joins as a new note item. This is what makes
 * searching for a phrase you wrote actually find the note containing it.
 */
export function mergeSearchHits(items: LibraryItem[], hits: RagHitLike[]): LibraryItem[] {
  const byPath = new Map<string, LibraryItem>();
  for (const item of items) if (item.path) byPath.set(item.path, item);

  const merged = [...items];
  for (const hit of hits ?? []) {
    if (!hit?.path) continue;
    const existing = byPath.get(hit.path);
    if (existing) {
      existing.snippet = hit.snippet || existing.snippet;
      existing.score = Math.max(existing.score ?? 0, hit.score ?? 0);
      continue;
    }
    const item: LibraryItem = {
      id: hit.path,
      kind: 'note',
      label: hit.title || hit.path.split('/').pop() || 'Untitled',
      shelf: 'notes',
      path: hit.path,
      snippet: hit.snippet,
      score: hit.score,
    };
    byPath.set(hit.path, item);
    merged.push(item);
  }
  return merged;
}

// ── Chat launch ─────────────────────────────────────────────────────────────

/**
 * Labels, titles and snippets originate in LLM extraction over web pages and in files that may
 * have been dropped in from anywhere, so they are DATA, not trusted prompt text. Collapse to one
 * line, drop backticks/braces that could open a code or template context, and cap the length.
 */
export function sanitizeForPrompt(text: string, max = 120): string {
  return String(text ?? '')
    .replace(/[\r\n`{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The prompt behind "Start a chat about this" — the point of the library is to get you into a
 * conversation about something you saved, not to admire the collection. */
export function buildTopicChatPrompt(item: Pick<LibraryItem, 'kind' | 'label' | 'nodeType' | 'path' | 'sourceUrl'>): string {
  const label = sanitizeForPrompt(item.label);
  if (!label) return '';
  if (item.kind === 'note') {
    const path = /^[\w./\- ]+$/.test(item.path ?? '') ? item.path : '';
    const where = path ? ` (saved at ${path})` : '';
    return `Let's talk about my note "${label}"${where}. Remind me what it says, then help me think it through — what follows from it, and what am I missing?`;
  }
  const kindWord = item.nodeType && /^[a-z]+$/i.test(item.nodeType) ? item.nodeType.toLowerCase() : 'topic';
  const url = /^https?:\/\/[^\s]+$/i.test(item.sourceUrl ?? '') ? (item.sourceUrl as string).slice(0, 300) : '';
  const origin = url ? ` I first came across it at ${url}.` : '';
  return `Let's talk about ${label} (${kindWord}).${origin} Tell me everything you already know about it from my knowledge base, then what's worth digging into next.`;
}

// ── Orchestrators (IPC) ─────────────────────────────────────────────────────

const isTauri = () => !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

/**
 * Load every saved note the user can browse: agent memory, plus the curated dossiers that
 * Phase 0 made visible. Contents are read so cards can show a real preview — capped, because this
 * runs on panel open and a large Knowledge Core would otherwise mean hundreds of reads.
 */
export async function loadNoteItems(
  agentId?: string | null,
  spaceId?: string | null,
  maxRead = 120,
): Promise<LibraryItem[]> {
  if (!isTauri()) return [];
  // `agentId: null` was the whole bug. Rust declares `agent_id: String` (non-optional) with
  // `space_id: Option<String>`, so null failed to deserialize, the command errored, and the
  // `.catch` below turned that into an empty list — an empty Notes shelf with no trace of why, for
  // weeks. Without a space it would have scanned `memory/<agent_id>/`, which doesn't exist either;
  // the real files live under `memory/spaces/<space>/gatekeeper/`. appliedMemory.ts:170 always had
  // this right. Errors are logged now rather than swallowed, so the next signature drift is visible.
  const listed = await Promise.all([
    invoke<{ files: NoteFile[] }>('list_agent_memory_files', {
      agentId: agentId ?? 'default',
      spaceId: spaceId || undefined,
    }).catch((e) => { console.warn('[knowledgeLibrary] list_agent_memory_files failed:', e); return { files: [] }; }),
    invoke<{ files: NoteFile[] }>('list_dossier_files')
      .catch((e) => { console.warn('[knowledgeLibrary] list_dossier_files failed:', e); return { files: [] }; }),
    // Bookmarked library saves and dropped documents.
    invoke<{ files: NoteFile[] }>('list_library_files')
      .catch((e) => { console.warn('[knowledgeLibrary] list_library_files failed:', e); return { files: [] }; }),
  ]);

  const seen = new Set<string>();
  const files: NoteFile[] = [];
  for (const f of listed.flatMap(r => r.files ?? [])) {
    if (!f?.path || seen.has(f.path)) continue;
    seen.add(f.path);
    files.push(f);
  }

  const head = files.slice(0, maxRead);
  const contents = await Promise.all(
    head.map(f => invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path: f.path })
      .then(r => (r?.ok ? r.content : ''))
      .catch(() => ''))
  );
  const withContent = head.map((f, i) => ({ ...f, content: contents[i] }));
  return buildNoteItems([...withContent, ...files.slice(maxRead)]);
}

/** Semantic search over note + dossier CONTENT — the part plain label filtering could never do. */
export async function searchNoteContent(query: string, agentId?: string | null, maxResults = 12): Promise<RagHitLike[]> {
  const q = (query ?? '').trim();
  if (q.length < 2 || !isTauri()) return [];
  try {
    const res = await invoke<{ results: RagHitLike[] }>('search_knowledge_semantic', {
      query: q, agentId: agentId ?? null, maxResults, snippetChars: 220,
    });
    return res?.results ?? [];
  } catch {
    return [];
  }
}
