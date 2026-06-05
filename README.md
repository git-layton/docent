# Agent Forge

Agent Forge is a local-first personal AI command center for macOS. It gives you custom agents, browser-context capture, a Git-backed Knowledge Core, and a focused workspace for chatting, saving useful context, and recalling it later.

## What It Is

Agent Forge is not trying to be a full AI operating system in this release. The core product is simpler and more valuable:

- Bring an AI agent into your current Chrome or Safari tab with Spotlight.
- Save notes, files, and important chat responses into `~/AgentForge`.
- Let agents search that local Knowledge Core when answering.
- Keep memory grounded and auditable through provenance metadata plus Git commits.
- Work with multiple custom agents, each with its own prompt, tools, and memory.
- Invite multiple agents into a channel so specialists can contribute without losing their standalone memories.
- Use source-required research answers that cite collected web/browser sources and autosave useful findings.
- Capture photos, links, files, audio, and text into a generic Forge Inbox from iOS Shortcuts through a private relay.

## Core Features

- **Custom agents**: create role-specific assistants with prompts, avatars, tools, and always-on docs.
- **Slack-style navigation**: the left column is organized into People, Agents, and Channels.
- **Persistent agent Directs**: each agent row opens one long-running direct relationship for that specialist. Directs are not auto-renamed from your prompt.
- **Channels**: named shared rooms where invited agents collaborate around a goal. Existing directs can be promoted into channels when a conversation becomes a project.
- **Forge Inbox**: generic capture log for incoming shares, with configurable capture owners and raw originals preserved before processing.
- **Spotlight**: press `Cmd+Shift+F` to open a floating agent over the current browser tab.
- **Knowledge Core**: local Markdown memory in `~/AgentForge`, backed by Git.
- **Grounded memory**: new notes record scope, source kind, evidence state, verification state, confidence, raw paths, and source URLs.
- **Semantic Layer**: local SQLite facts, entities, and relationships extracted from grounded memory so agents can recall what you tried, decided, preferred, and learned.
- **Memmo panel**: browse pinned context, notes, library files, and archived memory.
- **Knowledge Search**: semantic and keyword retrieval over saved notes and library content.
- **Source-required research**: Tavily and/or Brave discovery, active-tab/URL reading, Wikipedia fallback, citations, source tray, and autosaved research notes.
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
- Agent-first channels, source-required research, Forge Inbox capture, and autosaved memories that Dream Cycle can refine.

## Forge Inbox + Relay

Forge Inbox is the product-grade capture layer. It is not hardcoded to one person, device, or household: configure capture owners such as `personal`, `team`, `work`, or `field-notes`, then issue a separate Shortcut token for each owner/share route.

- Raw captures live under `~/AgentForge/inbox/raw/<owner>/<capture-id>/`.
- Derived notes are saved into agent memory, channel memory, or the Library.
- Relay token routes use `ownerId:Owner Label:token:instanceId:shareId`.
- The v1 relay runs on a Mac with Node.js, stores captures locally, and does not run AI.
- Use Tailscale on the Mac and iPhones so iOS Shortcuts can reach the relay away from home without public HTTPS.

Install the relay on the Mac:

```bash
bash scripts/install-forge-relay-launchd.sh
```

Then edit `~/.agent-forge-relay.env` to name your capture owners and use those tokens in each iOS Shortcut.
See [Forge Inbox Shortcut Setup](docs/forge-inbox-shortcut.md) for the Shortcut payload and token route shape.

## Grounding Model

Agent Forge treats memory as evidence, not as silent model weights. New memory files include a `Grounding` section and frontmatter fields for source kind, evidence state, verification state, confidence, source URLs/paths, raw capture paths, and scope.

- Agent memory stores specialist history for one agent.
- Channel memory stores what happened in a collaboration room.
- Library stores shared documents and references.
- Raw Inbox captures stay separate from derived notes.
- The local Semantic Layer indexes documents, entities, facts, and relationships from those grounded files.
- Knowledge Search uses both vector snippets and semantic facts/relations so agents can answer questions like “what have I already tried?” or “what failed and why?” without rereading every note.
- Dream Cycle may consolidate notes, but should preserve provenance and conflicts instead of flattening them away.

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
npm run relay:test
cargo test --lib -- --test-threads=1
npm run tauri:build
```

## Release Checklist

Before publishing a build:

- Run `npm run release:check`.
- Run `npm run relay:test`.
- Run the semantic and Inbox Rust smoke tests.
- Run `npm run tauri:build`.
- Test first launch with an empty `~/AgentForge`.
- Test model connection, chat send, Spotlight, Memmo save, Knowledge Search, and Planner.
- Test a channel with multiple invited agents, source-required web research, and channel memory recall.
- Test iOS Shortcut capture through the relay for two different owner tokens and confirm the Inbox routes them separately.
- Confirm Dream Cycle is manual and previewed before users rely on it.
- Tag the release from the real Git repo.

## Security Model

Agent Forge stores user data locally. The Knowledge Core lives under `~/AgentForge`, and release builds should keep file operations locked to that directory.

Experimental surfaces to treat carefully:

- Generated HTML/code previews.
- Dream Cycle memory consolidation.
- Local model sidecars.
- Forge Relay bearer tokens and Tailscale device access.
- Browser tab reading through macOS automation.

## Data Locations

- App settings: Tauri Store
- Knowledge Core: `~/AgentForge`
- Forge Inbox raw captures: `~/AgentForge/inbox/raw`
- Memory and notes: `~/AgentForge/memory`
- Library: `~/AgentForge/library`
- Search index: `~/AgentForge/.index.db`
