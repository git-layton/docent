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

## Update 2026-06-16 (pt 7) — agent presence in Code: the "Powered by [agent]" chip

> **⚠️ SUPERSEDED by pt 11 (2026-06-18).** The premise here — a *dedicated Code space* that *pins Codey
> as its permanent agent* — was wrong. Code is a **canvas opened in any normal space**, not a space, and
> the rail is that space's own group chat (Codey is only the canvas copilot). Kept for decision history.
> The per-agent `defaultModelId` model (pt 6) and the gear/model editor still hold.

Resolves the "the Code screen has nothing to talk to" confusion. Presence is split, not absent:
- **Rail = who you talk to** (always there; defaults to Codey).
- **Center = the work** (files / editor / terminal).
- A **"⚡ Powered by Codey ▾" chip** in the Code header NAMES the driver and, on click, opens that agent's
  **code-specific settings** — the per-agent **model** (`defaultModelId` picker), a **Developer Mode** toggle,
  and an **Edit agent →** link. (Mounted folders live in the panel's Linked-files view, not the popover.) So the
  model-edit entry point and the agent presence are the same affordance. _(BUILT 2026-06-16.)_

Reconciled agent model (no drift from earlier decisions): the coding **capability is universal** — any agent
*can* code ("all mini codeys"); **Codey is the tuned default** and what the chip shows; **one driver per space**
(the rail's active agent); **multiple efforts = multiple spaces** (a space ≈ a project), never multiple drivers
in one space. So "your agents code with you" (any of them) AND "a dedicated Codey" are both true at once.

**KEY refinement (2026-06-16): Codey is PERMANENT in a Code space.** The realization that unlocked it: the rail
is normally your **group chat** (you + the space's agents), so reusing it raw for Code would be ambiguous
("*which* of my group is coding?"). Resolution: **a Code space pins Codey as its permanent agent** — the rail
there is *you + Codey, fixed*, NOT a swappable group chat; normal/group spaces keep their group-chat rail.
"Permanent" ≠ rigid: Codey is always the Code agent (not swapped out), but his **settings ARE editable** (model
`defaultModelId` / Dev Mode / folders) via the "Powered by Codey" chip. Other agents stay code-capable under the
hood, but Code's face is permanently, legibly Codey — no "who's driving?" moment.

## Update 2026-06-16 (pt 8) — chat-first Code (supersedes the files-first panel)

> **⚠️ PARTLY SUPERSEDED by pt 11 (2026-06-18).** The **chat-first shape still holds** — the code surface
> is a conversation with Codey + Files/Terminal/Preview toggle panels + a first-run hero. What changed: it
> is NOT a dedicated `space-code` space, Codey is NOT pinned as a space's primary, and the center is NOT the
> global `activeChatId`. Codey's conversation is a **standalone `CODEY_CHAT_ID` thread** rendered as the
> canvas center (its own composer buffer); the surface opens in the **current** space. Read pt 11 for the
> corrected wiring; the UI description (toggles, hero, gear) below is still accurate.

The Code surface is now a **conversation with Codey**, not a files-first panel. This SUPERSEDES the
Workspace / Linked / Activity / Terminal segmented tabs, the **"⚡ Powered by Codey" chip** (pt 7), and the
"open the desktop app" dead empty state. Codey *drives* the code; files/terminal/preview are tools he and
you reach into, not the home screen. _(BUILT 2026-06-16.)_

**The shape**
- **Default view = Codey's conversation.** The Code panel renders the app's existing chat machinery (the
  global `ChatPanel` — message list + the inline `file_op` diff cards + command-result cards + the input
  bar) pointed at the Code space's per-project thread. No parallel chat was built; coding actions render as
  the same inline cards every other agent uses.
- **Header** = project name + a single **gear popover** (Codey's `defaultModelId` model picker + Developer
  Mode toggle + "Codey's tools & prompt →" full-editor link) + three **toggle buttons: Files · Terminal ·
  Preview**. No segmented tabs.
- **Files / Terminal / Preview are toggle panels**, opened on demand beside the conversation (never the
  default):
  - **Files** = the original browse/import/preview engine (file tree + provenance actions + "bring in a
    file"), now a side panel.
  - **Terminal** = the existing `TerminalPane` (PTY), Developer-Mode gated, cwd = the space's workspace home.
  - **Preview** = a sandboxed `<iframe>` to a manual localhost URL (default `http://localhost:3000`). v1 is
    set-URL-and-Go; auto-detect is deferred. (Native webview reuse via `BrowserTabContent` is deferred — its
    singleton `browser-panel` label would collide with the main browser tab.)
- **Empty / first-run** = Codey's chat with a friendly hero: "Open a folder, or tell me what to build" plus
  one-click prompt chips — never an empty file tree.

**Codey is code-only.** He's hidden from the People roster (`AppSidebar` filters out `forge-dev`) — the
roster shows the user's REAL agents (Alexis etc.). Codey still exists as an agent object (model/tools/prompt)
and remains in `assistants` so `openCodeSpace`/`resolveCodeyId`/the advisor flow keep working; he only
appears as the Code driver. His toolkit was widened to a full code copilot: `web_search` + `local_workspace`
(research the web + knowledge while coding); `file_op`/workshop are universal and terminal commands are
Developer-Mode gated, so no extra flags are needed there.

**@-mention advisors.** The user can @-mention any of their real agents INTO Codey's conversation to get
advice — **they advise; only Codey edits.** The Code composer's @-picker offers the whole roster (resolved
against all agents, not just stored participants). Routing is special-cased for the Code chat
(`CODE_CHAT_ID`): responders are the mentioned advisors **plus Codey, with Codey last** so he synthesizes
their input and owns the edits — a mentioned advisor never silences Codey via the generic sticky-scope rule.

**Implementation (Strategy A).** The Code space (`space-code`) already pins Codey as primary and seeds a
Codey channel (`chat-space-code`) + the `agentforge-code` tool tab. `setActiveSpaceId` already drives the
global `activeChatId`/`activeFolderId` to Codey, so the inline `ChatPanel` is already his; the panel adds a
defensive effect to re-pin them if they drift. The co-pilot rail is excluded for the `agentforge-code` tab so
the conversation doesn't double-render beside itself.

**Deferred (stubbed, not half-built):** multi-chat-per-project + a project switcher (v1 = one Codey
conversation per Code space); Preview localhost auto-detect + reusing the native browser webview; vision-based
preview-observation; full Strategy-B decoupling of the send pipeline from the single global
`activeChatId`/`activeFolderId`. AGENTS.md + per-project memory already exist via `loadProjectContext` — they
are surfaced into Codey's prompt, not rebuilt here.

## Update 2026-06-17 (pt 9) — the Team side rail: a private group chat with your real agents

> **⚠️ SUPERSEDED / REMOVED by pt 11 (2026-06-18).** The bespoke "Team" rail and its dedicated
> `TEAM_CHAT_ID` thread were **deleted**. The instinct was right — you want your real agents in a group
> chat beside the code — but it was built wrong: every space *already has* an agent group chat, surfaced
> consistently as the docked co-pilot rail. Code now reuses **that** rail (no `TEAM_CHAT_ID`, no
> `teamChatId` on Space). The two-conversation plumbing described below was kept but **inverted** — see pt
> 11. This whole section describes a removed mechanism; kept only for decision history.

The Code surface now carries a **second conversation** alongside Codey's: a collapsible **right rail that is a
PRIVATE GROUP CHAT with the user's REAL agents** (Alexis & co. — the roster agents, **not** Codey). It's a
**separate thread** from Codey's center conversation, so you can talk things over with your team **without
involving or confusing Codey**. The center stays exactly as pt 8 describes (Codey solo, drives the code,
inline `file_op`/command cards); the rail is the standing "talk to my team" space. _(BUILT 2026-06-17.)_

**Center vs rail (two concurrent conversations on one screen)**
- **Center = Codey, unchanged.** Still the global `ChatPanel` pinned to `CODE_CHAT_ID` + Codey. @-mentioning
  a real agent INTO the center to bring them onto the code work is **unchanged** (pt 8 routing).
- **Right rail = the Team group chat.** A second `ChatPanel` (reused, not re-built) pointed at a dedicated
  per-project Team thread. Collapsible — a thin `Users` strip when closed; the heavy `ChatPanel` only mounts
  when expanded. Collapse state persists (`db` key `codeTeamRailOpen`), mirroring the co-pilot `copilotOpen`
  idiom.

**Why a dedicated per-project Team thread (not the Home chat).** The rail agents must be context-aware of
**this** Code project, and ambient context (open tabs) + `AGENTS.md` are space-scoped — a per-project thread
inherits that for free, keeps each project's team discussion isolated, and matches the existing
"space ≈ project, deterministic per-space chat ids" model. Reusing the Home chat would pull agents into an
unrelated conversation and leak Code context into Home.

**Data model.** `openCodeSpace` seeds a second channel thread `TEAM_CHAT_ID` (`team-chat-space-code`) named
"Team", whose `participantAgentIds` are the **real roster** (every agent minus Codey/`forge-guide`/`f-default`
— the same filter `AppSidebar` uses). The id is stored on the Space as a new optional `teamChatId`. Existing
installs that already created `space-code` are **backfilled on open** (idempotent — no `STORE_VERSION` bump).
Because the thread has a **different id from `CODE_CHAT_ID`**, `processChatRequest` takes the generic channel
path (`isCodeChat` is false) and routes responders from the chat RECORD's participants — a real multi-agent
team chat with **no Codey involvement**.

**Context-awareness comes for free.** A rail send runs while the Code space is active, so
`processChatRequest` reads the active space's ambient context (open tabs/selected file), tool context, and
`AGENTS.md` fresh at send time and threads them into each responder — the rail agents already see the Code
surface, with no new wiring.

**The minimal decoupling (a scoped slice of Strategy-B).** Two concurrent conversations on one screen needed
exactly two changes, no more:
1. **Send target.** A `handleSendTeamMessage(targetChatId, text, attachments)` sends straight to a specific
   chatId via `processChatRequest` and **never touches** the global `activeChatId`/`activeFolderId`, so the
   center stays pinned to Codey. (`processChatRequest` already took `chatId` as a param and keys channel
   routing off it — no change needed there.)
2. **Composer buffer.** `ChatInputBar` gained optional `inputValue`/`onInputChange` +
   `attachedDocsOverride`/`onAttachedDocsChange` props. The rail passes its **own** `useState` buffer instead
   of the global `useUIStore.input`/`attachedDocs`, so the center (Codey) and rail (Team) composers never
   share or corrupt each other's text. When the props are omitted (everywhere else), the bar reads/writes the
   global UI store exactly as before. `ChatPanel` also gained a `hideHeader` flag so the rail suppresses the
   global-active-coupled `ChatHeader` (which would otherwise show Codey) in favor of its own slim "Team"
   header. **Read needs no decoupling** — `ChatPanel`/`MessageList` are prop-driven; the rail just gets a
   second prop bag whose `activeMessages = messages[TEAM_CHAT_ID]`.

**Still deferred (knowingly):** pin-/gatekeeper-memory scoping in `processChatRequest` is still keyed to the
global `_activeFolderId` (Codey), so during a rail send team agents use Codey's pin scope and channel memory
is attributed under Codey's gatekeeper — **cosmetic for v1**; a clean fix threads the responder agent through
pin/memory scoping (the rest of full Strategy-B). The Team thread's participants are seeded once at
create/backfill time — agents added to the roster later don't auto-join the existing Team thread (v1).

## Update 2026-06-17 (pt 10) — Codey-can-see (preview-observation) + rail teamChatId backfill

> **⚠️ TWO CORRECTIONS (2026-06-18).** (1) **LOOK is now LIVE on macOS**, not stubbed — the Rust
> `webview_screenshot` command shipped (`screenshot.rs`, registered in `generate_handler!`, on the
> remote-isolation DENIED list), `capturePreviewScreenshot()` invokes it, and the catalog now carries
> vision models (Gemma 3 4B/12B/27B), so the gated LOOK→`describeImage` path runs end to end (falling back
> to READ off-macOS / when no vision route). (2) The **"rail teamChatId backfill" subsection below is
> obsolete** — the Team rail it propped up was removed (pt 11), so `ensureCodeTeamThread`/`teamChatId` are
> gone. **The READ verify-loop (preview-observe capability + the eye button) is unchanged and current.**

Two things land here: the **verify loop** (Codey can finally *see* the running app at the Preview URL and
self-correct), and a small **rail reliability fix** so the Team rail (pt 9) appears even when you reopen
straight into a pre-existing Code tab. This realizes the preview-observation idea sketched in pt 4 — shipping
the model-agnostic READ now, stubbing the vision LOOK behind a clear flag.

### Codey-can-see — the verify loop

**READ (shipped, model-agnostic, highest signal).** A new `preview-observe` capability
(`services/capabilities/builtins/previewObserve.ts`, registered in `capabilities/index.ts`) lets Codey read
the running app:
- It reads the **shared** Preview URL — lifted into `useUIStore.codePreviewUrl`, written by the Preview
  panel's **Go** button (`goPreview`) — so Codey reads **the exact URL the human framed**, never a guessed
  `localhost:3000`.
- It runs `curl -sS -i -L --max-time 12 <url>` through the already-shipped, Developer-Mode-gated **`run_command`**
  (cwd = the active space's workspace home), then pipes the served HTML through the existing Rust
  **`extract_page_text`** extractor for clean readable text. **Zero new Rust.**
- Codey sees: the **HTTP status line + response headers**, the **server-rendered markup/JSON**, and — because
  `run_command` captures stderr — any **connection error** (e.g. dev server not running). The result folds into
  his context as a `[SYSTEM NOTE: PREVIEW OBSERVATION]` `toolData` block, **identically to browse/files**
  (`App.tsx` capability fold), and the status chip finalizes to `👁 Observed preview`.

**Honest limitation:** curl gets the **server response only** — no client-rendered DOM, no browser console.
For an SPA dev server (Vite/CRA) the served HTML is often a near-empty `<div id="root">` shell, so Codey sees
**build/runtime errors + route reachability + SSR markup + HTTP status** (the highest-signal fix inputs) but
**not the live rendered UI**. The richer client-rendered DOM read is the **deferred** native-webview path:
the browser uses a SINGLETON `browser-panel` webview label (`pageCapture.ts`/`browserAgent.ts`/lib.rs ACL
tests), so reusing it for Preview collides with the user's real browser tab, and a second tracked webview is
heavy (parallel `browser_agent_report` plumbing + absolute-coord bounds sync that would fight the Preview
iframe). And cross-origin `postMessage` out of the iframe does **not** work — the Preview iframe frames a
cross-origin localhost server, so `allow-same-origin` grants the framed page only its own origin.

**LOOK (vision, STUBBED with a flag).** `lookAtPreview()` in the same file wires the **vision SINK** end to
end — it gates on `resolveVisionRoute(...)`/`modelSupportsVision(model)` (REUSING the `llm.ts` seam,
unchanged) and, given image bytes, calls `describeImage(dataUrl, 'image/png', route)` and folds the
description into the same observation note. The **only** missing piece is the screenshot **SOURCE**:
`capturePreviewScreenshot()` returns `null` for now, so LOOK automatically **falls back to the READ**. Making
LOOK live needs (a) a new Rust `webview_screenshot` command — macOS WKWebView capture is non-trivial, and it
MUST go in `generate_handler!` (auto-grants `allow-app-local`) and stay **off** `allow-browser-remote` in
`app.toml`, same isolation rule as `run_command` — and (b) a vision model in the catalog (currently none; see
[[project-multimodal-vision]]).

**Surface — capability + affordance.** Routing adds a `'preview'` `ToolRoute` (`memoryGatekeeper.ts`: the type,
the `TOOL_ROUTES` validation tuple, and a `forced === 'preview'` case in `routeToolCandidates`). The visible
affordance is a small **eye button** in the Preview panel header (shown once a URL is live): it pins
`codePreviewUrl`, sets `forcedTool='preview'`, and sends *"Look at the running preview and fix anything
broken."* through Codey's normal composer — so the capability runs and the observation folds in.

**Honest caveats.** The READ only produces signal when a **dev server is actually running** at the URL
(otherwise curl reports connection-refused, surfaced as a useful note, not a silent empty read). It is
**Developer-Mode-gated** (it's a shell command); when Dev Mode is off the capability says so and toasts the
user to enable it, rather than failing opaquely. LOOK additionally needs the deferred screenshot command **and**
a vision model. The existing Preview iframe is **untouched** — observation reads out-of-band via curl; the eye
button is additive header chrome.

### Rail reliability backfill — `teamChatId`

**Bug:** `Space.teamChatId` was only seeded in `openCodeSpace`. `hydrate` restores persisted spaces verbatim
and never sets it, so a user who reopens the app **directly into a pre-existing Code tab** (hydrate restores
the active tab) never calls `openCodeSpace`, leaving `teamChatId` undefined → the entire Team rail block
(`{teamChatId && …}`) renders nothing.

**Fix:** a new `ensureCodeTeamThread(spaceId)` store action reuses the exact same `realRosterAgentIds` +
`ensureChatThread` + `TEAM_CHAT_ID` logic as `openCodeSpace`: if the space lacks the pointer it seeds the Team
thread and sets `teamChatId`, then persists. The Code panel calls it from a `useEffect` keyed on
`[activeSpaceId, activeSpace?.teamChatId]`, gated on `teamChatId !== TEAM_CHAT_ID`. **Loop guard is inherent:**
the action is a no-op once the pointer is set (it returns early, mutating nothing), so after one backfill the
effect's condition is false and it never re-fires. Keeping the seeding in a store action (not inline in the
panel) avoids exporting the module-private roster/thread helpers and keeps the logic in one place.

## Update 2026-06-18 (pt 11) — Code is a CANVAS, not a space (supersedes pt 7–9; corrects pt 10)

The model in pt 7–9 was a **fundamental inversion** of the intended design, caught in review. The
correction, stated plainly:

- **Spaces are UNIFORM.** There is **no dedicated "Code" space** and no "Coding partner" space session.
  Every space is the same shape: the agents you added + their group chat + whatever tabs/canvases are open.
- **The group chat is the constant.** A space's docked co-pilot rail and its full-page **Chat** tab are the
  **same conversation** (the space's agents) — docked vs. full-page. That rail shows up **consistently in
  every space**. (This already worked for normal spaces — both render `activeChatId`. The old Code *space*
  was the only thing that broke it.)
- **Codey is ONLY the code-canvas copilot** — not a space, not a chat driver, not pinned anywhere. You open
  a code canvas inside whatever space you're in and chat with Codey *there*; the space's own group-chat rail
  sits beside it exactly like everywhere else.
- **Launch lands on Home** (the StartPage overview), not a conversation.

So the mistake was making "Code" a *special space* (pt 7's permanent-Codey pin) with a *bespoke Team thread*
(pt 9) — when Code is a **canvas** living inside ordinary spaces, and the rail is just the space's normal
group chat. The chat-first UI shape from pt 8 (Codey center + Files/Terminal/Preview toggles + the hero) is
unchanged; only its *homing* was wrong.

### The key insight — the two-conversation plumbing INVERTED cleanly

pt 9 built two concurrent conversations on one screen: **center = Codey (global `activeChatId`, pinned)** +
**a separate "Team" bag** for the rail. The correct shape is the **inverse**, and it reuses the exact same
plumbing:

- **Center = Codey** on a **separate bag** pointed at a standalone `CODEY_CHAT_ID` thread (its own composer
  buffer) — this is the old "Team bag" repurposed.
- **Rail = the space's group chat** = the **normal co-pilot rail** (global `activeChatId` + the global
  composer), now simply **un-suppressed** for the code canvas.

No rewrite — a rename + a repoint + deleting the in-panel rail (the rail moved *out* of the panel to App.tsx's
standard co-pilot rail).

### What changed (implementation)

- **Removed:** `CODE_SPACE_ID`, `openCodeSpace`, `TEAM_CHAT_ID`, `ensureCodeTeamThread`, `Space.teamChatId`,
  `realRosterAgentIds` (all in `useSpaceStore`); the panel's Codey-pin `useEffect`; the in-panel `DockedAgentRail`
  Team rail; the `&& toolId !== 'agentforge-code'` co-pilot-rail suppression in `App.tsx`.
- **Renamed/repointed:** `CODE_CHAT_ID` → **`CODEY_CHAT_ID`** (`'chat-codey'`) — a standalone DM with Codey,
  the canvas center. `handleSendTeamMessage` → **`handleSendCodeyMessage`** (same impl; sends to a specific
  chatId via `processChatRequest`, never touching the global active chat). The App `team*` prop bags →
  `codey*` bags pointed at `CODEY_CHAT_ID` + Codey. `AgentForgeCodePanel`'s `railInput`/`railDocs` →
  `codeyInput`/`codeyDocs` (the **center** composer's own buffer); the center `ChatPanel` uses `hideHeader`
  (the panel has its own header, and the global-coupled `ChatHeader` would otherwise mislabel the center).
- **Added:** **`openCodeCanvas()`** — opens/focuses the `agentforge-code` tool tab in the **current** space
  (`activeSpaceId`), ensures the Codey DM thread exists; it does **not** create or switch spaces. The Home
  "Code" tile calls it.
- **`STORE_VERSION` 4 → 5** — one-time reseed so any stale persisted `space-code` (+ its Team thread) is
  dropped and spaces are uniform again.
- **Launch on Home:** `hydrate` now makes the **`home` tab** active on launch (ensuring one exists), instead
  of landing on the active space's chat.

### What was KEPT (deliberately)

- **Codey-drives-his-own-chat routing.** `processChatRequest`'s `isCodeChat` branch (now keyed on
  `CODEY_CHAT_ID`) still forces Codey to respond + supports @-mentioned advisors (advisors advise, Codey
  edits). This was **never** the problem the owner flagged — Codey driving *his own DM* is correct; the
  *space* was the mistake. So it stayed, just renamed.
- **Per-chat concurrent generation, `DockedAgentRail` (the shared rail chrome), the PTY terminal, file ops +
  consent + the remote-isolation ACL, the LOOK screenshot (now live, pt 10 correction), `AGENTS.md` /
  `loadProjectContext`, the workspace jail** — all untouched. Codey stays a built-in agent hidden from the
  People roster (he's the canvas copilot, not a general agent).

### Verified

`tsc` clean, **878 vitest** (the old `openCodeSpace`/`ensureCodeTeamThread` suites replaced by an
`openCodeCanvas` suite), no console errors. Preview-confirmed: the app launches on Home; opening Code shows
the canvas **inside the current (Home) space** — Codey's "Build with Codey" center + Files/Terminal/Preview,
with the space's agent (Alexis) as the group-chat rail beside it; **no "Code" space** appears in the sidebar.

### Still deferred (knowingly)

Fully **merging the code canvas with the single-artifact `code-canvas`/Canvas surface** (the
"Code Canvas vs AgentForge Code" duplication from pt 3) — Codey's cockpit remains its own `agentforge-code`
tool tab for now. Per-project Codey threads (today one shared `CODEY_CHAT_ID`). The pin/gatekeeper-memory
scoping note from pt 9 is now moot (no Team thread). Multi-chat-per-project + a switcher.
