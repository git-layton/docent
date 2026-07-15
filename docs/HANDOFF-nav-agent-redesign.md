# HANDOFF — nav + agent-model redesign

**Read this first. You are a fresh agent with none of the prior conversation's context.**
This doc is self-contained and authoritative. The decisions in §3 are **settled — do not
relitigate them**; the rationale is linked so you can trust, not re-derive. Read the four deep docs
(§8) before writing code.

Date handed off: 2026-07-15 · Owner: Alex (solo dev, dogfood-stage macOS Tauri app)

---

## 1. Mission (the end state)

Rebuild Agent Forge's main-window information architecture around **one assistant, Alexis**, and a
**space = a chat** model. Kill the Slack-style roster (PEOPLE / AGENTS / SPACES sidebar). Replace it
with a **space switcher** (top-of-window, like switching Slack workspaces / Arc spaces) where each
space is a *context* (its own tabs, knowledge, standing goal, and conversation thread). Specialist
"agents" survive only as **skills** (expertise equipped onto Alexis) and **workers** (agents you
dispatch for autonomous/parallel work, e.g. Codey). The ⌘F sidecar overlay becomes the way to reach
Alexis over *any* app, carrying an optional "Screen" context. Optionally, a "safe-premium"
glassmorphic visual uplift.

Two visual mockups of the target (open them):
- Home + ⌘F sidecar overlay — https://claude.ai/code/artifact/bcbf5371-a7e2-4775-afc1-1766b428abe5
- Spaces + agents model (interactive: ambient vs specialists) — https://claude.ai/code/artifact/76c0302f-0b32-46be-adae-2ca7205801e6

## 2. Current status (verified 2026-07-15)

- **Branch: `main`.** Start the work on a **fresh branch off `main`**.
- **Uncommitted:** `src/App.tsx` holds a completed, typechecking **sidecar live-sync fix** (defers
  the overlay's `spotlight-chat-updated` hydrate while the main window is mid-stream, debounces, and
  flushes-then-reloads so merge-on-persist keeps both sides). It passes `npm run typecheck` but has
  **not been runtime-verified or committed.** This is Step 0.
- Untracked docs (this planning set): `agent-model-rationale.md`, `agent-model-rollout.md`,
  `main-window-redesign-prompt.md`, and this file. (`canvas-code-ia-design.md` is unrelated.)
- Nothing else is built. The redesign is greenfield behind this plan.

## 3. Decisions locked — DO NOT relitigate

| # | Decision | One-line why | Source |
|---|----------|-------------|--------|
| D1 | One assistant (Alexis) is the only interlocutor; no user-facing agent roster | Single-orchestrator matches Anthropic's own multi-agent system; multiple *visible* agents raise cognitive load (HCI) | [rationale](agent-model-rationale.md), [sidecar §2](alexis-sidecar-spec.md) |
| D2 | A **space IS a chat** — roster + context (tabs/knowledge/goal) + one thread. DM = 1-agent space; project = multi-agent group chat | Collapses spaces/chats/agents/people into one primitive | conversation 2026-07-15 |
| D3 | "Specialist agent" splits into **skill** (equipment on Alexis) vs **worker** (dispatched, autonomous) | "I want expert answers" = a skill; "go do work" = a worker. Test: autonomy+parallel+own-context+verifiable → worker, else skill | [rationale §2](agent-model-rationale.md) |
| D4 | Skills need **no new subsystem** — reuse the agent record (`prompt`+`tools`+`trainingDocs`+`drive`), already wired into `llm.ts` | Avoids building infra you already own | verified in `src/services/llm.ts:288-339` |
| D5 | Original **user-facing multi-agent routing → internal orchestration** (keep the engine, hide the gearbox) | Peer routing's upsides are server-scale; a local single-user app pays its costs, reaps none | [rationale §3–4](agent-model-rationale.md) |
| D6 | Space = **context switcher** (top of window), not a sidebar list | Arc/Slack pattern; switching swaps tabs+knowledge+goal+thread | [redesign prompt](main-window-redesign-prompt.md) |
| D7 | ⌘F sidecar = a **location shortcut** ("bring this chat to where I'm looking"), Screen = a **capability chip**, not the same thing | Separates reach from perception; they compose | conversation 2026-07-15 |
| D8 | Ship behind **feature flags**, strangler-fig (old + new coexist), dogfood, flip default, remove old last | No big-bang rewrite of a shipping app | [rollout](agent-model-rollout.md) |
| D10 | **Tabs stay and stay central** — each space owns its `tabIds`; reuse `OmniTabBar`. Style as **defined, bordered tabs** (surface + hairline border, active tab elevated with an accent bar and connected to the content area) — **NOT** borderless "ghost" tabs. The home/landing state simply has no open tabs yet; that is not "tabs removed." | Owner found borderless floating tabs confusing 2026-07-15 | conversation |
| D9 | **Pre-release data is disposable** — clean reseeds are fine now; owner *wants* to re-walk onboarding. **Post-release: never wipe.** Migration runner is **deferred** to the first post-release schema change (not speculative); add a cheap **tripwire** now | Owner constraint 2026-07-15 | [rollout](agent-model-rollout.md) |

## 4. Execution sequence (each step ships alone, is reversible via flag)

Full detail in [agent-model-rollout.md](agent-model-rollout.md). Summary:

0. **Set up reversibility first (§4½), then verify + commit the live-sync fix.** Tag
   `pre-redesign-baseline` on `main`, cut a `redesign/*` branch. Runtime-verify the live-sync fix
   (uncommitted in `src/App.tsx`) in the real Tauri app (two windows, overlay↔main sync holds
   mid-stream), not just typecheck. Optionally add the migration **tripwire** comment/guard at the
   reseed branch. Commit on the branch, one concern per commit.
1. **Agent-model pivot = UI/vocabulary only, ZERO data migration** (fields already exist, D4).
2. **Flag scaffold:** add `settings.newShellEnabled` (default `false`), following the
   `dreamAutoEnabled` pattern in `src/store/useSettingsStore.ts`.
3. **Strangler-fig nav:** new space-switcher shell when flag on, current `AppSidebar` when off. Coexist.
4. **Collapse chat = space** (flagged). `Space.chatId` already exists; mostly wiring. Reseed freely
   pre-release — no data-preserving migration for the redesign itself.
5. **Reframe agents** (flagged): hide the AGENTS roster; workers as group cards inside a space; add
   an "equip Alexis with expert X" attach point (reuse the `llm.ts` system-prompt assembler + the
   group-chat prompt merge at `src/App.tsx` `buildChannelPromptAddendum`).
6. **Glass uplift — separate flag** `settings.glassEnabled`, pure CSS tokens in `src/index.css`.
   Use the "safe-premium" discipline: glass only on floating chrome (not a global `backdrop-filter`
   wildcard — that janks in WKWebView and nests illegibly); drive the cursor-glow/tilt via
   `ref.style.setProperty` not React state; honor `prefers-reduced-motion`.
7. **Dogfood 1–2 weeks, flags on.** Answer the deferred **mount** question here (docked chat vs
   sidecar-only) by real use.
8. **Flip defaults, keep old code one release, then remove.** Additive first, subtractive last.

## 4½. Reversibility contract — how to go back if it fails

This effort must be undoable at three levels. **Set all three up before Step 1.**

**1 · Code (git).**
- **Tag today's `main` as `pre-redesign-baseline`** before any change. `git checkout
  pre-redesign-baseline` restores the exact known-good app at any time.
- All work on a `redesign/*` branch; `main` stays shippable. Abandon = delete the branch — `main`
  is never touched.
- **One concern per commit** → `git revert <sha>` undoes any single step without unwinding the rest.
- Old code (`AppSidebar`, `DockedAgentRail`, …) stays in the tree behind flags until the new path is
  proven. "Go back" needs no code change — just the flag.

**2 · Runtime (flags).**
- Every new surface behind `settings.*Enabled`, default `false`. A build with the flags off behaves
  **exactly like today's app**. A bad dogfood is undone by flipping the flag off — instant, no revert.

**3 · Data.**
- Before the first destructive reseed, **export a dated db snapshot**. Pre-release wiping is
  otherwise one-way; the snapshot is the "go back" for data — restore it to return to pre-redesign
  chats/spaces.

**Abandon procedure (if the redesign fails):**
1. Flip all `*Enabled` flags off → the app is today's app again.
2. Want the old data back? Restore the db snapshot.
3. Abandoning entirely? `git checkout main` (or `pre-redesign-baseline`) and delete the `redesign/*`
   branch. Nothing was merged, nothing is lost.

## 5. Guardrails & gotchas (these will bite a cold agent)

- **DATA-WIPE LANDMINE:** `src/store/useSpaceStore.ts` (`STORE_VERSION = '5'`, ~line 16) **reseeds
  and wipes all chats + messages** on version mismatch (`~line 427`). Pre-release this is fine and
  even wanted. **Post-release it must never happen** (D9). Do not extend the destructive reseed
  branch for released schemas — write a migration instead. Add a loud tripwire now.
- **Don't build the migration runner speculatively.** Only when a real post-release schema change
  needs it. Its shape will be obvious then.
- **No big-bang.** Every new surface behind a flag, coexisting with the old. Rollback = flag off,
  never a data revert. If a step can only be undone by touching the db, it's scoped wrong — split it.
- **`npm install --legacy-peer-deps`** is required (React 19 vs emoji-mart peer dep). A plain
  `npm install` fails.
- **Verify in the real app, not just typecheck.** Typecheck/tests are necessary, not sufficient, for
  anything a user can see. The overlay sync specifically needs the *Tauri* app (two windows), not the
  bare web view.
- **Releases are adhoc-signed;** users can't cleanly roll a binary back (TCC grants void on update),
  which is *why* post-release data must survive forward.
- **`agentGoals` is keyed by agent id** — a multi-agent vestige; treat as per-space worker jobs, not
  a live "pick an agent" roster.

## 6. Cold start

```bash
npm install --legacy-peer-deps      # required flag
npm run typecheck                   # tsc --noEmit
npm test                            # vitest
npm run tauri:dev                   # the REAL app (Tauri, multi-window) — needed to verify overlay sync
npm run dev                         # web view only (vite, port 1420) — NOT enough for the ⌘F overlay
```
Preview via the launch.json config named `web` (port 1420) for pure-UI checks. The ⌘F sidecar and
overlay↔main sync only exist under `tauri:dev`.

## 7. Key files map

| Area | File | Notes |
|------|------|------|
| Left sidebar roster (to replace) | `src/components/AppSidebar.tsx` | PEOPLE ~149, AGENTS ~213, SPACES ~261 |
| Space/tab data model | `src/types/omniTab.ts` | `Space` (agentIds, chatId, agentGoals, tabIds), `SpaceKind='dm'\|'space'`, `OmniTabType` incl. `space-log` |
| Space store + MIGRATION landmine | `src/store/useSpaceStore.ts` | `STORE_VERSION` ~16, hydrate/reseed ~407, **wipe branch ~427** |
| Agent record + Codey | `src/store/useAgentStore.ts` | fields: prompt, tools, trainingDocs, drive/driveEnabled, defaultMode; `CODEY_ASSISTANT` ~77 (app-bound worker) |
| System-prompt assembler (skills live here) | `src/services/llm.ts` | ~288–339 merges prompt+trainingDocs+tools+drive |
| Group-chat prompt merge | `src/App.tsx` | `buildChannelPromptAddendum(...)` ~2314 (multi-participant precedent) |
| Live-sync fix (Step 0, uncommitted) | `src/App.tsx` | `spotlight-chat-updated` listener ~360, pending-hydrate effect ~706 |
| Docked in-app chat | `src/components/DockedAgentRail.tsx`, `ChatPanel.tsx` | the right-panel mount; fate decided in dogfood (D-mount) |
| ⌘F sidecar overlay | `src/components/SpotlightBar.tsx`, `src-tauri/src/lib.rs` | `dock_spotlight_right` ~2175, `show_spotlight` ~2190 |
| Feature-flag pattern | `src/store/useSettingsStore.ts` | `dreamAutoEnabled` ~183, `developerMode` ~66 (opt-in booleans) |
| Visual tokens | `src/index.css` | `--af-panel`/`--af-accent` (lavender `#7f77dd`), ember glow `rgba(224,120,90,…)` |

## 8. Docs to read (in order)

1. [alexis-sidecar-spec.md](alexis-sidecar-spec.md) — the doctrine (one assistant, receipts, chips, ⌘F overlay). §1–4.
2. [agent-model-rationale.md](agent-model-rationale.md) — **why** single-orchestrator + skills/workers, research-backed. Resolves the "specialists vs one assistant" tension.
3. [main-window-redesign-prompt.md](main-window-redesign-prompt.md) — the IA brief (before/after map, switcher, deliverables).
4. [agent-model-rollout.md](agent-model-rollout.md) — the safe, flagged, strangler-fig sequence + migration policy.

## 9. Genuinely open questions (decide during build/dogfood, not settled)

- **Mount:** does the main window keep a docked chat, or is ⌘F the only composer? Deferred to dogfood
  (D8/step 7). Design so removing the docked mount doesn't break layout.
- **Thread routing:** when ⌘F fires over another app, which thread opens — the active space's, or a
  persistent "Quick ask" 1-agent space? Recommended: active space by default, chip switches, plus a
  standing Quick-ask space.
- **Knowledge scoping:** per-space with global fallback, or global with per-space pinning? Cross-space
  recall/search must exist regardless (Slack Unified-Grid lesson).
- **Home ask-bar routing:** must not become a third chat — opens the conversation pre-filled, or is
  pure search. Pick one.
