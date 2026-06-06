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
npm install
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
