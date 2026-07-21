// ─── The Librarian Charter ───────────────────────────────────────────────────
// Curation rules as DATA, not code. The dream cycle already knew how to consolidate files; what it
// lacked was a standard to consolidate them toward — so its judgement drifted with the prompt and
// the user had no way to say "no, this is how I want my knowledge kept."
//
// The charter is a markdown file at ~/AgentForge/charter/librarian.md. It is seeded once from the
// default below, then belongs to the user: editing that file changes how the dreamer curates, the
// same way a playbook is a procedure the user can read and rewrite. Nothing here is enforced by
// code — these are instructions injected into the Dreamer's system prompt.
//
// The rules are drawn from how archives and libraries actually keep collections usable: authority
// control (one record per entity, variant names cross-referenced), controlled vocabulary,
// provenance, appraisal, and the principle that findability is the whole point of description.

import { invoke } from '@tauri-apps/api/core';

export const CHARTER_PATH = 'charter/librarian.md';

/** Cap what a user-edited charter can inject into every dream prompt — the file is user-owned, but
 * an accidentally pasted novel should not crowd out the memory files being curated. */
const MAX_CHARTER_CHARS = 6000;

export const DEFAULT_LIBRARIAN_CHARTER = `# Librarian Charter

How this knowledge base is kept. These are the standards the Dreamer curates toward. Edit this
file to change them — it is read at the start of every dream cycle.

## 1. Authority control — one thing, one record

Every distinct person, place, organization or concept gets exactly ONE record. When the same thing
appears under several names, pick the fullest proper form as the label and keep the others as
aliases rather than deleting them — someone searching for the old name must still find the record.

- Prefer "Alexandra Layton" over "Alex" over "alex-layton" as the label.
- Never merge two things that merely share a name. Two different Taylors stay two records.
- A record confirmed by the user is authoritative: do not rename, retype or absorb it.

## 2. Controlled vocabulary

Describe things with the shared vocabulary, not with new words invented per document. Consistency
is what makes browsing and filtering work at all.

- Types: person, org, place, product, project, event, concept, technology, page, file, note.
- Relations: prefer an existing relation over a new synonym — works_at, part_of, created_by,
  located_in, appears_in, related_to. "employed_by" and "works for" both mean works_at.

## 3. Provenance — no fact without a source

Every claim keeps a pointer back to where it came from. When records are combined, the merged
record carries the union of their sources; nothing loses its origin by being tidied.

- Cite the file path or URL a fact came from.
- Distinguish what the user SAID from what was INFERRED. Inferred claims are marked as such.
- Never state something with more confidence than its source supports.

## 4. Observation is not belief

A thing mentioned once in a page that was read is an observation. A thing with a written record
about it is a belief. Do not promote the first into the second just because it recurs — promote it
when there is something worth saying about it.

## 5. Description earns its keep

A record exists to be found and understood. Write for the person who will read it in six months
with no memory of the conversation that produced it.

- Summaries are current, not append-only: rewrite the summary, don't stack updates under it.
- Fold dated log entries up into durable facts once they have settled.
- Resolve vague time references ("last week") into actual dates.

## 6. Appraisal — keep what has value

Not everything captured deserves to be kept. Retire what has no continuing value, but never
silently destroy something a person wrote.

- Completed to-do lists, superseded drafts and duplicate captures are candidates for archiving.
- Anything the user wrote or confirmed by hand is retained regardless of age.
- When in doubt, keep it. Archiving is reversible; judgement about someone else's memory is not.

## 7. Do no harm

The collection belongs to the user. Curation may reorganize and describe; it may not invent.

- Never fabricate a fact, a relationship, or a pattern the sources do not support.
- Never rewrite a user-authored record to fit a tidier structure.
- Prefer proposing a change over making one when the call is genuinely ambiguous.
`;

const isTauri = () => !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

/**
 * Read the charter, seeding the default on first run. A read failure is not fatal: the dreamer
 * falls back to the built-in default so curation quality never depends on the file existing.
 */
export async function loadLibrarianCharter(): Promise<string> {
  if (!isTauri()) return DEFAULT_LIBRARIAN_CHARTER;
  try {
    const res = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path: CHARTER_PATH });
    const existing = res?.ok ? (res.content ?? '').trim() : '';
    if (existing) return existing;
  } catch {
    // fall through to seeding
  }
  // Seed once so the user has something to open and edit. Best-effort — a failed write just means
  // we use the default in memory this run and try again next time.
  await invoke('write_memory', {
    path: CHARTER_PATH,
    content: DEFAULT_LIBRARIAN_CHARTER,
    commitMessage: 'charter: seed librarian curation standards',
    agentId: null,
  }).catch(() => {});
  return DEFAULT_LIBRARIAN_CHARTER;
}

/** Trim a user-edited charter down to what is safe to inject into every dream prompt. */
export function normalizeCharter(text: string): string {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return DEFAULT_LIBRARIAN_CHARTER;
  return trimmed.length > MAX_CHARTER_CHARS
    ? `${trimmed.slice(0, MAX_CHARTER_CHARS).trimEnd()}\n\n[charter truncated]`
    : trimmed;
}
