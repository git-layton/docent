# Agent Forge — Memory & Learning Loop

How Agent Forge makes its agents "learn and grow" over time, what each piece does, where the
code lives, and how it all connects. Read this before changing memory behavior.

## The core idea

The base LLM has frozen weights — it does **not** get smarter from your conversations. What
*does* grow is the **system around the model**: a persistent, external memory plus a loop that
captures experience, distills it, retrieves the relevant slice, and feeds it back into context.
That's the realistic, research-backed version of "an agent that learns."

Mapped to the standard taxonomy (CoALA — *Cognitive Architectures for Language Agents*, Sumers
et al. 2023): we implement **episodic** memory (what happened) and **semantic** memory (durable
facts/insights) strongly. **Procedural** memory (Voyager-style learned skills) is a deliberate
non-goal today — see [Non-goals](#known-gaps--non-goals).

## The loop

```
        ┌──────────────────────────────────────────────────────────────┐
        │                                                                │
   capture ──▶ reflect ──▶ structure ──▶ retrieve ──▶ inject ──▶ forget ─┘
  (episodic)  (consolidate) (tiered)    (rank)      (context)  (dedup/decay)
```

Each turn flows left→right (retrieve → inject happen live; capture happens after the reply). The
dream cycle (reflect/forget) runs on a timer in the background. All six stages are live.

> **Runtime caveat:** every write/read path here executes **only inside the running Tauri app**
> (it needs the Rust backend, an `~/AgentForge` workspace, and — for voice — Full Disk Access).
> Unit tests + types cover the logic; they do not exercise the live filesystem/embedder path.

---

## 1. Capture (episodic)

Records meaningful turns as durable, timestamped, retrievable memory files. Three write paths:

| Path | Trigger | Code |
|------|---------|------|
| Explicit gatekeeper | user says "remember this / save this …" | `evaluateMemoryGate` → `persistGatekeeperMemory` (App.tsx), `memoryGatekeeper.ts` |
| **Salience auto-capture** | scorer rates a finished turn `notable`+ | `assessConversationMemory` (`memoryPolicy.ts`) → `persistConversationMemory` (App.tsx) |
| Manual / overflow | user pins a message; or messages fall out of context | `handleBookmark`; `evaluateDroppedMessages` (`contextEvaluator.ts`) |

- The **gatekeeper** (`memoryGatekeeper.ts`) is a regex/MEMS classifier: it decides classification
  (`skip`/`background`/`notable`/`explicit`), `memoryType`, `evidenceState`, `confidence`,
  `privacy`, `destination`, and tags, and emits the YAML frontmatter via `buildGatekeeperMemoryWrite`.
- The **salience scorer** (`assessConversationMemory`) scores the whole Q→A exchange (length,
  durable signals, MEMS dimensions, attachments) and only `notable`/`explicit` turns are saved —
  so ordinary chatter doesn't flood memory. `buildGatekeeperMemoryWrite` takes an optional `answer`
  so the saved note captures the exchange, not just the user's line.
- Capture runs in both the single-agent and channel reply paths (including the all-`[PASS]`
  fallback). It is skipped for image-generation turns.

## 2. Reflect & consolidate (the dream cycle)

`dreamer.ts` builds the prompt; `runDreamCycle` (App.tsx) executes it. Scheduled 30 min after
launch, then every 24 h (gated by `appSettings.dreamAutoEnabled`). Five op types:

- `merge` — combine same-topic files into one; archive the sources.
- `prune` — archive outdated/redundant files.
- `update` — refresh stale content in place (guarded against >50% shrink).
- **`insight`** — *reflection*: synthesize a NEW cross-file generalization (grounded in ≥2 sources)
  and **persist it** to `memory/<agentId>/insights/<slug>.md` so it's retrievable in future turns.
  This is the difference between "tidies its notes" and "forms durable realizations." Insights are
  additive — sources are kept, not archived.
- `notice` — a transient, user-facing nudge surfaced in the Dream Digest UI (NOT saved to memory).

Distinction that matters: `notice` is shown once and discarded; `insight` becomes permanent,
retrievable knowledge. `merge` is mechanical (same topic); `insight` is a new generalization.

## 3. Structure (tiered + self-editing memory)

MemGPT/Letta-style tiers, in `memoryContext.ts`:

- **Tier 1** — `loadMemorySummary`: an always-injected ~2 kB digest of the agent's consolidated
  memory files, cached ~2 min (`invalidateMemorySummary()` drops the cache on any write/dream run).
- **Tier 2** — `retrieveRelevantMemory`: per-turn semantic retrieval, gated to the top hits above
  the relevance cutoff.

**Self-edit** (`persistAgentSelfMemory` in App.tsx): the agent can write/update its own memory
mid-conversation by emitting a `forge:action` block `{"tool":"memory","op":"save"}` (documented in
the `[ACTING ON THE USER'S TOOLS]` prompt block in `llm.ts`; dispatched in `handleAgentActions`).
Only `save`/`update` are honored — the agent can never delete memory, and these are written as
`evidence_state: inferred` / `confidence: medium` (NOT first-party) so an agent assertion — which
prompt-injected content could steer — can't outrank the user's own facts.

## 4. Retrieve & rank

`search_knowledge_semantic` (src-tauri/src/lib.rs) — the Generative-Agents retrieval score:

1. Embed the query (fastembed `AllMiniLML6V2`), score every indexed chunk by **cosine similarity**.
2. Pre-filter `cosine > 0.25`.
3. **Select** the kept set by cosine (sort by cosine, dedup to one chunk per file, truncate to
   `max_results`) — so recency/importance can never evict a more-relevant memory.
4. **Reorder** the kept set by a blended rank `cosine * (0.80 + 0.15·recency + 0.05·importance)`
   — a fresh, higher-confidence memory surfaces above a stale, weak one at comparable similarity.
   `recency` decays with a 30-day half-life; `importance` is parsed at index time from frontmatter
   (`parse_memory_importance`).
5. Return **raw cosine** as `score`, so the frontend thresholds keep their exact meaning.

**Keyword fallback** (`search_knowledge`) runs when the embedder/DB is unavailable. It returns
`keyword_relevance(...)` — a normalized **[0,1]** coverage score (NOT a raw match count) so it's
comparable to a cosine and the frontend gates/×150 interleave stay correct.

Thresholds: Rust pre-filter `0.25`; Tier-2 prompt injection `TIER2_MIN_SCORE = 0.35`; search-bar
`KNOWLEDGE_SEARCH_MIN_SCORE = 0.3` (looser — an active searcher wants recall).

## 5. Inject (context assembly)

`buildSystemPrompt` (`llm.ts`) assembles ~15 ordered sources into the system prompt:
instructions, user profile, tasks, pins, Tier-1 memory, ambient open tabs, the active tool's data,
project `AGENTS.md`, Tier-2 hits (placed near the user turn to mitigate "lost in the middle"),
voice profile, browsing recall, browser page, integration outputs. Untrusted sources (web/email/
browser page) are fenced as DATA, not instructions. Chat history is trimmed to a char budget.

## 6. Forget (dedup / decay / prune)

- **Write-time dedup** (`writeMemoryDeduped` + `findDuplicateMemoryPath`, App.tsx): before minting a
  new file, semantic-search for a near-identical one (`MEMORY_DEDUP_MIN_SCORE = 0.88`) **restricted
  to the same directory** as the write (never a Library doc, never an insight). On a hit, the new
  body is **appended** under a dated `## Update` section (never overwritten) so no prior content is
  lost, and recency refreshes. Library saves are exempt (intentional curation). Falls back to a
  fresh file if the existing one can't be read or the append is blocked.
- **Decay/prune**: the dream cycle archives stale/merged files; a Rust thread hard-purges
  `.archive/` files older than 7 days. `safe_write_file` blocks any write that would delete >40% of
  a file (the "nuke shield"), with git rollback.

## Data model & storage

```
~/AgentForge/
  memory/<agentId>/
    gatekeeper/<slug>.md     # explicit + auto-captured + self-edit memories
    channels/<channelId>/    # channel-scoped memories
    insights/<slug>.md       # dream-synthesized reflections
  library/                   # user-curated docs (bookmarks) — never auto-deduped
  .index.db                  # SQLite: brain_vectors (chunk_id, file_path, content, vector BLOB,
                             #         last_modified, importance) — the semantic index
  .models/                   # cached embedder weights
  workspace/.dream_logs/     # transient dream-cycle digest (UI only, gitignored)
  .git                       # every memory write is committed (audit + undo)
```

- Memory files are markdown with YAML frontmatter: `title, created_at, destination, memory_type,
  evidence_state, confidence, privacy, agent_id, tags, source_paths, source_urls`.
- A background **file watcher** (`init_file_watcher`, lib.rs) auto-indexes new/updated `.md`/`.txt`
  files: chunk on `##` headings → embed → store in `brain_vectors` (recursively, so `gatekeeper/`,
  `channels/`, and `insights/` are all indexed; `.archive/` is skipped).
- App/UI state (pins, dream log, settings, voice profile) persists via the Tauri Store plugin
  (`agent_forge_db.bin`) — see `database.ts`, `useSettingsStore.ts`.

## Personalization layer ("Write Like Me")

- Voice card: harvested from sent iMessage/email, distilled into a style card (`voiceRuntime.ts`,
  `voice.ts`), persisted in `appSettings.voiceProfile`, injected only for user-behalf drafting.
- **Auto-refresh** (App.tsx useEffect): ~2 min after launch, if an already-opted-in profile is
  >14 days stale, rebuild it in the background. It **never** harvests for a user who didn't opt in
  (consent boundary), and re-checks `enabled` after the build so a mid-build disable wins.
- A second growing model: `userProfile` facts the agent proposes via a ```profile``` block and the
  user approves; persisted and re-injected across sessions.

## Key tunables

| Constant | Value | Where |
|----------|-------|-------|
| `TIER1_BUDGET` / `TIER1_PER_FILE` | 2000 / 400 chars | `memoryContext.ts` |
| `TIER2_MIN_SCORE` / `TIER2_MAX` | 0.35 / 4 | `memoryContext.ts` |
| `KNOWLEDGE_SEARCH_MIN_SCORE` | 0.3 | `semanticDocs.ts` |
| cosine pre-filter | 0.25 | `lib.rs` `search_knowledge_semantic` |
| rank weights / half-life | 0.80 + 0.15·recency + 0.05·importance / 30 days | `lib.rs` |
| `MEMORY_DEDUP_MIN_SCORE` | 0.88 | App.tsx |
| dream schedule | 30 min warm-up, 24 h interval | App.tsx |
| archive purge | 7 days | `lib.rs` |
| voice staleness | 14 days | App.tsx voice effect |

## Known gaps & non-goals

- **Skill / procedural memory (Voyager) — deliberate non-goal.** Learning reusable skills needs a
  *verification signal* (did the skill work?) that a personal assistant rarely has; without it,
  learned "skills" accumulate brittle/wrong procedures and get confidently reused. The safe future
  version is **human-in-the-loop playbooks** — and the self-edit + insight machinery already gets
  most of the way there. See `docs/agent-capabilities-design.md`.
- **Personalization is single-voice.** One global voice card (now auto-refreshing) + an approved-
  fact list. "Fuller" = per-relationship/surface voice + a richer inferred preference model.
- **Channel memory tag (cosmetic).** A channel-turn's `agent:<id>` tag may name the active assistant
  rather than the channel's primary agent. Metadata only — doesn't affect retrieval or scoping.

## How to extend

- **New memory type / classification:** add to the unions + regexes in `memoryGatekeeper.ts`.
- **New dream op:** add to `DreamerOp` + the prompt/schema in `dreamer.ts`, handle it in
  `runDreamCycle` (App.tsx), and (if it produces a UI item) extend `DreamItem` in `DreamDigestModal.tsx`.
- **Tune retrieval:** the rank formula and half-life live in `search_knowledge_semantic` (lib.rs);
  the gates live in `memoryContext.ts` / `semanticDocs.ts`. Keep `score` = raw cosine so the
  frontend thresholds stay meaningful.
- **New write surface:** route it through `writeMemoryDeduped` (App.tsx) so it dedups safely.

## Research touchstones

- CoALA — Cognitive Architectures for Language Agents (Sumers et al. 2023): episodic/semantic/procedural memory.
- Generative Agents (Park et al. 2023): memory stream + reflection + relevance·recency·importance retrieval.
- MemGPT / Letta: tiered memory (hot context vs. recall) + self-editing memory.
- Voyager (Wang et al. 2023): lifelong skill library (the procedural pattern we deferred).
- Reflexion: verbal self-critique stored as memory.
