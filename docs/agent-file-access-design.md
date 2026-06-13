# Local File Access & Command Actions — Design

Status: **draft for review** · Author: pairing session · Date: 2026-06-13
Scope: let agents work with the user's local files **without** a "whole-disk" mode — a sandboxed
workspace they own, an explicit import gesture for the user's files, and a consent gate for anything
that touches the real filesystem. Plus a later, gated **command-approval** primitive (so an agent can
propose `git push`, `npm test`, etc.). Trust/consent is a first-class constraint, not an add-on.

> Grounded in the current code. Proposes an **incremental** path — every phase leaves the app
> shippable. Phase 0 (the `~/AgentForge` path-jail + capability `effect` tiers + browser-panel ACL)
> already exists; this design re-points and extends it rather than inventing a new model.

---

## 1. Goals / non-goals

**Goals**
- G1 — *Agent has a desk.* A workspace folder it can read/write/create/delete freely, with undo.
- G2 — *The user's files come in by an explicit gesture*, and a copy is **never** a confusing orphan.
- G3 — *Touching the real filesystem is always consented*, and the consent shows the **actual change**
  — never a blank "allow file write."
- G4 — *Agents can run commands (git/shell) only behind an opt-in, per-command-approved gate.*

**Non-goals (for now)**
- No "give the agent your whole disk" mode. Default-deny outside the jail stays.
- No git/GitHub **connector or OAuth**. Git auth already lives in the OS (Keychain credential helper /
  SSH agent); an agent that runs git in your repo borrows your existing credentials. There is nothing
  to "pass back."
- No background/autonomous file mutation outside the workspace — outside ops require a user turn.

---

## 2. Current state (what we build on)

| Concern | Today | File |
|---|---|---|
| Path jail | `knowledge_path_from_input()` normalizes (collapses `..`) and **rejects anything outside `~/AgentForge`** | `src-tauri/src/lib.rs:118` |
| Guarded write | `safe_write_file()` + "Nuke Shield" (blocks mass-delete) | `src-tauri/src/lib.rs` |
| Memory I/O | `write_memory`, `read_knowledge_file`, `search_knowledge_semantic` (all jailed) | `src-tauri/src/lib.rs` |
| Local versioning | `run_git()` — commit/diff/stat; **no remote, no push, no auth** (the undo tape) | `src-tauri/src/lib.rs:144` |
| Import-by-copy | drag/drop or click → extract text in JS → `write_memory` into `~/AgentForge/library/` | `src/components/KnowledgeDropZone.tsx` |
| Capability model | `Capability { effect: 'read' \| 'write' \| 'authority', surfaces, routes, execute }` | `src/services/capabilities/types.ts` |
| Capability registry | explicit import-list: knowledge-search, web-search, browse, calendar | `src/services/capabilities/index.ts` |
| OS picker / fs plugin | `tauri-plugin-dialog` + `tauri-plugin-fs` **pulled in but dormant** (init'd, not in invoke_handler, not imported in TS) | `src-tauri/src/lib.rs` |
| Trust tagging | `trustOfTab`, untrusted-content delimiter in ambient context | `src/services/trust.ts`, `src/services/context/ambient.ts` |
| Remote isolation | browser-panel webview can reach only 4 safe reporters; everything privileged is denied (test-proven) | `src-tauri/src/lib.rs:3337`, `capabilities/*.json` |

**Key reuse wins:** the jail, the undo tape, and the `effect: read|write|authority` consent ladder
already exist. The agent already *can't* call file commands (they're UI-invoked). We add a `files`
capability + a consent service; we do not loosen the existing fences.

---

## 3. Trust & consent model (the constraint that shapes everything)

This app runs an agent that reads **untrusted web pages** in the browser-panel. File + command access
raises the stakes: prompt-injection + file-write/`git push` = an exfiltration/destruction vector. So:

1. **Untrusted content is DATA, never authorization.** Web/page/email text can never *grant* a file or
   command action. Routed through the existing untrusted-content delimiter (`trust.ts`); the consent
   decision is the user's, never the page's.
2. **File/command capabilities are unreachable from the `browser-panel` webview** — consistent with the
   existing ACL (`allow-app-local` only on `main`/`spotlight`; the remote capability stays the 4-command
   surface). Add to the lib.rs remote-isolation test.
3. **Effect tiers map to consent:**
   - *read inside workspace* → silent.
   - *write/delete inside workspace* → silent (it's the agent's desk; git-backed undo).
   - *read outside workspace* → light consent (per-path, remembered).
   - *write/delete outside workspace* → `effect: 'authority'`, **never silent**, shows the change.
   - *run a command* → `effect: 'authority'`, off by default, per-command approval.

---

## 4. The Workshop — file access model (G1–G3)

### 4a. Tier 1 — the agent's own folder: full access, zero prompts
A new `~/AgentForge/workspace/` is the agent's desk: full read/write/create/delete, no confirmation,
because nothing of the user's lives there unless imported, and it's git-backed (`run_git`) so every
change is reversible. New Rust commands (`fs_list`/`fs_read`/`fs_write`/`fs_delete`) reuse the
`knowledge_path_from_input`-style jail, rooted at the workspace.

### 4b. Tier 2 — bringing the user's files in: **ask per file**, route by context
The duplication worry ("which copy is the real one? did I just fork someone's repo?") is solved by
**not copying blindly** plus **provenance**:

- **Repo/project files → work in place (do NOT copy).** If the chosen file is inside a git repo /
  project folder, copying it out loses git tracking, breaks imports, and creates the stale-duplicate
  confusion. These default to edit-in-place via the Tier-3 consent path.
- **Loose documents → import a copy** into the workspace (generalizes `KnowledgeDropZone` via the
  dormant `tauri-plugin-dialog` OS picker + existing drag/drop).
- **The agent recommends**, the user confirms per file (it's a small, per-file choice, not a global mode).
- **A copy is never an orphan.** Imports carry provenance frontmatter (`source: <abs path>`,
  `imported: <date>`) and the UI shows "working copy of …" with **Open original · Re-sync from original ·
  Push changes back · Detach**. The user always knows which is canonical.

### 4c. Tier 3 — touching the real filesystem: consent that shows the change
The confirm dialog is the product. It never says "allow file write." It shows:

- **Plain verb + exact absolute path** ("Lexi wants to **overwrite** `/Users/you/Desktop/report.md`").
- **The change itself:** a **diff preview** for edits, full content for new files, the target for deletes.
- **Context flags:** ⚠️ "tracked in git repo `myrepo`", ⚠️ "outside the agent's workspace".
- **Explicit scope ladder, narrowest pre-selected:** `Just this once` · `This file` · `This folder` ·
  `Deny`. "Always" never silently widens; a **grants manager** lists every standing grant and revokes.
- **Tiered visual weight:** read = quiet · write = yellow · delete / outside-workspace = red, never
  pre-checked.
- **File-activity log** (receipts): a running feed of what touched which file.

Remembered grants are keyed by path/folder + effect, persisted, and never inherited by the browser-panel.

---

## 5. Command actions — the console-approval card (G4, gated + later)

The user's "console action UI element" instinct is the right shape — built **general, not git-specific**,
because the agent will also want `npm test`, `ls`, etc. There is **no git auth to build**: a command run
as a subprocess in the user's repo borrows the OS's already-configured git credentials.

**The command-approval card:**
- Agent proposes a command → card shows the **exact command**, the **working dir**, and **which
  repo/remote/branch** it will hit.
- User approves: `Just this once` · `Always in this repo` · `Deny`.
- **Output streams back** into the card; every run is logged in the activity feed.
- Same philosophy as the file-write confirm: *show the actual thing, scope the grant, log it.*

**Guardrails (this is the most powerful capability in the app):**
- `effect: 'authority'`, behind an explicit **"let agents run commands" / Developer Mode** toggle that is
  **OFF by default**.
- Unreachable from the browser-panel webview; web text is data, never a command grant.
- Git is just one kind of command flowing through this — no special-case git integration.

---

## 6. Migration plan (incremental, each phase ships)

- **Phase 0 — foundation. ✅ exists.** `~/AgentForge` path-jail, Nuke Shield, `run_git` undo tape,
  capability `effect` tiers, browser-panel remote isolation (test-proven).
- **Phase 1 — Workspace + `files` capability (read/write inside the jail).** Create
  `~/AgentForge/workspace/`; add `fs_list/read/write/delete` Rust commands (workspace-rooted jail) and a
  `files` capability (`effect: 'write'` inside). Full rwx, no prompts, git-backed undo. *Ships: the agent
  has a desk.*
- **Phase 2 — Import + consent dialog.** Wire `tauri-plugin-dialog` OS picker; generalize import-by-copy
  with provenance + the working-copy UI; repo-vs-loose routing; build the consent dialog component
  (diff preview, scope ladder, activity log). *Ships: user can hand files in safely.*
- **Phase 3 — Outside-workspace access (`effect: 'authority'`).** Read/write/delete outside the jail via
  the consent gate + remembered grants + grants manager; add to the remote-isolation test. *Ships:
  "edit my Desktop file" with real consent.*
- **Phase 4 — Command-approval card (opt-in).** Developer Mode toggle (off by default); general
  console-action card with streamed output; git commit/push flow through it. *Ships: agent can run
  commands the user approves.*

Each phase is independently reviewable/revertable. Phase 1 is the unlock; 2–4 layer on top.

---

## 7. Decisions (resolved 2026-06-13)

1. **Model = "Workshop", not whole-disk.** Extend the `~/AgentForge` jail; agent owns a workspace; the
   real filesystem is default-deny.
2. **Bringing user files in = ask per file** (small per-file choice). Agent **routes by context**:
   repo/project files edit in place (never copy); loose docs import a copy. Copies carry provenance and a
   working-copy UI — never an orphan.
3. **Outside-workspace writes = anywhere-with-confirm**, where the confirm **shows the actual change**
   (diff/content/target), flags repo + outside-workspace context, and offers an explicit, narrowest-first
   scope ladder.
4. **No git integration / OAuth.** Internal git is the invisible undo tape (done). Editing a repo file is
   just file editing — the user commits/pushes. If the agent runs git itself, it goes through the
   command-approval card and borrows OS credentials.
5. **Command actions are general, gated, and last.** One console-approval card for all commands; `effect:
   'authority'`; Developer Mode off by default; never reachable from the browser-panel.
