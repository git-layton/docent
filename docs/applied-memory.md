# Applied Memory — per-relationship voice + procedural playbooks

The design behind two features that are really **one idea**: a typed, *trigger-keyed* memory record
that is retrieved and **applied** at the right moment. A **recipient** triggers a voice card; a
**task-intent** triggers a procedure. The unifying substrate is the verb set
(`store · retrieve-by-trigger · reinforce`) and the mental model — not a single storage format.

> Status: **per-relationship voice is built (P0/P1 core)**. Procedural playbooks are **designed,
> not yet built** (P3–P5 below). Everything here is **zero-Rust** by design.

## Why two storage tiers (not one)

The two features have opposite access patterns, so they deliberately store differently:

| | Per-relationship voice | Procedural playbooks |
|---|---|---|
| Access | **synchronous**, on every draft | semantic, on intent detection |
| Store | in-memory `appSettings.voiceProfile.byRecipient` | `.md` records under `memory/<agent>/playbooks/` |
| Latency | zero (no search) | one Tier-2 search when intent matches |
| Refinable by dream cycle | only if *promoted* to a record | yes (it's already a record) |

The **unification** is the `appliedMemory` verb set + the trigger-keyed model, applied to playbooks
as files now and **promotable** for voice later (we reserve a `voice_card` memory type for that day).

## Per-relationship voice (BUILT)

The agent drafts in the voice you actually use *with that person* — your professional voice to your
boss, your casual voice to your partner — instead of one global voice for everyone.

### Data model (`src/services/voice.ts`)
- `VoiceProfile.card` stays the **global fallback** (zero migration; unchanged behavior when no
  override applies).
- `VoiceProfile.byRecipient?: Record<relKey, RelationshipVoice>` — the per-relationship layer.
- `RelationshipVoice = { card, optedIn, label?, recipientName?, source?, lastBuiltAt?, sampleCounts? }`.
- `optedIn` is a **consent flag** — normalized strict-`true`; garbage never counts as consent.

### Keying (PII-minimal, pure helpers)
- `relKeyForImessage(chatId)` → `im:<chatId>` (the chat id, **never** the phone/handle).
- `relKeyForEmail(addr)` → `mail:<lowercased-address>` (extracts the address from `"Name <a@b>"`).
- `resolveRecipientCard(vp, relKey)` → the opted-in recipient card if present & non-empty, else the
  global card. This is the whole selection rule, and it's unit-tested.

### Learning & application
- `buildRelationshipVoiceCard(chatId, name)` (`voiceRuntime.ts`) distills a card from **only** the
  messages you've sent to that 1:1 chat ("how you write to THIS person") — targeted, so it's cheap.
- `draftReply({ …, relKey })` selects the card via `resolveRecipientCard`. No `relKey` → global card,
  byte-for-byte the previous behavior.
- Wired at both draft sites: `MessagesPanel` (`im:<chatId>`, 1:1 only — groups fall back to global)
  and `MailInboxPanel` (`mail:<addr>`, selection only).
- Entry point: a **"learn voice"** pill on a 1:1 iMessage chat builds + opts that person in; once set,
  replies to them use it. (Auto-refresh from the existing voice subsystem keeps it current.)

### Consent boundary
Per-recipient harvesting only happens when the user explicitly opts that recipient in (default off),
and is still gated by the existing per-surface `voiceProfile.perSurface` toggles. We never harvest a
relationship the user didn't choose.

### Built (P2)
- **Settings management UI** (shipped): "Voices by person" in Profile Settings lists each learned
  relationship with toggle on/off, hand-edit, rebuild (iMessage), and remove. The 1:1 chat pill is the
  other entry point.

### Deferred (follow-ups)
- **Email per-recipient *learning*** (selection already works): grouping sent email by *recipient*
  needs To/Cc from `mail_fetch_sent`, i.e. a Rust change to the mail backend not yet made. Until then,
  email drafts use an opted-in card if one exists, else global.
- **iMessage group chats**: per-relationship voice is 1:1-only at first (one chatId can't
  disambiguate participants without a Rust change).

## Procedural playbooks (LIVE — capture + suggest; enact via gated actions)

> **Status:** the loop is wired. **Capture:** the agent emits `forge:action {tool:'playbook',op:'capture',…}`
> when the user asks to save a procedure → `persistPlaybook` (App.tsx) → `buildPlaybookRecord` → stored
> *verified* (the user requested it). **Suggest:** each turn, `retrievePlaybooks` finds verified
> playbooks matching the intent and `formatProceduresBlock` injects a propose-don't-run block (threaded
> as `knownProcedures` through `generateTextResponse`). **Enact:** the agent carries out the steps via
> its NORMAL tools, one at a time — each individually approved by the existing gate — so there is no
> special executor; the `executeAgentAction`-throws backstop covers a stray `playbook.execute`.
>
> **Deferred enhancements** (not blocking; like voice's P2 was): an explicit multi-step approval-card
> for a `playbook.execute` path; run-tracking/reinforce + the stricter verify-on-first-run gate; a
> Settings "Playbooks" management list; and dream-cycle `playbook_refine`.

The safe, human-in-the-loop form of procedural/skill memory: the agent saves a reusable multi-step
procedure and reuses/refines it. **Your acceptance is the verification signal** a personal assistant
lacks (vs Voyager's automatic environment signal), so trust is gated hard on acceptance.

### Data model
- Records at `memory/<agentId>/playbooks/<intent-slug>.md` via a new `playbook` `memory_type` and a
  `destination` case in `buildGatekeeperMemoryWrite`. Namespaced tags (`playbook`, `trigger:task:<slug>`,
  `tool:<t>`, `verified:false`, `accept:0`). Dedup keys on the **trigger slug**, not full text, so
  "weekly report" and "quarterly report" stay distinct while refinements of the same procedure fold
  via the existing `## Update` append.
- **Steps are natural-language intent + an OPTIONAL soft tool *hint* — never a bound, pre-filled
  action.** The agent re-derives the concrete action from each step's intent + current context every
  run (adapts like a person following a recipe). This scales (nothing rigid to maintain) and stays
  safe (every derived action re-hits the approval gate). The hint only labels the step for retrieval/UI.

### Born: agent-proposed → user-verified
After a multi-step sequence you accepted, the agent emits `forge:action {tool:'playbook',op:'capture',…}`
(≥2 steps), routed through `handleAgentActions` (extend the self-edit filter), persisted `verified:false`.
A playbook becomes suggestable only after you **approve its first run** (`verified` flips true); a manual
"Trust this playbook" toggle exists for power users.

### Applied: two-phase, never autonomous (DEFERRED stricter variant)
> The shipped MVP enacts via normal individually-gated actions (see the status note above). The
> explicit `playbook.execute` + multi-step approval-card flow below is the stricter variant, deferred.
1. **Suggest** — `retrieveByTrigger('playbook', intent, agentId)` (filtered to `verified===true`) injects a
   `[KNOWN PROCEDURE — propose, do not run]` block near the Tier-2 slot; the agent offers to run it.
2. **Approve** — `actionNeedsApproval({tool:'playbook',op:'execute'})` returns **true** → the existing
   approval card (extended to render multi-step proposals). **`executeAgentAction` THROWS on a raw
   `playbook.execute`** — approving instead re-emits each step as a *separate* `forge:action` that
   re-enters the pipeline, so any send/delete inside a playbook **still individually hits the gate.**
   A unit test locks both invariants.

### Shared substrate (`src/services/appliedMemory.ts`, BUILT)
Pure (must NOT import `llm.ts`; no Tauri invoke). **Built + unit-tested:** `playbookTriggerSlug`,
`buildPlaybookRecord` (filename = trigger slug, so re-capture updates in place; NL steps + optional soft
hints; YAML-sanitized title), and `parsePlaybook` (round-trip). The invoke-based `retrieveByTrigger` /
`reinforceAppliedMemory` land with the live wiring (they need Tauri + `retrieveRelevantMemory`). Both
subdirs auto-index (Rust prefix-LIKE + recursive collect) — **no Rust work**.

## Phased plan & status

- **P0** — `appliedMemory.ts` substrate (pure builders/parser) + `playbook`/`voice_card` types — **DONE** (`e499fe8`)
- **P1** — per-relationship voice (data model, keying, selection, 1:1 learn pill) — **DONE** (`24adc37`)
- **P2** — voice management UI in Profile Settings — **DONE** (`c6607e7`)
- **P3** — playbook capture (foundation + safety backstop `e499fe8`; capture routing in `handleAgentActions`) — **DONE**
- **P4** — playbook retrieve → suggest (enacted via normal individually-gated actions) — **DONE**; the explicit multi-step approval-card `playbook.execute` path — *deferred enhancement*
- **P5** — dream-cycle `playbook_refine`/`voice_refine`, run-tracking/reinforce, Settings playbook list — *deferred enhancements*

## Decisions (locked with the user)
- Playbook steps: **natural-language + optional tool hint**, re-derived & re-gated each run (not rigid templates).
- Playbook trust: **verified on first approved run** + a manual Trust toggle.
- Voice storage: **in-memory `byRecipient` map**, with a reserved promotion path to `/voices/*.md` for dream refinement.

## Research touchstones
CoALA (procedural memory is the third pillar) · Generative Agents (retrieval = relevance·recency·importance)
· MemGPT/Letta (self-editing memory) · Voyager (skill library — the procedural pattern, made safe with a
human verification signal). See also [docs/learning-loop.md](learning-loop.md).
