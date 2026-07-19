# Docent — Roadmap Handoff

**Read this first if you are picking up development.** It is self-contained: current state,
locked decisions (do not relitigate — rationale is linked), the remaining roadmap with
architecture sketches at file level, and the ops runbook. Written 2026-07-19 at v2.7.0.

The full product/UX review that produced this roadmap lives in a claude.ai artifact:
https://claude.ai/code/artifact/4ac4267d-38dc-4714-a6c8-8e94605a4921 — per-app critiques,
north stars, and the four-wave sequencing. This doc is the engineering companion.

---

## 1. What Docent is (thesis)

A local-first Mac AI guide that **proves what it says**. The differentiator is not features —
it's that everything the assistant does is *visible, reversible, and grounded in data the user
can inspect*. Receipts, provenance, draft approvals, and undo are the brand, not add-ons.
Every design decision below flows from that.

**The House Stance** (engineering worldview, also in the artifact): the model is a stateless
component, not a brain. (i) State lives in the app. (ii) Data-shaped outputs get schemas +
validation; prose-shaped outputs get human review gates. (iii) `_rationale` first key in
schemas, single pass, grammar-enforced. (iv) Personal/actionable claims must be grounded with
provenance or answered "I don't know." (v) Every AI feature ships with a deterministic
fallback. (vi) Agency lives in the harness: the model proposes, the app validates/executes/
records.

## 2. Repos, branches, releases (ops runbook)

- **Development**: `git-layton/docent` (public). CI runs here only (`ci.yml` is guarded with
  `if: github.repository == 'git-layton/docent'`).
- **Old repo**: `git-layton/agent-forge` — frozen migration feed AND the current release
  builder. It holds ALL secrets: `TAURI_SIGNING_PRIVATE_KEY` (updater), `RELEASES_REPO_TOKEN`
  (PAT), and the full `APPLE_*` set (Developer ID + notarization, active since v2.5.x).
- **Release feed**: `git-layton/docent-releases` — both repos' release.yml publish here;
  every installed copy ≥v2.6.0 polls it (older installs poll `agent-forge-releases`, where
  v2.6.0 remains as the migration bridge).
- **Cutting a release today**: bump version in `package.json` + `src-tauri/tauri.conf.json` +
  `src-tauri/Cargo.toml` + `Cargo.lock` (all identical), commit `release: vX.Y.Z`, tag, and
  **push the tag to `origin` (agent-forge)** — it builds, signs, notarizes, publishes to
  docent-releases. Push branches to BOTH remotes; push tags only to origin (a tag on docent
  triggers a release run that fails for lack of secrets).
- **To move releases fully to docent** (do eventually): set `TAURI_SIGNING_PRIVATE_KEY`
  (`< ~/.tauri/agentforge-updater.key` — BACK THIS FILE UP) and `RELEASES_REPO_TOKEN` on
  docent, copy the `APPLE_*` secrets, then tags go to docent and agent-forge freezes fully.
- Gate before any tag: `npm run release:check` (typecheck + lint + full vitest + build) must
  pass END TO END. It is the honest gate; do not tag around it.
- **Never-wipe policy**: post-release schema migrations must never wipe user data. See the
  `[DATA-WIPE LANDMINE]` comment in `useSpaceStore.hydrate` — if `STORE_VERSION` changes
  post-release you MUST write a non-destructive migration runner, not fall through to reseed.

## 3. Shipped and load-bearing (with file refs)

| Piece | Where | Notes |
|---|---|---|
| Receipts platform | `src/services/receipts.ts` | Persisted capped ledger; undo handlers are session-scoped closures so reversibility is never claimed falsely. `record(input, undo?)`. |
| Agent-action receipts | `src/services/agentActions.ts` (`executeAgentAction`) | Single funnel; creates/completes carry genuine undo (connector ids captured). |
| Browser errand receipts | `src/services/browserAgent.ts` | One receipt per errand; transcript = action ledger. |
| Answer receipts | `App.tsx` foundSources assembly + `src/components/SourcesTray.tsx` | "Grounded in Local Mail — Inbox" chips when `_toolContext` fed the answer; tap opens the tool tab. |
| Draft approvals | `src/lib/textDiff.ts`, `useUIStore` (`canvasProposal`/`accept`/`reject`), `CanvasPanel` (`ProposalReview`), App.tsx streaming seams | Edits to an existing canvas stage as tracked-changes diffs; accept = history push + undoable receipt; Space-scoped. Fresh canvases skip review. |
| Memory ledger | `src-tauri/src/lib.rs` (`memory_git_log`), `src/services/memoryLedger.ts`, Memmo "Ledger" tab | Read-only humanized git history of the Knowledge Core. |
| State-alive panels | `src/lib/panelCache.ts` (`usePanelResource`) | SWR pattern: instant hydrate on remount, silent revalidate, cache-coherent `mutate`. Converted: Messages, Mail, Calendar, Planner, Notes (bespoke). |
| Per-Space canvas | `useUIStore.swapCanvasForSpace` ← called by `useSpaceStore.setActiveSpaceId` | Canvas + pending proposal follow their Space. |
| Permanent Start tab | `useSpaceStore.ensureHomeTab` | Pinned, unclosable landing zone; `+` focuses it; app launches open beside it. |
| Settings as app | `ToolTabId 'settings'`, routing effect in App.tsx | Legacy `setShowProfileSettings(true)` calls route to the tab. |
| Docent identity | `useAgentStore` (id stays `'alexis'` — memory namespaces key on it; NEVER change) | Name migration respects user renames. |
| Solid surfaces | `src/index.css` | Glass mode fully retired (blur AND translucent vars). Do not reintroduce backdrop-filter on app/tab surfaces. |
| Weather badge | `OmniTabBar` (`WeatherEffectBadge`) | Fog/rain/snow/storm tinting the background is labeled, never mysterious. |

## 4. Remaining roadmap, in order

Each item: why → design (locked) → sketch → verification. Sizes are working-session scale.

### Wave Depth (next)

**D1. Mail queues + Sweep** (2–3 sessions) — the receipts platform's showcase.
- *Design*: inbox opens as queues (Needs reply / Newsletters / Receipts / Everything else),
  not a timeline. Classification is data-shaped → schema-enforced single pass with
  `_rationale` first (House Stance iii), cached per-uid in the panel cache, keyword fallback
  when no model (Stance v). **Sweep** = one key runs triage on everything unread: archive
  noise, queue replies with drafts attached (drafts HELD, never sent — Stance ii), flag the
  few that matter — then ONE batch receipt with working undo (unarchive all, discard drafts).
- *Sketch*: `src/services/mailTriage.ts` (pure classify + batch plan, unit-tested);
  `MailInboxPanel` gains queue tabs above the list (reuse `usePanelResource`, key by
  account+queue); Sweep's undo = recorded list of (uid, priorAction) replayed via existing
  IMAP commands (`mail_set_seen`/`mail_set_flagged` exist; archive needs a `mail_archive`
  Tauri command — check IMAP move support in `src-tauri/src/mail.rs`).
- *Verify*: pure-logic tests + live IMAP smoke in the running app.

**D2. Messages catch-me-up + gentle backlog** (1–2 sessions).
- *Design*: thread opens with "since you last read" summary (prose-shaped → shown as a
  distinct card, never as fake messages); weekly private digest of unanswered threads with
  drafts ready ("3 people are waiting on you"). Uses existing per-relationship voice
  (`voiceRuntime.draftReply`); the digest is a routine (`services/routines.ts` pattern) filed
  to the Inbox with a landing receipt.
- *Sketch*: summary = `imessage_fetch_messages` since last-read + one summarize call, cached
  per chat in panel cache; backlog = pure detector over chats (`lastFromMe === false`,
  age > N days) — unit-testable without the model.

**D3. The Day merge** (2–3 sessions) — Planner + Calendar become one app.
- *Design LOCKED (do not relitigate)*: hard calendar events stay rigid; tasks live in a
  FLUID QUEUE beside them. NO auto-scheduling — the drag is the consent gesture. Docent does
  capacity math ("2.5 open hours — these three fit") and suggests; unfinished tasks roll back
  without ceremony. Rationale: planning-fallacy research + the Motion-vs-Sunsama market
  outcome (auto-tetris polarizes and churns; guided ritual retains).
- *Sketch*: new `DayPanel` composing the existing pieces; extract shared date/recurrence
  logic from `PlannerPanel`/`CalendarPanel` into `src/lib/dates.ts` FIRST (both currently
  duplicate `toLocalISODate`, holidays, recurring-event math) — that refactor is the real
  work; the view is assembly. Keep both old tabs until Day is verified, then retire them
  (tool ids stay valid → route to Day).

**D4. Capture triage** (1–2 sessions) — Forge Inbox + Memmo drop zone unify.
- *Design*: one tray; single-key triage (memory / task / note / dismiss); "dismissed" becomes
  a real capture status (currently absent — deliberately not invented earlier); auto-routing
  rules produce landing receipts with undo (un-file).
- *Sketch*: extend `CaptureStatus` in `src/services/inbox.ts` + `update_inbox_capture`
  already patches status server-side; triage keys in `InboxPanel`; the Memmo drop zone
  forwards into `create_inbox_capture` instead of writing directly.

**D5. Entity pages** (2 sessions) — the Knowledge Graph becomes navigation.
- *Design*: people/project dossier pages first (see `docs/people-directory-design.md` —
  people are LEARNED from reference, never imported); the force graph demotes to a 2-hop
  neighborhood widget on each page. Graph tab routes to the entity index.
- *Sketch*: `graphEntityExtractor.ts` already produces entities; add an entity index view +
  per-entity page (facts, sources with provenance chips — reuse `SourcesTray` receipts),
  backed by semantic search over `memory/`.

### Wave Delight (after Depth — each is a <30s demo)

- **Morning walkthrough**: one keystroke tours Spaces with 3-line briefs (what moved /
  blocked / proposed). Builds on Space briefing data; the brief is a routine digest per Space.
- **Point-and-ask**: hold hotkey, drag a rectangle → pixels (figure) + macOS AX tree under
  the rect (ground) + OCR floor. Three-source fusion, context chip shows exactly what was
  captured. Extends `SpotlightBar`; AX plumbing partially exists in `DesktopViewerPanel`.
- **Dyno run**: 20s post-install benchmark (tokens/sec, RAM headroom, vision smoke) posted
  on the model card. Extends `ModelStorePanel` + `llama-server` runner.
- **Living notes**: a note subscribes to a query; Docent appends dated, sourced marginalia
  (`MarginaliaLayer` exists) — never touches the user's body text.
- **Contact sheets**: per-Space chronological image strip in `GalleryPanel`.

### Structural (fold into waves opportunistically)

- **Code diff cards + checkpoints**: the canvas `ProposalReview` pattern applied to
  `AgentForgeCodePanel` file edits — every Codey edit becomes an accept/reject diff card with
  a session checkpoint (git commit) behind it. High value; do alongside Depth.
- **Browser step overlay**: on-page cursor + intent label during errands (transcript already
  exists; this is the visible version). Needs the running app to build against.
- **Per-tab webviews (Track 4)**: unlocks background errands. Deferred for ACL/runtime risk —
  do NOT attempt without runtime verification time.
- **Unified gate/empty/loading system**: generalize `ConnectorAccessGate` into one designed
  state system (every panel currently improvises).
- **Agent-native ladder**: label every app Read/Act/Watch and close gaps deliberately.
- **Remaining panel-cache conversions**: Inbox, ModelStore, KnowledgeGraph on
  `usePanelResource`.

### Business layer (parallel track, nothing built)

- **Licensing**: $24.99 lifetime, 7-day trial (landing page copy exists). Local-first
  constraint → offline-verifiable license: ed25519-signed license key (same discipline as the
  updater key), stored in Keychain; trial = first-run timestamp in Keychain (survives
  reinstall enough; don't over-engineer). Gumroad/Lemon Squeezy/Paddle handle payment + key
  issuance (Paddle handles EU VAT; research current fees at build time). NO phone-home
  requirement beyond optional activation ping — privacy is the brand.
- **Landing page**: HTML draft exists (compass/liquid-glass, "doesn't lie to you") — deploy
  to GitHub Pages or Cloudflare Pages under a purchased domain; wire the download button to
  docent-releases latest DMG.

## 5. Working agreements

- Release-per-fix rhythm; every release passes `release:check` end to end first.
- Receipts never lie: no undo claim unless the handler genuinely reverses the action.
- Prose from the model is reviewed, never auto-applied (drafts held, proposals staged).
- Runtime verification in the real app is owed for anything the tests can't drive — say so
  explicitly in handoffs rather than claiming it.
- The owner dogfoods on macOS; parallel sessions are common — check `git status` before
  assuming tree state, and never commit `src/services/llm.ts`-style in-flight files that
  aren't yours.
