# Knowledge Graph Curation — Deep Review & Design

Status: **proposed** · Date: 2026-07-19
Scope: a deep review of the knowledge graph + notes system, and a design for making it
**editable**, giving notes **structure**, encoding **librarian best practices** as a curation
charter, and putting the **dream cycle to work** as the librarian.

> The instinct that prompted this: the graph accumulates but nobody tends it. It should be
> editable, notes should be structured, and there should be an explicit "how a librarian keeps
> this organized" discipline that the dream cycle applies continuously.

---

## 1. What exists today (the map)

Two knowledge systems live side by side:

| | Knowledge Core | Knowledge graph |
|---|---|---|
| Store | Markdown under `~/AgentForge/` (git-committed) | SQLite `graph_nodes` / `graph_edges` in `.index.db` |
| Written by | Gatekeeper saves, /memo, dream cycle, dossier editor | LLM entity extraction ([pageDigest.ts](../src/services/pageDigest.ts), [KnowledgeDropZone.tsx](../src/components/KnowledgeDropZone.tsx)); stub nodes per saved memory ([App.tsx:1480](../src/App.tsx)) |
| Read by | Tier-1 digest + Tier-2 RAG ([memoryContext.ts](../src/services/memoryContext.ts)), knowledge search capability | **Only the two UI panels** ([KnowledgeGraphPanel.tsx](../src/components/KnowledgeGraphPanel.tsx), [EntityDossierPage.tsx](../src/components/EntityDossierPage.tsx)) |
| Curated by | Dream cycle (merge/prune/update/insight/playbook_refine) | **Nobody** |

The only bridge between them is the dossier page: it derives `people/<slug>.md` or
`entities/<slug>.md` from a node's label and reads/writes that file.

## 2. Findings

### F1 — The graph is write-only memory. It is never read into agent context.
No caller of `get_graph_neighbors` or any graph read exists outside the two panels. Entities,
relations, and 40-node-per-page extractions are stored and *visualized*, but the agent never
consults them when answering. The graph is currently a picture, not a memory system. Any curation
investment should be paired with a read path (e.g. entity-triggered neighborhood injection à la
Tier 2), otherwise we are organizing a library nobody checks books out of.

### F2 — Dossiers are dark matter: written to disk, invisible to search AND dreams.
`EntityDossierPage` writes dossiers to `people/` and `entities/` at the knowledge root — but:
- `search_knowledge` / `search_knowledge_semantic` only scan `library/` + `memory/…` ([lib.rs:897](../src-tauri/src/lib.rs))
- `list_agent_memory_files` (the dream cycle's entire input) only scans `memory/…` ([lib.rs:2065](../src-tauri/src/lib.rs))

So a dossier the user writes about "Taylor" is never retrieved in conversation and never
consolidated in dreams. This quietly breaks G2 ("recall on re-reference") of
[people-directory-design.md](people-directory-design.md). **This is the single highest-value fix.**

### F3 — The graph is effectively not editable.
Today's verbs: delete a node (two-click) — that's it. No rename, no retype, no merging duplicate
nodes, no creating a node or edge by hand, no editing or deleting a single edge, no marking a node
"confirmed/curated". The dossier text is editable (good), but the graph structure itself is
read-only output of whatever the extractor happened to emit.

### F4 — Entity identity is left to LLM luck → duplicates are structural, not incidental.
Entity node ids come from the extraction LLM (sanitized string). "Alex Layton", "Alex", and
"alex-layton" only merge if the model happens to emit the same id across two extractions of two
different pages. There is no label-similarity dedup, no alias table, no reconciliation pass.
Every ingested page can add ≤40 entities / ≤60 relations — the graph's default trajectory is
**monotonic duplication**.

### F5 — No controlled vocabulary for node types or relations.
`node_type` and `relation` are freeform LLM output. The UI knows ~9 types (rest render gray);
relations like `works_at` / `employed_by` / `works for` coexist. Weight is always 1.0 —
re-mention doesn't reinforce, upsert just overwrites. Filters and any future ranking are built
on sand until the vocabulary is closed (with an `other` escape hatch).

### F6 — Notes have a good schema at ONE write path; everywhere else is freeform.
The gatekeeper writes rich frontmatter (`title, created_at, destination, memory_type,
evidence_state, confidence, privacy, tags, source_paths, source_urls` —
[memoryGatekeeper.ts:401](../src/services/memoryGatekeeper.ts)) and dream insights follow suit.
But /memo composes, dossier saves, and library drops carry little or none — and *nothing reads
the structure back*: the Tier-1 digest strips frontmatter and takes the first 400 chars. Structure
exists at write time and is discarded at read time.

### F7 — The two systems drift apart because neither maintains the other.
- Dream merge/prune archives memory files but never touches the graph → stub `memory-*` nodes
  keep pointing at archived paths.
- Deleting a graph node leaves its dossier file; archiving a dossier would leave its node.
- Saved memories become bare `concept` stub nodes (no extraction), so the graph's "mental map"
  of the agent's own beliefs is one disconnected dot per file.

### F8 — Small bugs found in passing.
- [EntityDossierPage.tsx:142](../src/components/EntityDossierPage.tsx) hardcodes
  `agentId: 'alexis'` on dossier save — wrong for any other agent.
- `upsertGraphBatch` always writes `metadataJson: '{}'` even though the single-node path accepts
  metadata — batch writes silently drop it ([graphEntityExtractor.ts:121](../src/services/graphEntityExtractor.ts)).
- Dossier path derives from the label slug; if rename ever ships, the file orphans unless the
  node stores its dossier path in metadata (see D1).

---

## 3. Design

Four tracks, in dependency order: **make it visible → make it editable → give it rules → make
the dreamer enforce the rules.**

### A. Surface the dark matter (prereq, small)

1. Add `people/` and `entities/` to the search roots and to a new
   `list_curated_knowledge_files` used by the dream cycle alongside agent memory.
2. Fix the `'alexis'` hardcode; thread the active agent id into dossier saves.
3. Store `dossier_path` in node `metadata_json` at dossier-create time (stop deriving from label).

### B. Curation verbs — the graph becomes editable

New Tauri commands + UI affordances in the node detail sidebar / dossier page:

| Verb | Backend | Notes |
|---|---|---|
| Rename node | `update_graph_node(id, label?)` | Label only; id stable |
| Retype node | `update_graph_node(id, node_type?)` | Picker over the controlled vocabulary (§C) |
| Merge nodes | `merge_graph_nodes(survivor_id, absorbed_ids[])` | Re-point edges, union metadata, record absorbed labels as `aliases` in metadata, concatenate dossiers with a `## Merged from` marker |
| Edit/delete edge | `delete_graph_edge(id)`, existing `upsert_graph_edge` | Edge list in sidebar gets ✕ and "add connection" |
| Create node | existing `upsert_graph_node` | "Add entity" button in Directory view |
| Pin/verify | `metadata.curated = true` | Curated nodes are **never** auto-modified by extractor or dreamer — the extractor upsert must switch to `ON CONFLICT DO NOTHING`-style label/type preservation when `curated` is set |

The `aliases` metadata array doubles as the dedup memory: the extractor checks label + aliases
before minting a new node id (exact/normalized match locally; fuzzy match is the dreamer's job).

### C. The Librarian Charter — best practices as data (the "skill")

A markdown charter shipped with the app and user-editable in the Knowledge panel
(`~/AgentForge/charter/librarian.md`), seeded with:

- **Identity**: one entity = one node = one dossier. Merge duplicates; record aliases. Prefer the
  fullest proper name as the label.
- **Vocabulary**: closed node-type set (`person, org, place, product, concept, technology, event,
  project, page, file, note, other`) and a closed relation set (~20 verbs: `works_at, part_of,
  created_by, located_in, related_to, appears_in, …`). Freeform relations get normalized to the
  nearest member or `related_to`.
- **Dossier template** (structured notes for entities):
  ```markdown
  ---
  title, type, created_at, updated_at, tags, aliases, confidence, source_paths, source_urls
  ---
  ## Summary        — 1–3 sentences, always current
  ## Facts          — one bullet per fact, each ending in a provenance ref [source]
  ## Relationships  — mirror of the graph edges, human-readable
  ## Open questions — what the agent isn't sure about
  ## Log            — dated append-only additions (dreamer folds these up into Facts)
  ```
- **Retention**: orphan entity nodes (degree 0) older than 30 days → prune candidates; `appears_in`
  is evidence, not knowledge — a node with only `appears_in` edges and no dossier is an
  *observation*, one with a dossier is a *belief*.
- **Provenance**: no fact without a source; merged content keeps the union of sources.

The charter text is injected verbatim into the Dreamer's system prompt for librarian jobs and
into any interactive "tidy my knowledge base" command — same mechanism as playbooks: the rules
are data the user can read and edit, not code.

### D. Dream cycle: the librarian shift

Extend [dreamer.ts](../src/services/dreamer.ts) with graph-aware ops. The dreamer does **not**
receive the whole graph — it receives a **curation digest** computed in Rust (cheap SQL):

- suspected duplicate clusters (normalized-label similarity within the same type group)
- nodes with out-of-vocabulary types; edges with out-of-vocabulary relations
- orphans and stale nodes (degree 0, `updated_at` old, source archived)
- entities mentioned in ≥N memory files that have **no dossier** (dossier candidates)
- dossiers whose `## Log` section has grown (structure-refresh candidates)

New ops, all through the existing per-op salvage + apply-loop + dream-log/undo machinery:

| Op | Effect | Guardrail |
|---|---|---|
| `graph_merge` | merge duplicate nodes | must cite the labels; never merges `curated` nodes without a `notice` instead |
| `graph_retype` / `relation_normalize` | map onto charter vocabulary | vocabulary enforced in the wire schema (enum), not just prose |
| `graph_prune` | delete orphan/stale nodes | caps per run (e.g. ≤15); pre-op snapshot rows stored in the dream log for undo |
| `dossier_write` | create a dossier for a hot undocumented entity, from cited memory files | template from charter; facts must carry provenance |
| `dossier_restructure` | fold `## Log` entries into `## Facts`, refresh `## Summary` | never drops a fact; like `update`, skip if >50% shrink |

Undo story: file ops already git-commit; graph ops get a `graph_ops_log` row per mutation with
the pre-image JSON, and the dream digest's undo button replays inverses.

Cross-system consistency rules (run every dream, no LLM needed):
- memory file archived → its stub node's `source_path` updated or node pruned
- node deleted → dossier moved to `archive/` (never hard-deleted, per never-wipe policy)

### E. Read path (makes it all matter)

When a message mentions a known entity (label/alias match over a cached node list), inject that
node's dossier `## Summary` + 1-hop relations as a Tier-2-style context block. This is the
people-directory G2 mechanism generalized to all entities — and it's the reason the librarian
work pays rent: curated nodes produce better recall.

---

## 4. Sequencing

1. **Phase 0 (fixes)**: F8 bugs + Track A (index dossiers, thread agent id). Small, ship first.
2. **Phase 1 (editable)**: Track B verbs + sidebar UI. Independent of LLM work.
3. **Phase 2 (charter + digest)**: charter file, curation digest SQL, extractor alias-dedup.
4. **Phase 3 (dreaming librarian)**: new ops, wire-schema enums, undo log.
5. **Phase 4 (read path)**: entity-triggered context injection.

## 5. Open questions

- Should `graph_prune` in dreams be propose-only (notice) for the first release, given the
  never-wipe sensitivity? (Leaning yes: prune → notice for a cycle or two, then auto with undo.)
- Does the curation digest run per-agent or global? Graph is currently global while memory is
  per-agent/space — merging those scopes is its own decision.
- Charter editing UX: raw markdown edit (consistent with dossiers) vs. structured settings — raw
  markdown first, consistent with "user-ownable = text edit".
