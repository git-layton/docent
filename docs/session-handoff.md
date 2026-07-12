# Agent Forge — Session Handoff (July 2026)

Context to resume work in a fresh session. Written after the v2.0.17→v2.0.31 arc.

## How we work (the rhythm)
- **Release per fix.** Every change ships: `npm run release -- patch` bumps the 5 manifests, commits
  `release: vX.Y.Z`, tags, pushes; the `v*` tag triggers `.github/workflows/release.yml` (macOS
  arm64, ~6–8 min), which publishes the DMG + updater artifacts + `latest.json`. The user tests via
  the in-app auto-updater. Watch a build: `gh run watch $(gh run list --workflow=release.yml -L1 --json databaseId --jq '.[0].databaseId') --exit-status`.
- **Verify before shipping:** `npx tsc --noEmit` + `npm test` (Vitest) + `cd src-tauri && cargo check`.
  ~920 tests today. Do NOT drive a dev instance — it shares the DB + local model server with the
  user's running app.
- **Build is ad-hoc signed** (`signingIdentity: "-"`). Self-signed CI signing was tried and FAILS on
  GitHub runners (trust-settings denied, `-60005`) — do not retry. See "Developer ID" below.

## Shipped this arc (v2.0.17 → v2.0.31)
- **Glow overlay:** shutter-flash AFTER capture (`screenshot.rs` `pulse_glow`, generation-checked
  failsafe hide); `GlowOverlay.tsx` paints only (opacity-animated, theme-invariant `--af-glow-*`).
- **Spotlight docks to monitor work_area** (`lib.rs` `dock_spotlight_right`) — Dock can't cover input.
- **Mac permissions hub:** `MacPermissionsCard.tsx` + `permissions.rs` (`automation_grant`,
  `open_privacy_settings`, `notify_user`). KEY BUG FIXED: browser tab-reading needs **Automation**,
  not Accessibility — macOS's "wants to control" dialog + the useless Accessibility toggle was the
  "permissions never work" complaint.
- **Spotlight memory parity:** `SpotlightBar.tsx` now feeds `memorySummary`/`relevantMemory`/
  `knownProcedures` to `generateTextResponse` (was amnesiac). Per-message "remembered …" transparency
  cards. Tier-1 digest reads parallelized (`memoryContext.ts`).
- **Topic-shift nudge:** `services/topicShift.ts` (`embed_text` command, rolling EMA centroid). DAMPED
  hard: one nudge per chat ever, threshold 0.28, tuned to miss rather than nag.
- **Self-healing engine:** `revive_local_model` (records launch args to `~/.agent-forge-llama-last.json`,
  health-checks + respawns). `fetchWithRetry` auto-revives once on a dead local port; App boot revives
  if the selected model is local. Killed the "Model server unreachable" loop.
- **Context UX:** ActivityMonitor no longer says "start a new chat" — says the window self-optimizes
  (oldest unpinned rotate out; pins+memory persist); breakdown now includes the Chat itself.
- **Routines** (`services/routines.ts` + `RoutinesCard.tsx`, scheduled in `App.tsx`): runs while app
  open + launch catch-up (`isDue`). READ-ONLY autonomy. Actions: `digest` (mail/calendar/notes +
  custom instruction; optional **save-to-memory** so briefings become referenceable), `mailFlag`
  (sender/subject watcher, seen-UID capped). Results → Inbox capture + native banner + Inbox-tab
  activity bubble (`useUIStore.inboxAlerts`, mirrors Messages unread).
- **Red-X fully quits:** main-window close tears down engine+PTY and `app.exit(0)` (`lib.rs`
  `on_window_event`, scoped to `label()=="main"`).
- **Gemma 4 12B** is the 16GB-tier `primary` pick (`modelCatalog.ts`) — native vision, verified vs
  bundled llama.cpp b9821.

## Open production items (priority order)
1. **Developer ID signing** — user JUST bought the Apple Developer account (2026-07-11). Blocked on 3
   artifacts only they can create (see below). The real fix for TCC grants surviving updates + killing
   the quarantine dance. Wiring is ~20 min once artifacts exist.
2. **Tab-switch perf (Notes worst):** `renderTabContent` unmounts inactive tabs (`App.tsx:~2832`) →
   Notes remounts + re-runs AppleScript. Fix: cache in a store / keep recent panels mounted. Highest
   daily-friction item fully in our control.
3. **Audio-to-model:** payload path is parallel to images (`input_audio` content-part beside
   `image_url` in `llm.ts` ~580). Buildable; needs a LIVE check that bundled llama-server + Gemma 4
   audio mmproj accept it. Do as a load-model-and-test pass. (NB: voice input today is browser STT →
   text, in `App.tsx:~1002`; audio-file→model is genuinely net-new, not a revert.)
4. **Chat-created routines:** "watch my mail for X" → propose a routine card via the gatekeeper.
5. **Outbound routines:** BLOCKED — mail is read-only IMAP; SMTP send must be built first, then
   approval-drafts on top.
6. **Frontmost-window capture scope:** capture just the active window, not the whole display (privacy;
   `screenshot.rs` uses `screencapture -x` full-display today). Pairs with the screen preview.
7. Backlog (`docs/feedback-backlog.md`): Canvas (deferred, orphaned `w-1/2` split), proactive setup
   nudge (needs-design), per-step browser overlay (partial), Code-composer image attach (todo).

## Developer ID checklist (item #1)
User must produce, from their new account:
1. A **"Developer ID Application"** certificate (developer.apple.com or Xcode → Settings → Accounts →
   Manage Certificates). Export as .p12.
2. An **app-specific password** (appleid.apple.com) for notarization.
3. Their **Team ID** (membership page).
Then (my side): base64 the .p12 → `APPLE_CERTIFICATE` secret, set `APPLE_CERTIFICATE_PASSWORD` /
`APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` secrets, set the identity in
`tauri.conf.json`, uncomment the APPLE_* env block in `release.yml`, re-tag. **Warning:** the identity
change voids all TCC grants ONE final time (user re-grants via the Mac permissions hub). Enrolled
entity name becomes the app's public publisher.

## Gotchas
- `npm install --legacy-peer-deps` (React 19 vs emoji-mart).
- Tauri invoke args are **camelCase** (see `lib/ipc.ts` — snake_case silently drops).
- New Rust commands: register in `invoke_handler!` AND they auto-join the window ACL via
  `build.rs` → `permissions/app_local.gen.toml`.
- BACK UP `~/.tauri/agentforge-updater.key` (updater signing) — losing it means no installed app
  accepts future updates.
