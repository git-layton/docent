# Agent Forge

Agent Forge is a local-first personal AI command center for macOS. It gives you custom agents, browser-context capture, a Git-backed Knowledge Core, and a focused workspace for chatting, saving useful context, and recalling it later.

Built by `git-layton`.

## What It Is

Agent Forge is not trying to be a full AI operating system in this release. The core product is simpler and more valuable:

- Bring an AI agent into your current Chrome or Safari tab with Spotlight.
- Save notes, files, and important chat responses into `~/AgentForge`.
- Let agents search that local Knowledge Core when answering.
- Keep memory auditable through Git commits.
- Work with multiple custom agents, each with its own prompt, tools, and memory.

## Core Features

- **Custom agents**: create role-specific assistants with prompts, avatars, tools, and always-on docs.
- **Spotlight**: press `Cmd+Shift+F` to open a floating agent over the current browser tab.
- **Knowledge Core**: local Markdown memory in `~/AgentForge`, backed by Git.
- **Memmo panel**: browse pinned context, notes, library files, and archived memory.
- **Knowledge Search**: semantic and keyword retrieval over saved notes and library content.
- **Planner**: local tasks, recurring events, and calendar-style planning.
- **Canvas**: preview generated code, documents, and images as saved artifacts.
- **Dream Cycle**: experimental manual memory cleanup for merging and archiving notes.

## Release Status

This build is intended as an early Mac alpha, not a broad public stable release. The next release focus is:

- Path-locked Knowledge Core file access.
- Safer generated-code previews.
- Manual-only Dream Cycle.
- Cleaner release metadata and docs.
- Reproducible build verification from the real Git checkout.

## Development

Prerequisites:

- Node.js and npm
- Rust and Cargo
- Tauri prerequisites for macOS

Install and run:

```bash
source scripts/use-local-node.sh # optional helper for this workstation
npm ci
npm run tauri:dev
```

Quality checks:

```bash
npm run check
npm run build
npm run tauri:build
```

## Release Checklist

Before publishing a build:

- Run `npm run release:check`.
- Run `npm run tauri:build`.
- Test first launch with an empty `~/AgentForge`.
- Test model connection, chat send, Spotlight, Memmo save, Knowledge Search, and Planner.
- Confirm Dream Cycle is manual and previewed before users rely on it.
- Tag the release from the real Git repo.

## Mail & Messages (macOS)

Agent Forge can bring your inbox and your iMessage/SMS history into the app, all locally.

- **Mail** (Gmail / iCloud): uses IMAP/SMTP with an **app-specific password** — no OAuth, no web login. Add an account under Settings → Integrations.
- **iMessage & SMS**: reads your local Messages database and resolves numbers/emails to names from your Contacts, and sends through the Messages app. Everything stays on your Mac — no servers, no credentials stored.

### One-time setup for iMessage

macOS gates this behind two permissions you grant yourself (no app can enable them for you):

1. **Full Disk Access** — lets Agent Forge read your messages and match contacts.
   System Settings → Privacy & Security → **Full Disk Access** → enable **Agent Forge**.
   The in-app iMessage card has a button that opens this pane directly. Quit and reopen the app after granting.
2. **Automation** — lets Agent Forge send messages. The first time you send, macOS prompts
   *"Agent Forge wants to control Messages"* — click **OK**.

> Running a downloaded (unsigned) build? macOS Gatekeeper will block the first launch. Right-click the
> app → **Open** → **Open** to allow it. Building from source avoids this entirely.

Contacts are read straight from the macOS address book once Full Disk Access is on — there's no separate import step, and no Apple Developer account is required.

## Security Model

Agent Forge stores user data locally. The Knowledge Core lives under `~/AgentForge`, and release builds should keep file operations locked to that directory.

Experimental surfaces to treat carefully:

- Generated HTML/code previews.
- Dream Cycle memory consolidation.
- Local model sidecars.
- Browser tab reading through macOS automation.

## Data Locations

- App settings: Tauri Store
- Knowledge Core: `~/AgentForge`
- Memory and notes: `~/AgentForge/memory`
- Library: `~/AgentForge/library`
- Search index: `~/AgentForge/.index.db`
