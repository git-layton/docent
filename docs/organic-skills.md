# Organic skill learning

How Docent acquires new skills by **doing**, not by decree.

## The idea

Docent already stores procedural skills as **playbooks** (`src/services/appliedMemory.ts`): a task-intent → a sequence of steps, held behind a `verified` trust flag until it has earned the right to be suggested. Today a playbook only exists if the model explicitly **decrees** one mid-turn (a `playbook:capture` action). If the agent doesn't think to name a skill in the moment, the skill is never learned.

Organic learning flips that: after the agent completes a multi-step task, the system **distills a candidate skill from what it actually did** and lets repetition decide its fate.

- A task the agent keeps doing **crystallizes** into a suggestable skill.
- A one-off **decays** and is quietly forgotten.
- Nothing changes about safety: a learned skill only ever becomes an **offer** (`formatProceduresBlock`), never an auto-run, and every step is still individually confirmed at execution time.

## The engine (`src/services/organicSkills.ts`)

Pure, dependency-light, fully unit-tested (`src/tests/services/organicSkills.test.ts`). It holds the learning **policy** only — no disk or store access — so it can be reasoned about and tested in isolation.

| Function | Role |
| --- | --- |
| `distillCandidate(intent, actions)` | Turn a completed action sequence into an **un-verified** candidate (`seen: 1`). Returns `null` for tasks too small to reuse (`< minSteps`). Collapses retry/pagination loops. |
| `observeCompletion(prior, fresh)` | Fold a fresh observation into a known skill: refresh its step shape (tasks drift) and increment `seen`. Pure — never mutates. |
| `shouldPromote(skill)` / `promote(skill)` | The **trust gate**: a candidate becomes suggestable once it has recurred enough (`seen ≥ promoteAfterSeen`) or the user approved it (`accept ≥ promoteAfterAccept`). |
| `isStale(skill)` | An un-promoted candidate untouched past `decayAfterDays` is forgotten. Verified skills never decay. |
| `composeSkillContext(surface, learned)` | Combine the **static** surface skills (`src/data/skills.ts`) with the **learned**, verified skills into one prompt block. |

Defaults (`DEFAULT_SKILL_POLICY`): `minSteps 2`, `promoteAfterSeen 3`, `promoteAfterAccept 1`, `decayAfterDays 30`.

## Storage

Reuses the playbook records under `memory/spaces/<spaceId>/playbooks/<trigger>.md`. The only schema change is an additive `seen:` frontmatter counter (backward-compatible: pre-existing playbooks parse as `seen: 0`). Distillation writes a candidate with `verified: false`; promotion flips it to `verified: true` via the existing `buildPlaybookRecord` path.

## Integration seam (not yet wired — intentional)

The engine is complete and tested; the disk/store wiring is left as a separate, low-risk step so it can land deliberately. Three touch points in `src/App.tsx`:

1. **On task completion** — where a turn's confirmed tool actions are known (near the `playbook:execute`/`persistPlaybook` handling around `App.tsx:295`), build `CompletedAction[]` from the turn's gated actions and call `distillCandidate(userMsg.content, actions)`.
2. **Reinforce + promote** — read the existing candidate for that trigger (`listPlaybooks`/read), `observeCompletion(prior, candidate)`, `promote(...)`, and write back with `buildPlaybookRecord({ ..., seen, verified })`. This reuses the untrusted-content guard already gating memory/playbook writes (`App.tsx:284`).
3. **Retrieve into the prompt** — where `_knownProcedures` is built (`App.tsx:2058` via `retrievePlaybooks` → `formatProceduresBlock`), swap in `composeSkillContext(surface, learnedSkills)` to layer surface skills alongside the learned ones.

A periodic `isStale` sweep fits naturally into the **dream cycle** (`src/services/dreamer.ts`), alongside its existing `playbook_refine` op, so forgetting happens during reflection rather than on the hot path.

## Safety

- Candidates are invisible until promoted — a lucky one-off is never pitched as a proven procedure.
- Distillation is skipped on any turn that ingested untrusted web/email content (the existing guard), so a hostile page can't plant a skill.
- Steps remain natural-language intents with soft tool *hints*, never bound actions; each run is re-derived and re-confirmed.
