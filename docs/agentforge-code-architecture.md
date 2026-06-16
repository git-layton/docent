# AgentForge Code — architecture & principles

_Companion to `agentforge-code-design.md` (which covers product/IA). This is the technical pass:
research-grounded principles, the layered architecture, the security model, a complete tool inventory
(have vs. need), and the build phases. Written 2026-06-15._

Sources grounding the principles: Anthropic, *Building Effective Agents*
(anthropic.com/engineering/building-effective-agents) and *Claude Code Best Practices*
(code.claude.com/docs/en/best-practices).

---

## 1. Principles (and how our design already honors them)

| # | Principle (from the research) | How AgentForge Code applies it |
|---|---|---|
| P1 | **Simplicity first — composable patterns, not frameworks.** | Two surfaces (Canvas/Code), files as the universal substrate, the terminal as the universal adapter. No bespoke integration where a CLI + a file will do. |
| P2 | **Transparency — show the plan and the steps.** | Glass-box terminal (you watch the agent run commands); card-based `file_op`/command actions; the activity receipts log. |
| P3 | **Agent-Computer Interface: design tools like a docstring; poka-yoke them.** | Capability descriptions read like docstrings; `file_op` uses *absolute* paths for real files (the exact poka-yoke the research cites) and relative for the workspace; malformed ops are rejected, not guessed. |
| P4 | **Give the agent a way to verify its work (tests / build / screenshot).** | **Preview-observation** is this principle — READ (DOM+console) + LOOK (screenshot via vision). The terminal lets it run tests/builds and read exit codes. This is the highest-value capability, not a nice-to-have. |
| P5 | **Explore → plan → code → commit; plan as a durable artifact.** | Our "a plan is just a file" (`plan.md`) = their SPEC.md/plan-mode. Files = durable memory; chat = thinking. Plan mode should write a file. |
| P6 | **Persistent project context (CLAUDE.md), concise.** | A per-space project-context file the agent reads every turn (our `AGENTS.md`/`CLAUDE.md` equivalent) — see NEED list. Keep it short; prune ruthlessly. |
| P7 | **Permissions: allowlist / classifier / sandbox — reduce prompts, keep control.** | Already built: consent tiers (workspace auto · external w/ remembered grants · command via Developer Mode), the `~/AgentForge` path-jail, the remote-isolation ACL. Grants = allowlist. Future: an OS sandbox option + an auto-classifier tier. |
| P8 | **Context window is the scarce resource; use subagents for investigation.** | Files-as-memory keeps the chat lean; ambient/tool-context publishes only what's open. Multi-agent spaces map to subagent investigation. |
| P9 | **CLI tools are the most context-efficient integration.** | The terminal exposes every installed CLI (`gh`, `git`, `npm`, …) + the real `claude`/`codex`/`gemini` — instead of N bespoke integrations. |
| P10 | **Course-correct early; checkpoints/rewind.** | Workspace is git-versioned (undoable). Per-space folders isolate blast radius. Consider a rewind/checkpoint affordance over the git history. |

**Net:** the design we converged on conversationally is, independently, the documented best-practice
shape for an agentic coding tool. The two sharpened additions from the research: a concise **per-space
project-context file** (P6) and treating **verification/preview-observation as core, not optional** (P4).

---

## 2. Architecture — three layers

```
┌─ SURFACE (human) ───────────────────────────────────────────────┐
│  Canvas (make)        Doc (write)        Code (dev) ── a space   │
│                                          ├ file tree             │
│                                          ├ editor (CodeMirror)   │
│                                          ├ terminal (PTY)        │
│                                          ├ git (status/diff)     │
│                                          └ preview (dev server / │
│                                             canvas observe)      │
│  Agent rail (chat) drives all of the above; output = cards      │
└──────────────────────────────────────────────────────────────────┘
            │ capabilities (agent tools, registry-resolved)
┌─ CAPABILITY (agent) ────────────────────────────────────────────┐
│  files · command · preview-observe · browse · search · …        │
│  consent layer (classify → auto | grant-gated | approval card)  │
└──────────────────────────────────────────────────────────────────┘
            │ Tauri invoke (ACL-gated: never reachable from browser-panel)
┌─ ENGINE (Rust) ─────────────────────────────────────────────────┐
│  fs_* (jailed) · run_command · NEW: PTY · process mgr · git ·    │
│  watcher · screenshot · keychain · models · graph · connectors  │
└──────────────────────────────────────────────────────────────────┘
```

**Data flow (a turn):** user speaks in the rail → gatekeeper routes to a capability → capability folds
context (e.g. the space's file tree + open file) → agent emits `file_op` / command blocks → consent
layer classifies → auto-applies (workspace) or renders an approval card (external/command) → Rust runs
it → result streams back as a card → preview-observation feeds the rendered result back so the agent can
self-correct. Per-space scoping: every relative path resolves under `spaces/<id>/` (the agent-scoping wire).

---

## 3. Security model (already strong — extend, don't rebuild)

1. **Path jail** — `workspace_path_from_input` normalizes & rejects escapes; everything lives under `~/AgentForge`.
2. **Consent tiers** — workspace = auto (git-undoable); external = approval card showing the exact change + scoped grants; command = Developer Mode + per-command approval.
3. **Remote isolation** — every `fs_*`/`run_command` (and new commands) is on the ACL DENIED list; unreachable from the `browser-panel` webview. Enforced by an automated test.
4. **Web content = data, not instructions** (`trust.ts`) — page text the agent reads is fenced as untrusted.
5. **New surface area to gate:** the PTY/terminal and hosted external CLIs run with the user's real shell + credentials. Gate behind Developer Mode + approval; never auto-install (`curl|bash` only via an approved card). **Open question:** offer an OS-level sandbox (P7) for unattended runs.

---

## 4. Tool inventory

### Have today (engine: ~116 Tauri commands; agent capabilities: 5)

- **Workspace files:** `fs_list/read/write/mkdir/delete/move` (jailed, git-committed).
- **Real FS + consent:** `fs_read/list/write/delete_external`, `fs_import`, `fs_probe_context`, `fs_reveal`.
- **Command (one-shot):** `run_command` (login shell `-lc`, Developer-Mode-gated).
- **Browser/preview primitives:** `browser_create/navigate/eval/find/...`, `extract_page_text`, `check_page_is_private` — reuse for dev-server preview + page READ-observation.
- **Models (local LLM):** `start_local_model`, `download_model`, GGUF listing, hardware/RAM stats, llama server control.
- **Knowledge core:** memory/library/graph ops, semantic search, file watcher (`init_file_watcher`), `safe_write_file`/`rollback_file`.
- **Agent capabilities (registry):** `files` (read workspace into context), `browse`, `webSearch`, `knowledgeSearch`, `calendar`.
- **Agent → tools:** `agentActions.ts` (`forge:action` blocks → notes/tasks/calendar/mail/imessage), `file_op` blocks → FileActionCard/CommandActionCard.
- **Connectors/integrations:** mail (8), iMessage (6), EventKit (12), Notes (6), keychain (3).

### Need to build (the gap for AgentForge Code)

**Engine (Rust) — the real new lift:**
- **PTY / interactive terminal** ⭐ the crux. `run_command` is one-shot; hosting an *interactive* `claude`/`codex`/`gemini` or a REPL needs a pseudo-terminal with streaming I/O, resize, and a persistent session. (`portable-pty`/`tauri-plugin-shell`-style; stream chunks over a Tauri event, mirror the WKWebView two-way pattern.)
- **Long-running process manager** — spawn/track/kill dev servers (`npm run dev`), expose the port, health. Distinct from one-shot `run_command`.
- **Preview screenshot** — capture a rendered canvas iframe / webview to an image for LOOK-observation (gated by `supportsVision`).
- **Per-space file watcher** — extend `init_file_watcher` to the active space folder so the tree + the agent's view stay live.
- **External-CLI detection** — `‹bin› --version` probes for the detect-then-guide onboarding.
- **(Maybe) structured git helpers** — or just drive `git` through the PTY/`run_command`.

**Capabilities (agent):**
- **Agent-scoping** — `file_op` relative paths resolve into the active space's home (the next wire).
- **`command` capability surfaced** in the terminal (gatekeeper route → the terminal pane).
- **`preview-observe` capability** — READ (DOM snapshot + console errors, via postMessage out of the sandbox) and LOOK (screenshot → the vision service).
- **Per-space project-context file** (`AGENTS.md`) folded into the prompt every turn (P6) — concise, user-editable, the durable "how this project works" memory.

**Surface (frontend):**
- **Code IDE shell** — evolve `AgentForgeCodePanel` into file-tree + editor + terminal + git + preview panes.
- **Code editor** — CodeMirror 6 (syntax, large-file friendly) for files; reuse `WysiwygEditor` for Doc.
- **Terminal pane** — friendly, card-based over the PTY (plain-language summaries, collapsible raw, approval-gated; image paste gated by vision).
- **Git pane** — status/diff/commit, agent-driven.
- **Preview pane** — dev-server in the in-app browser at `localhost`; canvas live-preview observation.
- **External-CLI onboarding** — the `EXTERNAL_AGENTS` registry + detect-then-guide install panel.
- **Bridges** — Canvas "save as doc" / "open as project" (promote); Home consolidation already done (Doc · Canvas · Code).

---

## 5. Build phases (consolidated)

0. ✅ **Foundation shipped** — file engine, consent, per-space panel scoping (human side), Home renames (Doc·Canvas·Code).
1. **Agent-scoping wire** — agent `file_op` → active space home. _(next — closes the trunk)_
2. **Per-space project-context file** (`AGENTS.md`) into the prompt. _(cheap, high-leverage; P6)_
3. **Terminal** — PTY engine + process manager + friendly card-based pane + external-CLI onboarding + image input. _(the big lift; the crux)_
4. **Preview-observation** — READ now (model-agnostic), LOOK via the vision service. _(the verify loop; P4)_
5. **Git pane** + **dev-server preview** (localhost in the in-app browser).
6. **Editor** — CodeMirror for in-place editing; open-a-file → editor.
7. Later: OS sandbox option (P7), checkpoints/rewind over git (P10), Canvas data-layer branch (deferred).

---

## 6. Risks / open questions

- **PTY is the hard part** — interactive shell I/O in Tauri/WKWebView is the biggest unknown; prototype it early (phase 3) before committing the terminal UX.
- **Hosting external agents safely** — they run with full user creds; rely on Developer Mode + (later) sandbox. Don't auto-install.
- **Preview LOOK depends on the vision capability** (built in parallel) — keep its entry point callable by a non-chat caller (a preview screenshot), per [[project-multimodal-vision]].
- **Context discipline** — the agent's context should hold the *project-context file + open file + plan*, not the whole tree (P8). Lean on files, not scrollback.

---

## 7. Table-stakes audit + the rail decision (2026-06-15)

**Agent surface — decided:** the Code agent is NOT a bespoke in-IDE panel. It's the **standard docked right rail**
(collapsible, auto-scoped to the active center tab — the existing Phase-2 surface model), consistent with every
other tab. Clean split: **center tab = the work** (tree · editor · terminal · git · preview); **right rail = the
conversation about the work** — Codey follows along and you *chat*, you don't *code* in it. One driver (Codey),
continuity via the shared record (`AGENTS.md`/files), no multi-agent turn-taking.

**Table-stakes audit (vs. research + IDE norms):**

| Capability | Status |
|---|---|
| File tree · open folder · clone repo | ✅ |
| Editor (syntax) · Terminal (PTY) · Run/dev-server · Git | ✅ (phases 3/5/6) |
| Verify loop (tests/build/screenshot) | ✅ phase 4 — above par (our edge) |
| Persistent project context (`AGENTS.md`) · permissions/safety | ✅ |
| **Project-wide content search (ripgrep)** | ⚠️ gap — only a filename filter today |
| **Multi-file diff review (accept/reject a batch)** | ⚠️ partial — have external-write diff cards; need in-project batch review |
| **Code intelligence / Problems (errors, go-to-def)** | ✗ tier-2 gap — mitigate: agent runs typecheck/lint → a Problems view; full LSP later |
| **Checkpoint / rewind UI** | ⚠️ partial — workspace is git-versioned; no rewind affordance yet |

**Four additions to reach table-stakes completeness** (folded into phases): ripgrep **content search**, a
**multi-file diff/review** view, a **Problems** view (typecheck/lint surfaced; the cheap stand-in for LSP), and a
**rewind/checkpoint** affordance over the workspace git history.

**Revised phase list:**
0 ✅ foundation → 1 agent-scoping → 2 `AGENTS.md` → 3 terminal (PTY) → 4 preview-observe →
5 git + dev-server preview + **content search** + **diff-review** → 6 editor (CodeMirror) + **Problems view** →
7 later: **rewind UI**, OS sandbox, Canvas data-layer.

---

## 8. Gap specs (kept lean — reuse, don't expand surface)

Each closes a table-stakes gap with minimal new surface. **Net-new Rust commands across all four: 3**
(`fs_search`, `workspace_history`, `workspace_restore`). Everything else reuses `run_command`/git + small JS.

### 8.1 Content search — phase 5

- **What:** project-wide find (text/regex) across the space folder + mounted repos.
- **Lean impl:** new `fs_search(query, path, regex?, max)` — jailed; shells `rg` (ripgrep) when present (fast),
  else walks with the `ignore` crate. Returns `[{path, line, col, text}]`, capped.
- **UI:** the tree's existing search field toggles filename-filter ↔ content-search; results = a list of
  `file:line` snippets → click opens the file at that line.
- **Agent:** a `code-search` capability route so Codey can grep the project (top hits folded into context — P8).
- **Lean because:** one command + a results list + one capability. No index (semantic search already exists for
  knowledge; this is literal grep).

### 8.2 Multi-file diff review — phase 5

- **What:** review a batch of edits before trusting them; accept/revert per file.
- **Lean impl:** **reuse git.** Workspace edits already auto-commit (`commit_workspace`); the **Diff tab** shows
  working-tree changes (`git status --porcelain` + `git diff`, parsed in JS — no new Rust). Per-file: keep
  (default) or **revert** (`git checkout -- <file>` via `run_command`). External writes keep the existing
  pre-apply approval card.
- **UI:** the **Diff** tab in the bottom pane — changed-files list + per-file diff + Revert.
- **Lean because:** it's the git diff view; no new diff engine. Builds on phase-5 git.

### 8.3 Problems view — phase 6

- **What:** surface type/lint errors — the cheap stand-in for an LSP.
- **Lean impl:** **reuse the terminal.** Run the project's check command (declared in `AGENTS.md`, e.g.
  `tsc --noEmit`, `eslint`, `cargo check`) via `run_command`; parse the common formats (tsc/eslint/cargo) into
  `{file, line, col, severity, msg}`; unparsed output shows raw.
- **UI:** the **Problems** tab — clickable entries → jump to `file:line`; a "Re-run checks" button. The agent
  runs them as part of the verify loop (P4).
- **Lean because:** no language server — just run-the-check + a parser for 1–2 formats. Ties to `AGENTS.md` (phase 2).

### 8.4 Rewind / checkpoint — phase 7

- **What:** step back to a prior state when an edit goes wrong.
- **Lean impl:** the workspace is already git-versioned (every `fs_write/move/delete` auto-commits). New
  `workspace_history(spaceId)` (list recent commits) + `workspace_restore(spaceId, ref)` (checkout/reset) —
  **mirrors the existing `rollback_file` / `revert_memory_commit` pattern** in the knowledge core.
- **UI:** a small **History** list (commit message + time) with "Restore to here."
- **Lean because:** the history already exists; this is a list + restore copied from the rollback infra. Tier-2.

---

## 9. De-risk results (workflow, 2026-06-15)

### Phase 1 (agent-scoping wire) — SHIPPED + verified

`resolveWorkspaceOpPaths(op, tier, spaceId)` in `spaces.ts` (pure, tested) scopes the agent's workspace-tier
`file_op` paths into the active space's home; wired into `FileActionCard` (uses the resolved path in runOp +
activity log; classification still runs on the original op; idempotency intact) and the `files` capability
(lists `spaceHome`, presents space-relative paths). Verified: tsc clean, **vitest 34 in fileAccess / 827 total**,
cargo 48 (ACL invariants green), adversarial review PASS. Three review-flagged gaps then closed: agent `import`
now scopes its `to` into the space (matching the panel); `spacePath` is idempotent (no double-prefix if the
agent re-emits a full path); a no-path `list` scopes to the space home (not the shared root). Remaining: one
COSMETIC item (activity receipt shows the resolved `spaces/<id>/…` path with the opaque id) — left as-is for
audit accuracy.

### Phase 3 (terminal/PTY) — FEASIBLE; concrete approach decided

- **Use `portable-pty` (wezterm)** in a Rust module `pty.rs`, sessions kept in `PtyState(Mutex<HashMap<id, PtySession>>)`.
  A `std::thread::spawn` reader drains the PTY master and streams to the webview via Tauri events — the EXACT
  pattern lib.rs already uses for `download-progress`/file-watcher. Frontend = **xterm.js** (`@xterm/xterm` +
  `addon-fit`); the friendly card layer sits ON TOP of xterm (TUIs emit raw ANSI only a real emulator renders).
- **NOT `tauri-plugin-shell`** — it gives piped stdout, no controlling TTY, so interactive TUIs (`claude`/`codex`)
  switch to dumb mode. NOT a third-party pty plugin (they wrap portable-pty anyway).
- **Commands (sync; reader loop on a thread, never block main):** `pty_spawn(session_id, cwd, cols, rows)`,
  `pty_write(session_id, data)`, `pty_resize(session_id, cols, rows)`, `pty_kill(session_id)`. Events: `pty:data`
  `{sessionId, data}`, `pty:exit` `{sessionId}` (multiplex by sessionId).
- **Security:** add all `pty_*` to `generate_handler!` AND to the remote-isolation DENIED test (~lib.rs:3733);
  Developer-Mode gate + command-approval card in front of agent-originated `pty_write` (treat as privileged).
- **Critical gotchas:** ship **bytes/base64, NOT `String::from_utf8_lossy`** (4 KB reads split multi-byte UTF-8 →
  corrupts box-drawing glyphs — a correctness bug); coalesce reads or use a per-session `tauri::ipc::Channel` if
  WKWebView jank shows; kill children on session-close/space-switch/window-close/app-exit (extend the existing
  `Destroyed` hook that kills the llama sidecar — else zombie `claude`/dev-server processes leak); requires
  **notarized-direct distribution** (Mac App Store sandbox would forbid spawning the shell). Prototype the
  throughput with a real `claude` TUI before locking the UX.

### Phase 2 (`AGENTS.md`) — spec ready

- **Keep `buildSystemPrompt` synchronous** (it backs the sync `systemPromptLen` gauge at App.tsx:561). Add an
  optional `projectContext` param, threaded EXACTLY like `ambientContext`/`goal`. The async read happens OUTSIDE
  the builder.
- **Load** `spaces/<id>/AGENTS.md` into `useSpaceStore.activeProjectContext` via a `loadProjectContext(spaceId)`
  action (fire-and-forget at the end of `setActiveSpaceId` + in `hydrate`; create-if-missing writes an
  `AGENTS_TEMPLATE` via `fs_write`, which auto-creates the dir + git-commits). Defensive re-read in the async
  send path. Guard invokes with the existing `__TAURI_INTERNALS__` check.
- **Render** as a **TRUSTED-LOCAL** `[PROJECT CONTEXT - AGENTS.md]` block right after the goal block, before
  `[ACTIVE TOOLS]` (the user authored it — do NOT fence as untrusted); cap `slice(0,4000)`.
- **Files:** `spaces.ts` (`projectContextPath` + `AGENTS_TEMPLATE`), `llm.ts` (param in buildSystemPrompt +
  generateTextResponse), `useSpaceStore.ts` (state + action), `App.tsx` (3 generateTextResponse call sites + the
  `systemPromptLen` memo), a trust/spaces test. Lean, no new surface.
