# People Directory — Design

Status: **proposed, questions resolved** · Author: pairing session · Date: 2026-07-14
Scope: the AI builds a **model of each person the user references** — so "Taylor" means something
the second time she comes up — browsable as a People section of the Knowledge Base.
The guiding idea: **people are learned from reference, not imported.** Say "Taylor" in a chat and
a person model starts accumulating; the directory is the view over those models. Linking a person
to a macOS Contacts card is an optional, later enrichment — identity attaches to knowledge, not
the other way around.

> The problem this solves: agents struggle with *who people are*. "Taylor" in a prompt is just a
> token — the model has no idea she's the user's sister / coworker / landlord, what was said about
> her last week, or which of three Taylors is meant. Today that context lives (if anywhere) diluted
> across general memory files.
>
> Builds on three existing systems: the knowledge graph (`graph_nodes` already has a `person` node
> type emitted by the LLM extractor), the Knowledge Core (`~/AgentForge/` markdown + semantic
> index + Tier-2 retrieval in `memoryContext.ts`), and the memory gatekeeper
> (`memoryGatekeeper.ts`, which already decides which conversational facts are worth persisting).

---

## 1. Goals / non-goals

**Goals**
- G1 — *Learn people from reference*: mention Taylor in conversation and a person model is created
  and grows — who she is to the user, facts stated about her, what she's involved in. No setup.
- G2 — *Recall on re-reference*: the next time Taylor comes up, her model is in context — the agent
  knows who she is without being re-told.
- G3 — *Browsable directory*: open Knowledge → People, see everyone the AI has a model of; click
  a person, see the whole model — the dossier, plus every graph connection (pages, notes, chats
  they appear in).
- G4 — *User-ownable*: the model of a person is a plain markdown file the user can read, edit, or
  delete. Correcting the AI's picture of someone is a text edit, not a data operation.
- G5 — *Identity is optional*: everything above works with zero Address Book involvement. Linking
  a person to a Contacts card (handles, photo, org) is a per-person, user-initiated action, later.

**Non-goals (for now)**
- No Address Book **import** — no bulk sync, no interaction scanning, no contact browsing in-app.
  (An earlier draft of this design led with that; deliberately walked back — it solved identity,
  not the actual problem, which is knowledge.)
- No writes to macOS Contacts, ever (consistent with the standing "two-way sync is unsafe"
  decision — see feedback-backlog.md).
- No CRM features — reminders, relationship scoring, interaction analytics.
- No enrichment lookups (LinkedIn etc.). The model of a person comes from what the *user* says and
  the documents the *user* brings in.

---

## 2. The arc (how the pieces compose)

```
user references a person in chat            LLM entity extraction (existing)
  "Taylor said the venue fell through"        person nodes from pages/notes/files
        │                                             │
        ▼                                             │
  memoryGatekeeper person-routing (§4)                │
        │ fact worth keeping, about a person          │
        ▼                                             ▼
  dossier file  ~/AgentForge/people/taylor.md ──► graph_nodes (person)
        │            one file = one person         + appears_in / same_as edges
        │                                                 │
        ▼                                                 ▼
  semantic index (existing file watcher)          People directory
        │                                         (KnowledgeGraphPanel mode, §6)
        ▼                                                 │
  Tier-2 retrieval → next "Taylor" mention        click → dossier sidebar
  lands with her model in context (§5)            "everything I know about Taylor"
```

---

## 3. Data model

**Dossier file — the person model.** One markdown file per person at
`~/AgentForge/people/<slug>.md`. This *is* the model of Taylor:

```markdown
---
person: person-taylor-8f3a2c
aka: [Tay]
relation: sister
---
# Taylor
- User's sister; lives in Portland.
- Planning her wedding for Oct 2026 — venue fell through July 2026, looking at backups.
- Prefers texts over calls.
```

Because it lives in the Knowledge Core, the **existing** file watcher indexes it and the
**existing** Tier-2 retrieval injects it — person recall (G2) needs no new injection machinery.
Structured header stays minimal: node id, aliases, one `relation` line. Everything else is prose;
the model reads it, the user can edit it (G4).

**Person node** — reuse `graph_nodes` with `node_type = 'person'`, no new table. The dossier-backed
node is canonical; `metadata_json` gains `{ "dossierPath": "people/taylor.md", "aka": ["Tay"] }`.
Node id via existing `generateNodeId('person', slug)`. Extracted person nodes from
`graphEntityExtractor.ts` (pages/files/notes) stay as-is and link to canonical nodes via `same_as`
edges — non-destructive, so a bad link is one edge-delete to undo.

**Contact link (later, per-person)** — when the user links Taylor to a Contacts card (§7), identity
fields land in `metadata_json` (`abUid`, `emails`, `phones`, photo ref). Identity is *attached to*
the model; the model never depends on it.

---

## 4. Building the model (the new core)

The write path rides the memory gatekeeper, which already inspects conversation for facts worth
persisting. It gains **person-routing**:

1. **Detect** — when a gatekeeper-approved fact is *about a person* (named human referent in the
   fact itself: "Taylor's venue fell through", "Marcus is our new PM"), route it to a dossier
   instead of a general memory file.
2. **Resolve the name** — match against existing dossiers by name + `aka` aliases (normalized).
   - Unique match → append the fact to that dossier.
   - No match → create a stub dossier (`# Taylor` + the fact). First mention is enough; no
     ceremony, no prompt to the user. A person you mention once and never again is one small file.
   - Multiple matches (two Taylors) → append to neither; write to general memory with a
     disambiguation marker, and the dossier sidebar shows an "unassigned mentions" queue. The
     agent may also just ask in-chat ("Taylor your sister, or Taylor from Acme?") when the current
     conversation needs the distinction — the answer becomes an `aka`/relation update.
3. **Append, don't rewrite** — facts accumulate as date-stamped bullets (`- (2026-07) Venue fell
   through…`). The stamp costs nothing now and is what makes later supersede logic possible — the
   temporal-memory systems in this space (Zep/Graphiti) all carry validity dates on facts for
   exactly this reason. Consolidation (dedupe, supersede "venue fell through" with "booked backup
   venue") is a later dreamer pass, gated behind `dreamAutoEnabled` like all background rewriting.
4. **Show a quiet receipt** — when a dossier is created or updated, the assistant message gets a
   small dismissible chip ("📇 Taylor") that opens the dossier. Never a toast or interruption. See
   §10-Q2 for why this beats fully-silent.

Relationship context ("my sister") is the highest-value single fact — when detected, it fills the
`relation` frontmatter line, which the retrieval snippet leads with. "Taylor — user's sister" in
context is most of the battle.

## 5. Recall

- **Passive (free)** — Tier-2 semantic retrieval over the Knowledge Core already fires per-turn;
  a "Taylor" mention scores her dossier into context. Nothing to build beyond §3/§4.
- **Name-hit boost** — semantic similarity on a bare first name is noisy, so add a cheap exact
  pass: tokenize the outgoing user message, match capitalized tokens against dossier names/`aka`;
  a hit injects that dossier directly (bypassing the score cutoff), capped at 2 per turn.
- **Handle-aware boost (only after a contact link, §7)** — replying to Taylor in Messages/Mail
  resolves her handle → person → dossier, injected by construction.

---

## 6. Directory UI

A **People** mode of the Knowledge Graph panel, not a new panel:

- The panel's type filter chips gain `People`; selecting it switches from force-graph to an
  alphabetical **directory list** (initials avatar, relation line, fact count, last-updated). The
  graph is one toggle away, filtered to person nodes and their neighborhoods.
- **Dossier sidebar** (extends the existing node-detail sidebar):
  - *Header*: name, relation, aliases; source badge if contact-linked.
  - *What I know*: the dossier markdown, rendered and editable in place (G4).
  - *Connections*: grouped edges — pages/notes/files where they appear (`appears_in` via
    `same_as`), linked chats.
  - *Unassigned mentions* queue when name resolution was ambiguous (§4.2).
  - *Actions*: "Ask about Taylor" (existing `onSendPrompt` wiring); "Link to Contacts…" (§7).
- **OmniSearch**: person hits get a row (initials + relation) that jumps to the dossier.

## 7. Address Book: link, don't import (later phase)

Deliberately demoted from the earlier draft. When it lands:

- **Per-person, user-initiated**: a "Link to Contacts…" action in the dossier sidebar opens a
  search over the Address Book (the reader in `imessage.rs` already parses
  `AddressBook-v22.abcddb` under existing Full Disk Access — promote it to a shared `contacts.rs`
  and extend it to return org/photo/birthday). Picking a card attaches identity to the person node.
- **What linking buys**: real name/photo in the directory, handle-aware injection in Messages/Mail
  threads (§5), and handle-based disambiguation between same-named people.
- **Still read-only, still no bulk import.** The directory never contains a person the user hasn't
  referenced or explicitly added.

---

## 8. Privacy stance

- A person model exists only because the user talked about that person to their own local AI; it's
  a local markdown file, inspectable and deletable (delete = node + edges via existing cascade,
  plus offer to delete the dossier).
- Only gatekeeper-approved *facts* land in dossiers — never transcript excerpts wholesale.
- Nothing leaves the machine except what retrieval injects into the model the user is already
  talking to — the same trust boundary as memories today.
- Address Book (when linked): read-only, per-person, visible in the Mac permissions hub.

## 9. Phasing

- **P1 — the model loop**: gatekeeper person-routing + dossier files + stub creation, `people/`
  under the Knowledge Core index, name-hit injection boost. (Recall works before any UI exists.)
- **P2 — the directory**: People chip + list view, dossier sidebar with edit-in-place, graph
  `same_as` linking of extracted person nodes, OmniSearch rows, disambiguation queue.
- **P3 — identity + polish**: "Link to Contacts…" per-person linking via `contacts.rs`,
  handle-aware injection, dreamer dossier consolidation (gated behind `dreamAutoEnabled`).

## 10. Resolved questions (researched 2026-07-14)

Surveyed the current agent-memory landscape (Mem0, Zep/Graphiti, Letta, ChatGPT memory UX) to
settle the v1 open questions:

- **Q1 — Person-routing detection: LLM tags, with a deterministic fast path.** Every serious
  memory system LLM-extracts facts/entities (Mem0's entity extractor + relations generator,
  Graphiti's LLM node/edge extraction); nobody regexes this. The gatekeeper is already an LLM
  call — add a `person` referent field to its output schema. But *name resolution* (matching the
  tag to a dossier) follows Graphiti's pattern: deterministic exact match on normalized
  name/aliases first, LLM only for ambiguity — never an extra model call on the happy path.
- **Q2 — Announce: quiet receipt, not silent.** Flipped from the earlier lean. The industry moved
  *toward* visibility — ChatGPT added "Memory updated" indicators, then inspectable memory
  summaries, then per-response source listing with inline correction — and research on its memory
  found ~96% of entries were written without any user command, which is precisely the trust
  problem invisible accumulation creates. Building a dossier on a *named third person* is more
  sensitive than remembering a preference, so silent is the wrong default. Decision: a small
  dismissible chip on the message ("📇 Taylor", §4.4) that opens the dossier — visible, one click
  to inspect/correct (the editable dossier *is* the correction affordance), never interrupting.
- **Q3 — Stub hygiene: keep forever, date-stamp everything.** Temporal metadata on facts
  (valid-at/invalid-at) is the load-bearing feature of Zep/Graphiti; our cheap version is the
  date-stamped bullet (§4.3), which gives the future dreamer pass enough to supersede or archive.
  No archival policy until stale stubs are an observed problem — a once-mentioned person is one
  tiny file.
- **Q4 — The "me" card stays separate.** Across the landscape, the user's own profile is a
  distinct memory type from third-person entity memory (Letta's dedicated human block, ChatGPT's
  profile vs. entity facts) — the injection policy differs (always-on vs. on-reference), which is
  the real reason not to unify. Profile knowledge stays in ProfileSettingsModal / Tier-1; no
  person node for "me".
