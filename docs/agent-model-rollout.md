# Safe rollout — nav + agent-model + visual shift

Status: **execution plan** · Date: 2026-07-15
How to land the [agent-model-rationale.md](agent-model-rationale.md) pivot and the
[main-window-redesign-prompt.md](main-window-redesign-prompt.md) IA without bricking a shipping
app that has persisted user data.

---

## The owner's constraint (2026-07-15) — and how it changes the plan

> "I don't want changes going forward to ever wipe the app. But right now it's not released and
> everything can be wiped."

This splits the effort cleanly into a **free window now** and a **permanent guardrail after**:

- **Now (pre-release, data is disposable):** clean reseeds are fine. Do **not** spend effort
  writing additive old→new migrations for the redesign's own schema changes — just bump
  `STORE_VERSION` and reseed. This removes the hardest part of the migration from the current work.
- **Forward (post-release):** **no change may ever wipe user data again.** That is a standing
  policy, not a per-change judgement call.

The elegant part: **use the disposable-now window to build the thing that guarantees data is never
disposable later.** Today `useSpaceStore.ts` wipes on `STORE_VERSION` mismatch only *because there
is no migration path* — it reseeds by default. So the permanent fix is to replace that with a real
**migration runner** while wiping is still free.

> Caveat: "everything can be wiped" must mean *only disposable data* — your own dev install and
> throwaway dogfood data. If anyone's install (e.g. a family dogfooder) holds chats they'd miss,
> they're the exception; confirm before the reseed lands in a build they run.

## The migration path: deferred, not speculative

Refined 2026-07-15: **don't build a migration runner now.** With no released data to protect and
no schema change to apply to it, a runner would be speculative infrastructure — and today
"migration = clean reseed" is genuinely fine. The owner also *wants* the clean wipe (see below).

The migration path is a **deferred obligation, triggered by the first post-release schema change**.
When that update comes, that is when you write the migration — its shape will be obvious then, not
now.

**The only cheap thing worth doing now** is a *tripwire*, so the deferral can't turn into a silent
data-loss incident: a guard/loud comment at the `STORE_VERSION` reseed branch that says "once a
build with this schema has shipped, do NOT bump through here — write a migration instead." It costs
one comment and a boolean, and it converts "future-me accidentally wipes released data" into an
impossible-to-miss fork. Everything else (the runner, versioned transforms, backup-on-fallback)
waits until there's a real migration to hang it on.

## Embrace the wipe as a dogfooding pass

The owner wants to walk onboarding start-to-finish. So the reseed is a *deliberate* step, not a
regret: wipe, go through the entire first-run flow as a new user would, and log the rough edges.
Default behavior, not a requirement.

## Sequence — each step ships alone and is independently reversible

**0 · Land the foundation you already have.** Runtime-verify the sidecar live-sync fix in the real
Tauri app (not just typecheck), then commit. No user-visible change; it's the prerequisite for
chat = space. Optionally drop the migration *tripwire* comment/guard here (cheap) — but the runner
itself waits for the first post-release schema change.

**1 · Do the agent-model pivot with ZERO data migration.** The fields already exist and are wired
(`prompt`, `tools`, `trainingDocs`, `drive` → `llm.ts`). "Skill = an agent record equipped onto
Alexis" needs no new schema. So this is UI/vocabulary only — which removes the scariest risk by
avoiding it. Nothing to migrate, nothing to wipe.

**2 · Flag scaffold.** Add `settings.newShellEnabled` (default `false`), following the
`dreamAutoEnabled` pattern. Every new surface reads it.

**3 · Strangler-fig the nav.** Render the new space-switcher shell when the flag is on, the current
sidebar when off. They **coexist** — no deletion. Dogfood by toggling between them.

**4 · Collapse chat = space (flagged).** The thread mirrors the space's roster. `space.chatId`
already exists, so this is mostly wiring. Any schema change here can **reseed cleanly** (you're
still pre-release) — no data-preserving migration needed for the redesign itself; the guardrail
from step 0 is for what comes *after* release.

**5 · Reframe agents (flagged).** Hide the global AGENTS roster; surface workers as group cards
inside a space; add the "equip Alexis with expert X" attach point (reuses the existing system-prompt
assembler and the group-chat prompt merge).

**6 · Glass uplift — separate flag.** `settings.glassEnabled`, pure CSS tokens in `index.css`.
Independent of nav so the visual and structural changes can be dialed and reverted separately.

**7 · Dogfood 1–2 weeks, flags on.** This is also where the deferred **docked-chat vs sidecar-only**
mount question gets answered by real use, not argument.

**8 · Flip defaults, then subtract.** Flip flag defaults to `on` in a release; keep the old
sidebar/roster code for one release as a fallback; remove it only once the new shell is proven.
Additive first, subtractive last — never delete-and-replace in one commit.

## Guardrails that apply to every step

- **Verify in the real app.** Run the Tauri app (`/run`, `/verify`) and keep the test suite green
  (`src/tests`) — typecheck is necessary, not sufficient, for a change users can see.
- **One concern per commit.** Nav, agent-model, and visuals are three flags and three review units,
  even though they're one vision — so any single step reverts cleanly.
- **Reversibility is a three-layer contract (see HANDOFF §4½).** Tag `pre-redesign-baseline` on
  `main` before anything. Work on a `redesign/*` branch, merging to `main` per step behind
  default-off flags so `main` always ships. Snapshot the db before the first reseed. Rollback:
  (1) flip the flag off — instant; (2) restore the db snapshot — data; (3) `git checkout
  pre-redesign-baseline` / delete the branch — total abandon. Never rely on a data revert as the
  only undo; if a step can only be undone by touching the db, it's scoped wrong.
