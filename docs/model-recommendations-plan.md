# Model Recommendations — Design & Rollout Plan

*July 2026. Companion to the memory model in `src/data/modelCatalog.ts` and `docs/onboarding-feedback.md`.*

## The three layers

1. **Wizard (built)** — one research-backed General pick, computed for THIS Mac by
   `recommendSetup()` (GPU wired-memory budget + KV cache, never file size). The user
   sees one card, one Download button, and why it's the pick.
2. **Store (built)** — the whole catalog, grouped by what each model actually does on
   this Mac (full 32K / reduced context / won't fit), each with best-for / not-great-for
   and an honest per-Mac fit line. Search + role filters. Reachable from the wizard's
   Advanced section and Settings.
3. **Role recommendations (planned)** — the same engine, filtered by role. First use:
   entering Agent Forge Code (Codey) with no Coder-role model installed shows a
   dismissible "for coding work on your Mac we recommend… or at least one of these"
   card with one-tap download. Extends later to Reasoning / Writer roles for free.

## Decision log

- **Mistral NeMo 12B (Q8) — rejected as a recommendation.** Two generations old
  (July 2024); Qwen3 8B beats it at general capability while being smaller; it was never
  a coder, so it can't be the dual general+code pick. At Q8 (~13GB file) our own memory
  math puts it in 36GB-Mac territory, where Mistral Small 3.2 / Qwen3-Coder-30B win
  outright. *Optional store-only entry at Q4 (~7GB) as a `Lightly Filtered · Writer ·
  128K` niche card — never the headline.*
- **The "one model that handles both" slot** is filled by Qwen3-Coder-30B-A3B on 32GB+
  Macs (fast MoE coder that chats well) and by Qwen3 8B/14B below that.
- **8-bit KV cache**: the launch path is staged but unverified, so `KV8BIT_RUNTIME_READY
  = false` keeps it out of the fit ladder. Every fit label must be one the engine can
  actually honor.

## Phase 1 — truth & safety (DONE, July 2026)

- `start_local_model` accepts `ctxTokens`; every catalog/settings launch passes the
  fit-derived context instead of the old hardcoded `-c 32768`. The revive record stores
  it, so self-heal relaunches identically. (Old records default to 32768.)
- 8-bit KV removed from the fit ladder behind `KV8BIT_RUNTIME_READY` until verified —
  no more labels the runtime can't honor, no post-download OOM from the "Also runs"
  section.
- Wizard local card is choosable only when `recommendSetup()` produced a local pick;
  otherwise it shows the engine's own reason. (Previously an 8GB Air could enter the
  guided local screen and find nothing to download.)
- Recommended card shows *why*: "Our pick for your NGB Mac · runs at 32K context".
  Reduced-context store cards show their per-Mac fit line before download.
- Full store browsable under wizard Advanced on any Apple Silicon Mac ≥6GB.
- Known gap: "Use a .gguf I already have" imports still launch at the 32K default (file
  size unknown at pick time); the engine's OOM message covers oversized imports.

## Phase 2 — catalog accuracy & refresh

- Add optional `layers` / `kvDim` per catalog entry with each model's real values;
  `estLayers()` overshoots MoE models ~2.5× (Qwen3-30B-A3B real KV @32K ≈ 3.2GB vs
  8.6GB estimated), which blocks good recs on 32GB Macs.
- New entries: **Qwen3-Coder-30B-A3B** (~19GB Q4, role Coder), **Qwen2.5-Coder-14B**
  (~9GB Q4, role Coder), optional **Qwen3-Coder-Next 80B-A3B** (~42GB Q4, 96GB tier),
  optional NeMo-Q4 writer card.
- Retire dead `primary` flags (several never fire — e.g. Gemma 4 12B is marked as the
  16GB headline but only recommends at 24GB) or re-derive them from the math.
- Verify the 8-bit KV launch end-to-end on the bundled llama-server; flip
  `KV8BIT_RUNTIME_READY` and pass `-ctk/-ctv q8_0` when `fitOnMac` says so. This is
  what unlocks Gemma 4 (vision) on 16GB Macs — the app's identity pick on the most
  common config.

## Phase 3 — role recommendations

- `recommendSetup({ role })`: same ladder, filtered to the role; General stays the
  wizard default.
- Codey nudge card (dismissible, remembered) on entering Agent Forge Code without a
  Coder model; reuses `ModelCard`.
- Role filter chips in the store.
