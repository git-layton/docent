# Redesign Phase 2 — memory scoping · skills & workers · Screen chip

Status: **execution plan** · Date: 2026-07-16
Builds on the shipped v2.5.0 redesign (D1 one-assistant ✅, D6 space switcher ✅, D8 flags ✅,
glass ✅). Companion to [HANDOFF-nav-agent-redesign.md](HANDOFF-nav-agent-redesign.md) — this doc
answers HANDOFF §9's open questions and schedules the two decisions (D3/D4 skills-workers, D7
Screen) that shipped only as vocabulary.

**Supersedes:** `spaces-architecture.md` / `spaces-implementation-plan.md` (the roster/Hub model —
contradicted by shipped D1/D5/D6 code). Four mechanics transfer from them and are folded in here:
the memory scope flag + asymmetric write-default (→ WS-A), the visibility gate (→ WS-A/WS-B), the
never-wipe tripwire discipline (→ WS-D), and internal-vs-external data ownership (→ WS-A edge cases).

---

## Verified current state (2026-07-16, code-grounded)

| Substrate | State | Where |
|---|---|---|
| Memory | **File-based** Knowledge Core (git-committed) + playbooks + GlobalPins; **no scope field anywhere** | `services/appliedMemory.ts`, `memoryContext.ts`, `useMemoryStore.ts` |
| Memory write gate | Exists (explicit-save regex, provenance, quarantine) | `services/memoryGatekeeper.ts` |
| Memory read gate | Exists (tiered relevance gating) | `services/memoryContext.ts` |
| Dream cycle | Consolidates + cross-file insights; **scope-blind** | `services/dreamer.ts` |
| Skills substrate | Agent record (`prompt/tools/trainingDocs/drive`) merges into system prompt; **no token budget** (spec §9 unbuilt) | `services/llm.ts` assembler |
| Workers substrate | `drive/driveEnabled`, `agentGoals` per space, jobs store + Rust `update_job` | `useAgentStore.ts`, `useJobStore.ts` |
| Screen | `capture_screen_text` + screenMode toggle + local preview thumb + chat-only switch shipped; **S1 fencing landed** (`'screen'` → `untrusted-external`) | `SpotlightBar.tsx`, `trust.ts:37` |
| Routing engine | Group-chat orchestration intact but de-surfaced (D5 "hide the gearbox") | `App.tsx` isChannelChat, `channels.ts` |

---

## WS-A — Memory & knowledge scoping (answers HANDOFF §9 Q3)

**Decision: per-space context with a global core — and `/find` always searches everything.**
The research seam (person-in-a-room): *identity travels, materials stay*. Alexis's knowledge of
**you** is global; what she learned **in a space** stays in that space. This is MemGPT-style
core-vs-archival hierarchy applied to spaces, and it keeps the Slack Unified-Grid lesson: scoping
governs **context injection**, never **search** — cross-space `/find` must always work, labeled by
source.

**Data model (file-based, not a DB column):**
- `scope: global | <spaceId>` in memory-file frontmatter; space memories live under
  `memory/spaces/<spaceId>/` so the git tree mirrors the model. GlobalPins gain `spaceId?`.
- **Write default = current space**, enforced in `memoryGatekeeper` (one choke point).
  Promotion to global needs an explicit user-fact signal or user pin. *Why asymmetric:* a wrong
  space-tag means re-teaching (annoying, safe); a wrong global-tag leaks across worlds
  (destructive). Bias to isolation.
- **Existing memories fold to `global`** — they were learned pre-isolation; folding them into one
  space would lobotomize Alexis everywhere else. One-time frontmatter pass, git-committed
  (fold-forward even pre-release: memory files are user-valued and versioned, unlike the reseedable
  stores).

**Retrieval (one filter, both directions):**
`inject if (scope === activeSpace) OR (scope === global AND gate(agent))` — in `memoryContext.ts`.
The gate: evolve `awareOfProfile` into a memory-visibility scope. Alexis = full; a dispatched
worker = space context + only gated global. (This kills the "imported agent instantly knows your
divorce" failure *and* keeps one auditable memory store — no per-agent stores, no drift.)

**Dream cycle becomes scope-aware:** consolidation runs *within one scope bucket per pass*;
cross-file insights may only generalize over inputs of a single scope; global insights only from
global inputs. Without this, nightly consolidation launders space facts into global summaries and
silently defeats the whole architecture.

**Edge cases (each gets a test):**
- **Sidecar over another app** writes to the *active space's* scope; the composer's target is
  visible (chip), so a "quick thought while in Mail" doesn't land in the wrong world.
- **Space deletion** archives its memory directory (tombstone, git history retains); never
  hard-deletes. `space-home` is undeletable and doubles as the global bucket's home.
- **Receipts say the scope**: "Saved to *Work's* memory" vs "Saved to memory (everywhere)" —
  the doctrine's receipt grammar extended one word.
- **Screen-sourced writes** are untrusted-external (S1) → gatekeeper quarantine → default space
  scope + provenance chip. Screen content never silently becomes a global fact.
- **`/find`** searches all scopes always, grouped by space, with per-source status (spec A3/U4).

## WS-B — Skills & workers formalized (D3/D4, rationale §2–5)

**Skill = equipment on Alexis; worker = dispatched agent. No new subsystem — a `kind` field and
two UIs over the existing agent record.**

- `kind: 'skill' | 'worker'` on the agent record; derive on first run (`driveEnabled` → worker,
  else skill). The Forge (AssistantSettingsModal) gets two output shapes, same storage.
- **Equipping:** a space's `agentIds` *is already the roster* — relabel: skills equipped here +
  workers active here. No schema change (HANDOFF step 1's "UI/vocabulary only" holds).

**Prompt assembly — progressive disclosure, not naive merge (the bloat guard):**
`llm.ts` has no token budget today; merging five expert prompts + docs = a self-contradicting
persona and a blown 32k local context. Adopt the Agent Skills pattern:
1. **Stage 1 (always in prompt):** one line per equipped skill — name + when-to-use.
2. **Stage 2 (on demand):** the gatekeeper's deterministic routing (regex/intent, never the local
   LLM — spec A1) loads the *full* skill prompt + trainingDocs for that turn only.
3. **Cap:** ≤2 fully-loaded skills per turn; skills contribute fenced `[EXPERTISE]` blocks that
   never override Alexis's base persona (deterministic merge order; docs deduped).
4. Land the spec §9 **token budget** (system ≤30% of `contextLimit`) in the same PR — WS-B is the
   change that makes its absence dangerous.

**Workers (the orchestrator-worker tier):**
- Dispatch through the existing `drive` + `agentGoals` + `useJobStore` substrate; a dispatched
  worker = a job with its own context and model, posting **receipts** back into the space thread.
- **Group cards inside the space** (rationale §4's HCI mitigation), not a global roster; the
  worker's job, status, and output link live on the card. Codey stays the canonical app-bound worker.
- **Summarize-on-handoff** (rationale §6): worker output enters Alexis's context as a summary +
  linkable receipt, never inlined wholesale (context-accumulation guard).
- **Memory:** workers get space scope + gated global (WS-A's gate) — a dispatched researcher
  doesn't inherit your life story.
- Failure/timeout surfaces in the Inbox (existing routine-results path), never silently dropped.
- **Concurrency cap** (default 2–3 parallel workers): Anthropic's own data — multi-agent burns
  ~15× tokens — makes unbounded parallel dispatch a cost/latency footgun on local models.

**Edge cases:** skill/skill conflicts (deterministic order + fenced blocks); @-mention parser stays
as a hidden power-user escape but disappears from UI (D5 — decide at dogfood whether to remove);
existing user-created agents migrate by derivation, zero data change; equipping a skill mid-thread
takes effect next turn with a quiet chip ("Securities-law expertise equipped").

## WS-C — ⌘F sidecar: finish the Screen chip (D7, spec §3–6 + v1.1 amendments)

Half-shipped: screenMode toggle, local preview thumb, chat-only switch, S1 fencing. Remaining:

1. **Stackable context chips** replace the mode toggle: `Screen ●` / tab / file / memory —
   additive, individually dismissible (spec §4). Screen chip label: "Screen — reads when you send"
   (U3); idle-default eye, pulse only during capture.
2. **Thread routing (HANDOFF §9 Q2 — decided):** ⌘F opens the **active space's** thread by
   default; a chip switches spaces; plus one standing **Quick-ask** space for context-free asks.
   Quick-ask is a real space (gets WS-A scoping for free; its memories stay out of your worlds).
3. **Focus contract + capture crop** (spec §3): closing returns focus to the previous app; capture
   crops the panel strip (kills the hide-blink; also means Alexis must say she can't see behind
   her own panel — S2).
4. **Home ask-bar (HANDOFF §9 Q4 — decided):** it opens the conversation pre-filled — it is a
   *door*, never a third chat surface.
5. **A11y as acceptance criteria** (X1–X5): text-mirrored annotations, status live region,
   keyboard operability, reduced-motion/transparency variants — per surface, not a later pass.

**Edge cases:** multi-display capture picks the display under the cursor; TCC grants die on adhoc
rebuilds (screen work verifies only under a stable signature — Developer ID enrollment is the
unblocker, tracked separately); sensitive-app moments are the chat-only switch's job (already
shipped); annotation layer (spec §6) stays **out of this phase** — S2 grounding is its gate.

## WS-D — Hygiene, sequence, verification

**Sequence (each step flagged, one concern per commit):**
1. WS-A memory scoping (`memoryScopeEnabled`) — foundation; WS-B workers depend on its gate.
2. WS-B skills/workers (`skillsEnabled`) + the token budget.
3. WS-C Screen-chip finish (`sidecarChipsEnabled`) — parallelizable with WS-B after WS-A.
4. Dogfood with flags on (HANDOFF step 7 answers the mount question here); flip defaults; subtract.

**Hygiene now:** mark the spaces docs SUPERSEDED (done alongside this doc); refresh HANDOFF §7's
stale line refs before any cold agent uses the map; keep the never-wipe tripwire discipline —
pre-release reseeds stay fine for *stores*, but memory files fold forward (they're git history).

**Verification matrix (added to the suite):**
| Test | Asserts |
|---|---|
| Scope write default | new memory in a space lands `scope:<spaceId>`; explicit "remember this about me" lands global |
| Cross-space isolation | fact taught in A never injected in B's chat context |
| `/find` cross-space | the same fact IS findable from B, labeled "from A" |
| Gate | worker with gate=off retrieves zero global memories |
| Dreamer scope | consolidation output inherits input scope; no cross-scope insight |
| Skill budget | 5 equipped skills → system prompt stays under the token budget; ≤2 full loads |
| Worker receipt | dispatched job posts summary + receipt, not full output |
| Chip routing | ⌘F over another app targets active space; chip switch honored; Quick-ask isolated |
| Flag off | every flag off → v2.5.0 behavior byte-identical |

**Open DECIDEs (small, decide at the step that touches them):**
1. @-mention: hidden-but-working vs removed (dogfood WS-B).
2. Worker concurrency cap default (2 vs 3).
3. Memory-file tombstone window on space deletion (suggest one release).
4. Whether Quick-ask memories ever auto-promote (suggest: never; explicit pin only).
