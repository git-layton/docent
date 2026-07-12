# Agent Forge — UX feedback backlog (from v2.0.11 dogfood)

Source: live-use feedback, June 2026. Each item has the root cause (with file refs) and the plan.
Status legend: `todo` · `in-progress` · `done` · `deferred` · `needs-design`

## Decisions taken
- **Canvas:** retire the standalone code-canvas as a runnable surface (Code surface supersedes it);
  keep the **doc** canvas, but fix the underlying bug. Deeper look found the real issue: `CanvasPanel`
  is built as a half-width split beside chat (`CanvasPanel.tsx:58` `w-1/2`) that no longer renders
  anywhere — it only mounts as a full `code-canvas`/`doc` tab (`App.tsx:2918`), and `canvasContent` is a
  single global singleton. **Deferred** to an app-verified session (core layout change).
- **Messages read-status:** user asked for **two-way**. Flagged unsafe (writing to Apple's live,
  read-only-opened `chat.db`; no AppleScript mark-as-read API). **Shipped one-way**; two-way remains a
  separate, explicitly-experimental spike.
- **Wizard:** brand splash + Setup hub + don't-remind. Hub already exists in Settings → Connect your
  apps; shipped the splash + discoverability; proactive nag + don't-remind is the remaining net-new bit.

## Shipped in this pass
- Chat composer stays editable while streaming (fixes "can't type while sending" + arrow-key junk).
- Stop is instant (optimistic flag clear + finalize bubble).
- Terminal copy/paste (Cmd/Ctrl+C copies selection, else SIGINT; Cmd/Ctrl+V pastes).
- Browser search query cleaned of framing; focus returns to chat after a browse.
- Notes: consistent "paper" reading/editing surface (no white-flash on save).
- Docked agent answers from on-screen content instead of saying "open in canvas".
- Messages: one-way read-status (unread dots/bold from `is_read`); concise-reply nudge; FDA one-click
  Restart; clearer voice-learning messaging.
- Wizard: real app icon splash + pointer to Settings → Connect your apps.

## Wizard / first-run
- [x] `done` Brand splash — real icon (`public/app-icon.png`) replaces `Zap` in `StepWelcome`.
- [x] `done` Discoverability — welcome points to Settings → Connect your apps (the hub already exists in
  `ProfileSettingsModal` `connect` tab with status badges).
- [x] `done` (v2.0.35) Proactive setup nudge — `services/setupNudge.ts` (pure picker, 7 tests) +
  `SetupNudgeBar` on the home page. Shows the single highest-value unconfigured capability
  (mail → screen), only post-onboarding, with "Not now" (session) and a permanent don't-remind
  (persisted `setupNudgeDismissed`). Research-backed: one nudge, endowed-progress framing, autonomy.

## General Chat
- [x] `done` Type while sending + arrow-key junk — `ChatInputBar.tsx` no longer disables the textarea
  while generating; Enter only sends when idle.
- [x] `done` Stop responsiveness — `App.tsx` `handleStop` clears the flag + finalizes the bubble
  immediately.
- [x] `done` (v2.0.32) Tabs slow, Notes worst — `NotesPanel.tsx` now has a module-scoped cache
  (folders/notes/bodies, keyed by backend) that survives the remount, hydrates instantly, and
  refreshes in the background. Other panels still remount but Notes was the AppleScript-bound worst
  case; revisit only if another panel proves slow.

## Notes
- [x] `done` White-flash on save — `NotesPanel.tsx` renders a consistent light "paper" surface for both
  read + edit.
- [x] `done` "Open in canvas" wording — `llm.ts` tool-context prompt now tells the agent to answer from
  the on-screen item, not to tell the user to open it.
- [ ] `needs-design` Shared status + share-from-here. Confirm the connector can surface Apple Notes
  collab participants; add a "shared" badge.

## Browser Search
- [x] `done` Query framing — both capabilities use the improved `extractSearchQuery` (drops greeting /
  "can you / please / I want to…").
- [x] `done` Don't strand on the browser tab — `browse.ts` returns focus to the user's chat after the
  browse (they can still watch during). NB: true *background* browsing needs a webview re-architecture
  (the webview unmounts when the tab is inactive — `BrowserTabContent.tsx:313`).
- [~] `partial` Show what the AI is doing — step status shows in the tool message; final passage gets
  highlighted (`browserAgent.ts:313`). Per-step on-page overlay still `todo`.

## Messages
- [x] `done` FDA seamless connect — `FullDiskAccessGrant` has a one-click "Restart now" (`relaunch`).
  Restoring the exact tab after relaunch is a small follow-up (persist a return marker).
- [x] `done` Read/unread one-way — `imessage.rs` adds per-chat `unread` (join `message.is_read`);
  `MessagesPanel` shows unread dots + bold.
- [ ] `needs-design` Read/unread two-way (EXPERIMENTAL) — `chat.db` is READ_ONLY; risky write-back,
  separate gated spike.
- [x] `done` Agent spits whole convo back — untrusted tool-context prompt now asks for ONLY the
  suggested reply, not a recap.
- [x] `done` "Learn voice" clarity — clearer one-time-analysis messaging; full config already lives in
  Settings → Write Like Me (`ProfileSettingsModal`).

## Code
- [x] `done` Terminal copy/paste — `TerminalPane` `attachCustomKeyEventHandler`.
- [x] `done` Add-image in Code composer — plumbing confirmed present: `handleCodeyFileUpload`
  (`AgentForgeCodePanel.tsx`) mirrors the main handler with image support (readAsDataURL + isImage,
  gated on a vision-capable model / Image Understanding).

## Canvas
- [ ] `deferred` Broken + redundant. Root cause confirmed (orphaned `w-1/2` split + global singleton
  `canvasContent`). Plan: keep doc canvas, render it as the side-split it was designed for, give
  `canvasContent` per-tab identity, route runnable code to Code, retire the standalone Canvas entry
  (`AppSidebar.tsx:293`). Deferred to an app-verified session — touches core chat layout.
