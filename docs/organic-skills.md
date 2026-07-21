# Organic skill learning

How Docent acquires new skills by **doing**, then lets you bless them.

## The idea

Docent already stores procedural skills as **playbooks** (`src/services/appliedMemory.ts`): a task-intent → a sequence of steps, held behind a `verified` trust flag until it's allowed to be suggested. What was missing is how a skill gets *born*. Today a playbook only exists if the model explicitly **decrees** one mid-turn (a `playbook:capture` action). If the agent doesn't think to name a skill in the moment, the skill is never learned.

Organic learning flips that: after the agent completes a multi-step task, the system **distills a candidate skill from what it actually did** and reinforces it each time the task recurs. But — critically — a candidate is **never made suggestable on its own**. Recurrence only **proposes** the skill; you make it real with one tap.

- A task the agent keeps doing accrues observations and gets **proposed** in Settings › Playbooks.
- You **trust** it → it becomes suggestable (an offer the agent can make).
- A one-off you never trust **decays** and is quietly forgotten.

## Why it never self-promotes (SEC-PLAYBOOKVERIFY)

`src/App.tsx` carries an explicit invariant: a procedure becomes `verified`/suggestable **only through an explicit user action**, never from an agent signal — so a prompt-injected or hallucinated pattern can't turn itself into an offer. Organic learning respects that exactly:

- Distillation is **skipped entirely on any turn that ingested untrusted web/email content** (reuses the existing guard), so a hostile page can't plant a skill.
- Captured candidates are written **`verified: false`**. Nothing in the engine sets `verified`.
- Only the user's **trust toggle** (Settings › Playbooks, `reinforcePlaybook({ verify: true })`) promotes a candidate. Recurrence just raises its `seen` count and *proposes* it.
- Even once trusted, a skill is only ever an **offer** — never an auto-run — and each step is individually confirmed.

## The engine (`src/services/organicSkills.ts`)

Pure, dependency-light, fully unit-tested (`src/tests/services/organicSkills.test.ts`). Learning **policy** only — no disk or store access.

| Function | Role |
| --- | --- |
| `distillCandidate(intent, actions)` | Turn a completed action sequence into an **un-verified** candidate (`seen: 1`). `null` for tasks below `minSteps`. Collapses retry/pagination loops. |
| `observeCompletion(prior, fresh)` | Fold a fresh observation into a known candidate: refresh its steps (tasks drift) and increment `seen`. Pure — never mutates. |
| `shouldPropose(skill)` | Whether the candidate has recurred enough (`seen ≥ proposeAfterSeen`) to surface for the user to trust. **Never** sets `verified`. |
| `isStale(skill)` | An un-trusted candidate untouched past `decayAfterDays` is forgotten. Trusted skills never decay. |
| `composeSkillContext(surface, learned)` | Combine the **static** surface skills (`src/data/skills.ts`) with the **user-trusted** learned playbooks into one prompt block. Un-trusted candidates are filtered out. |

Defaults (`DEFAULT_SKILL_POLICY`): `minSteps 2`, `proposeAfterSeen 3`, `decayAfterDays 30`.

## Storage

Reuses the playbook records under `memory/spaces/<spaceId>/playbooks/<trigger>.md`. The only schema change is an additive `seen:` frontmatter counter (backward-compatible: pre-existing playbooks parse as `seen: 0`).

## Wiring (live)

- **Capture** — `src/App.tsx` `handleAgentActions`: after a turn's confirmed tool actions run, `captureOrganicSkill` distills a candidate, folds it into any prior record (`readPlaybookByTrigger` → `observeCompletion`), and writes it back **preserving the existing `verified`/`accept`** (organic capture never flips trust). Gated on `!turnIngestedUntrusted` and `≥ minSteps`.
- **Propose** — when `shouldPropose` is true, a one-line toast points the user to Settings › Playbooks; the existing playbook list (`ProfileSettingsModal`, trust/untrust toggle) is where they bless it.
- **Retrieve** — where the turn's `_knownProcedures` block is built, `composeSkillContext({ mode }, await retrievePlaybooks(...))` layers the surface skill onto the user-trusted playbooks. For plain chat this is byte-identical to the old procedures block (a surface skill only applies on the code/doc surfaces).

## Dream-cycle unification (live)

Skill *lifecycle* — forgetting and proposing — runs during reflection, not on the hot path. A deterministic sweep at the end of `runDreamCycle` (`src/App.tsx`) walks the un-trusted candidates already in the Dreamer's working set:

- **Decay** — `isStale` candidates are archived via the existing `archive_memory_file` op, so a forgotten skill shows up in the dream digest as an **undoable** "pruned" item.
- **Propose** — a candidate that has recurred enough (`shouldPropose`) is surfaced as a digest **notice** ("Save '…' as a skill?") and stamped `proposed: true` so later dreams don't re-nag. Trust is still an explicit tap in Settings › Playbooks — the proposal never sets `verified`.
- **Refine** — trusted skills' steps are cleaned up by the Dreamer's existing `playbook_refine` op (now preserving `seen`/`proposed`).

The sweep is deterministic (no LLM, no extra tokens) and reuses the dream digest's undo/notice machinery. Capture on the hot path is silent — the digest is the single place skills are proposed.

## Future

A dedicated "proposed skills" section in the playbook UI (ranked by `seen`) would make blessing candidates a first-class action rather than a digest notice.
