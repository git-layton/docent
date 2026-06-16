# AgentForge Code — the spaces-and-files model

_Decided 2026-06-15. Supersedes the "standalone Files app" framing in the first cut of
`AgentForgeCodePanel`. This is the conceptualization the whole app hangs off, so it lives as a file._

## The one idea

> **The chat is the thinking. The files are the memory. A plan is just a file the agent keeps re-reading.**

Everything else (plan routing, tab-goals, feature-maps, session resets) is machinery we do **not**
need, because a file sitting in a space's folder is already in the agent's context.

## The model, whole

- A **Space** is a session — and a project. One ongoing conversation thread (a "hyper-session"); the
  agent's context never hard-resets. That's fine: you don't tame a long conversation with resets, you
  tame it with durable files + the agent's growing memory.
- Each space has its **own folder**: `~/AgentForge/spaces/<spaceId>/`. This is its home — where new
  files the agent/you create live (plans, `.md` notes, drafts, code). Sandboxed, git-versioned, undoable.
- A space can additionally **mount real folders** (your repos) when you want the agent working in your
  actual code. Mounts are **scoped**: search / read / add / edit-*with-permission*. New scratch never
  gets dumped here — it goes to the space home. (Mounts are recorded as folder grants; see
  `fileAccessGrants`, ideally space-scoped over time.)
- **Canvas is the editor.** Opening any file (home or mount) opens it in Canvas. The agent writing
  `plan.md` produces a real file you open in Canvas. We are NOT building a second editor — we back
  Canvas with real files. (Partial plumbing already exists: artifacts can save to
  `~/AgentForge/library/<name>.md`.)
- **The directory panel** (`AgentForgeCodePanel`) is the file tree for the space's home + mounts —
  browse / search / import / preview. It is **not a global app**; it's the folder view of a space.

## Plans

- A plan is **just a file** (`plan.md`, `features/billing/plan.md`, …). No "current plan" slot, no plan
  ids, no registry. **The filename is the id.** A space holds as many plans as you have efforts.
- **Plan mode** should write its output to a file in the space folder (today it only emits a chat
  message that evaporates). Because the space folder is in the agent's context, the plan is then
  followed automatically — **the file IS the routing.** No routing engine.
- "Which plan is the agent following?" → **whatever doc is open.** The space knows the *tree* of all
  plans exist; only the open one's content is loud in context (that's the focus). This is exactly what
  the panel's tool-context publishing already does for the selected file.

## new doc vs new space

- **Same project → new doc in this space.** (Another feature of the thing you're building.)
- **Different project → new space.** (A separate repo/effort you'd never discuss in the same breath.)

So a **space ≈ a project**, and **features are plan docs inside it** — like one repo with many spec
files. You rarely make a new space; you mostly make new docs.

## What we deliberately are NOT building

Tab-specific goals, a plan-routing engine, a separate "feature-building map," multiple threads per
space. Each is machinery the file-in-context model makes unnecessary. Keep the space goal (one-line
north star) + plan docs (the detail). If a space needs two real tracks, that's a signal to split it
into two spaces.

## Build order

1. **Per-space home folder** — `spaces/<spaceId>/`, scoped jail-relative (no Rust signature changes).
   The panel, the `files` capability, and the agent's `file_op` relative paths all resolve against the
   active space's home, so the human view and the agent's writes are the same folder. _(foundational
   first wire)_
2. **Plan mode → `plan.md`** in the space home, with its content folded into context.
3. **Canvas opens a file** — clicking a file in the panel opens it in the Canvas editor; agent docs are
   real files.
4. **Mount a real folder into a space** — the OS-picker → probe → work-in-place flow, scoped to the
   space.
5. Later: terminal / git pane over `run_command` (Developer Mode), as before.

## Relationship to the engine

The file-access engine (consent tiers, `fs_*` commands, grants, activity, provenance) is unchanged and
already shipped — see `project-local-file-access` memory + `docs/agent-file-access-design.md`. This
document is about the **human-facing surface and the IA** that sits on top of it.

## Update 2026-06-15 (pt 2) — Canvas vs Code resolved, and the terminal

The earlier "merge Canvas into Code" idea is **dropped** for two sharply distinct tools (cleaner than merging):

- **Canvas = the lightweight builder.** Quick in-app artifact/app, sandboxed iframe preview, save-as-app
  (`savedApps`). Stays as-is. The in-app-apps + **data-layer/tiers** branch (Tier 1 own-origin storage →
  Tier 2 host SQLite via `window.forge.db`) is **deferred** and, if ever built, grows from HERE — not from
  the dev tool. Verified facts: the canvas iframe is `sandbox="allow-scripts allow-forms allow-modals"`
  (opaque origin → localStorage/IndexedDB blocked, no backend); `savedApps` persists the CODE blob only,
  not runtime data; `rusqlite` + `tauri-plugin-store` exist to build a real local data layer later.
- **AgentForge Code = the real dev environment.** Per-space real files + a **terminal** + git + dev-server
  preview; local or `git clone` from github. Defined by the terminal / real-dev nature, not "another canvas."

Two products, distinguished by **weight**: lightweight in-app generative (Canvas) vs real terminal-driven
software dev (AgentForge Code). No overlap → both coexist without confusion.

### The terminal is the universal adapter

The defining piece. The engine (`run_command`, Developer-Mode-gated, on the remote-isolation DENIED list)
already exists — only a **viewer** is missing. One terminal makes EVERY installed CLI usable in-app
(`git`, `gh`, `npm`, `python`, `ripgrep`, …) **including the real `claude` CLI** — so the user gets full
Claude Code *with their agents alongside*, and we never replicate it. One terminal beats N integrations.

### Terminal must be SUPER user-friendly (hard requirement)

NOT a raw xterm you must know commands for:
- **Agent-driven by default** — you ask in plain language, the agent runs the commands, you *watch* (glass box). You never need to know the commands.
- **Card-based output, not ANSI soup** — build on the existing `CommandActionCard`: each command + output as a clean block, plain-language summary ("ran `npm install` — 42 packages ✓"), collapsible raw output, success/fail icon, working dir shown.
- **Approval-gated** for risky commands (already: Developer Mode + command card).
- **Optional raw typing** for power users, never required.

### Build order (revised — supersedes the list above)

1. **Agent-scoping wire** — scope the agent's `file_op` relative paths into the active space's home so panel + agent share the folder. _(next)_
2. **Friendly terminal viewer** — the universal unlock (card-based, agent-driven). Turns the trunk into a real dev tool.
3. Git status/diff + dev-server preview (run server → in-app browser at localhost / own window).
4. Canvas: left untouched. Data-layer/tiers = a separate, later, opt-in branch off Canvas.

## Update 2026-06-15 (pt 3) — IA consistency: two surfaces, types under Canvas, terminal lives in Code

The naming/entry confusion ("two apps that both say Code") is resolved by a strict rule:

- **Only TWO top-level surfaces, forever: `Canvas` and `Code`.** The only real mode-fork is *make-an-artifact*
  (lightweight, generated, in-app, previewable) vs *work-on-real-files* (terminal, git, persistent). Name by
  that felt difference; users always know which they want.
- **Everything else is a TYPE under Canvas — never a new top-level app.** Doc, Web page/app, Slides (later),
  Chart/Sheet (later), Image. Rule: a new medium = a new Canvas type. This keeps the top level at exactly two,
  no matter how many mediums get added. That's the consistency guarantee.
- **Entry model — different verbs, no upfront choice between look-alikes:** Canvas = "make something" (you
  always start here for ideas; zero setup). Code = "work on a real project" (go here to open/clone a repo).
  **Promote / "Open as project"** graduates a Canvas artifact into Code when an idea becomes real.
- **Consolidation (a build step):** today's separate Home entries "Document" + "Code Canvas" fold into ONE
  `Canvas` (with quick-starts that preset the type — "New doc", "New page"; the existing `ArtifactStartModal`
  is the type picker). "AgentForge Code" → renamed `Code`.
- **The terminal is NOT a top-level app** (that would break the two-surface rule). It's a **pane inside Code** —
  the IDE layout: file tree + editor + terminal + git + preview. Driven by the agent from the rail; output =
  friendly `CommandActionCard`s. Poppable into its own window later (like the browser), but it lives in Code.

Naming locked: **Canvas + Code.**

## Update 2026-06-15 (pt 4) — Doc is first-class (verb rule) + preview-observation

Revised the strict "only two" rule (pt 3) — docs deserve to be first-class:

- **Top-level = a distinct VERB, not a medium.** Three doors: **Doc = write** (prose/notes/plans — a FILE,
  fits files-as-memory), **Canvas = build** (runnable/renderable artifacts: apps, charts, slides), **Code =
  dev** (real projects + terminal). A new *medium* (slides, chart, image) → a Canvas *type*, never a new door;
  only a new *activity* earns one. No ambiguity (unlike the old Code-Canvas / AgentForge-Code twins).
- A Canvas artifact can **"save as doc"** (capture content → a doc file). The build→write bridge.
- Consequence: we do NOT fold Document into Canvas. The renames already shipped (Code Canvas→Canvas,
  AgentForge Code→Code) land the right state: Home = **Doc · Canvas · Code**.

### Preview-observation — the loop-closer (slots AFTER the terminal)

So the agent can see what it built and self-correct. Two modes:

- **READ (text) — model-agnostic, works today, highest signal for fixing code.** DOM/structure snapshot +
  console errors + extracted text. Canvas: postMessage console/errors out of the sandbox (works even when
  sandboxed) + a DOM snapshot; Code: read the dev-server page via the in-app browser's existing page-capture.
- **LOOK (screenshot) — gated by `supportsVision(modelId)`.** A rendered image for layout/visual issues.
  REUSE the vision capability (being built separately) — attach a screenshot only when the model is
  vision-capable, else fall back to READ. Catalog currently has no vision models, so LOOK waits on that;
  READ is the reliable default. See [[project-multimodal-vision]].

## Update 2026-06-15 (pt 5) — Terminal: image input + external agent CLIs

Two requirements for the friendly terminal pane:

### Image input (like Claude Code)

The terminal input accepts **pasted / dropped images**, gated by `supportsVision` (reuse the Image
Understanding capability — see [[project-multimodal-vision]]). Two cases: (a) when the AgentForge agent is
driving, the image rides into the agent turn (vision-gated; if the chat model can't see, show the same
"needs a vision model" affordance as the composer); (b) when a real external CLI is hosted in the terminal
(e.g. `claude`), forward the image to that process the way it accepts images — Claude Code supports image
paste natively. Case (a) is v1; forwarding to a hosted CLI (PTY image handling) is a stretch goal.

### External agent CLIs — detect-then-guide (don't hardcode-and-forget)

The terminal can host the real coding-agent CLIs so the user runs them *with their agents alongside*. UX is
**detect-then-guide**: probe `‹bin› --version`; if present → "✓ installed · Launch", else show an Install
panel with the official command + a docs link. Installs run through the **command-approval card (Developer
Mode), never silently**; show the exact command first; on macOS prefer Homebrew/native over `curl|bash` and
let the user choose. Make it **data-driven** — an `EXTERNAL_AGENTS` registry `{id, bin, detect, install:{mac:[…]},
docsUrl}` — so commands are easy to refresh (they drift). Verified commands (2026-06-15):

| CLI | bin | install (macOS) | launch | auth |
|---|---|---|---|---|
| Claude Code | `claude` | `brew install --cask claude-code` · native `curl -fsSL https://claude.ai/install.sh \| bash` · npm `npm i -g @anthropic-ai/claude-code` (Node 18+) | `claude` | run `claude` → browser login (Pro/Max/Team/Enterprise/Console) |
| OpenAI Codex | `codex` | `brew install --cask codex` · npm `npm i -g @openai/codex` | `codex` | sign in with ChatGPT, or API key |
| Gemini CLI | `gemini` | `brew install gemini-cli` · npm `npm i -g @google/gemini-cli` | `gemini` | Google OAuth, or `GEMINI_API_KEY` |

Prefer **detection + a docs link** over trusting these strings forever — refresh them at build time.

## Update 2026-06-15 (pt 6) — two coding paths + per-agent model

Two distinct, complementary ways to code in the Code surface:

- **Native — Codey.** Our agent (rail) drives files/editor/terminal via the capability loop (`file_op`/command),
  powered by the app's model. "Use our Codey to code."
- **Hosted — a real CLI** (Claude Code / codex / gemini / nanocoder) in the terminal: its OWN agentic loop +
  OWN model/auth. "Use the claude code." OpenAI-compatible ones (codex/nanocoder) can be pointed at the local
  endpoint (`127.0.0.1:<port>/v1`) to run on YOUR hosted model.

**Per-agent model — the FIELD EXISTS; only the editor UI is missing.** _(CORRECTION 2026-06-16: an earlier
draft here wrongly said the model is "global" — it is NOT.)_ The design is per-agent and already partly wired:
every agent carries **`defaultModelId`** (`useAgentStore.ts`), and selecting an agent applies it via
`AppSidebar.tsx:73` (`if (agent.defaultModelId) setSelectedModelId(agent.defaultModelId)`) — so each agent's
default model travels with them, exactly as intended. The global `selectedModelId` is just the *active* model,
*driven by* the agent's default on switch. **The gap:** there is no UI to SET `defaultModelId` (the
`AssistantSettingsModal` agent editor has no model picker bound to it), and nothing currently writes the field,
so it sits dormant at `''`. **Fix (small, OUTSIDE the collision zone):** add a default-model dropdown in
`AssistantSettingsModal` bound to `editingAssistant.defaultModelId` (the `models` list is already in scope) +
ensure it persists. **No send-path/App.tsx change** — AppSidebar already routes the agent default into
`selectedModelId` on switch. This is the NATIVE (Codey) path's model; hosted CLIs configure their own (or point
at the local endpoint).
