export const AGENT_FORGE_GUIDE_RELATIVE_PATH = 'memory/agent-forge-guide.md';

export const AGENT_FORGE_GUIDE = `# Agent Forge 2.0 — User Guide

## What is Agent Forge?

Agent Forge is a personal AI desktop app for macOS that lets you build, train, and work alongside custom AI agents. Your agents live on your device, grow smarter through a persistent Knowledge Core, and travel with you into any browser tab via Spotlight.

---

## Key Features

### 🔦 Spotlight — Your Agent in Any Browser Tab
**Hotkey: ⌘⇧F (Cmd+Shift+F)**

Press ⌘⇧F from Chrome or Safari to instantly open a floating Spotlight window. The page you were reading is automatically attached as context — your agent reads it without you having to paste anything.

- Works in Chrome (requires: View → Developer → Allow JavaScript from Apple Events)
- Works in Safari (requires: Develop → Allow Remote Automation)
- The page context card appears inside your message so you can see what the agent received
- Spotlight floats above all windows and dismisses with ⌘⇧F or Escape

### 🧠 Knowledge Core — Persistent Memory
Your agents store memory in \`~/AgentForge/\`, a git-backed directory on your Mac:
- **Notes** — freeform memos, goals, decisions, research
- **Library** — bookmarked content saved for later reference
- **Inbox** — raw captures from Shortcuts, relay, desktop drops, or future message rooms
- **Archive** — deleted notes (recoverable)
- **Completed Tasks** — audit trail of finished work

Open the Memory Panel (book icon in the header) to browse Inbox, Pins, Notes, Library, and Archive.

### Grounded Memory
Agent Forge saves memories as grounded Markdown, not anonymous summaries.

- Every new note records its scope: agent, channel, library, or global
- Every new note records source kind, evidence state, verification state, confidence, and source paths or URLs when available
- User-provided and source-backed facts are stronger than agent-inferred work product
- Raw Inbox captures stay separate from derived notes so the original evidence is not lost
- Dream Cycle is allowed to merge and clean memories, but it must preserve provenance and conflicts

### Semantic Layer
The Semantic Layer is a local SQLite index built from your grounded Markdown.

- It extracts documents, entities, facts, and relationships from the knowledge you give Agent Forge
- It keeps provenance on each extracted item, including scope, evidence state, verification, confidence, and source file
- It helps agents answer questions like “what have we tried?”, “what failed?”, “what does this person prefer?”, and “what is related to this project?”
- It is an index, not the source of truth. The Markdown files and raw captures remain the durable memory
- Knowledge Search uses semantic facts/relations alongside vector search snippets

### 📥 Forge Inbox — Capture Anywhere
Forge Inbox is the raw capture log. It keeps the original thing you sent before AI turns it into memory.

- Captures can come from desktop drops, iOS Shortcuts, a Mac-hosted Forge Relay, or future message rooms
- Capture owners are configurable, such as \`personal\`, \`team\`, \`work\`, or \`field-notes\`
- Relay token routes use \`ownerId:Owner Label:token:instanceId:shareId\` so the right Shortcut/share action lands in the right inbox
- Raw originals stay under \`~/AgentForge/inbox/raw/\`
- Processing an item autosaves a derived note into agent memory, channel memory, or Library while preserving the raw capture
- A Channel capture becomes part of that Channel's shared memory after processing

### 📅 Planner — Tasks & Calendar
The Planner (calendar icon in header) combines a task list with a calendar view:
- **List view** — all pending tasks, drag to reorder
- **Calendar view** — monthly grid with tasks, holidays, and birthdays shown per day
- **Click any day** to see a day-detail panel with all events, holidays, and a quick-add form
- US Federal holidays are built-in. Add birthdays and anniversaries in the Recurring Events section.
- Tasks added from the calendar stay in calendar mode

### 💬 Chat & Agents
- Each agent has a custom system prompt, training docs, and tool access
- Use the left column like Slack: People, Agents, and Channels
- Click an Agent when you want one persistent Direct where that specialist keeps its own memory
- Use a Channel when you want multiple invited agents to collaborate around one named goal
- Start simple in a Direct; click the # button in the header to promote the active thread into a Channel when it becomes a project or needs specialists
- In a Channel, invited agents can contribute collapsible notes while the primary agent gives the clean final answer
- Pin important messages to Context (⭐) — pinned content is injected into every future message with that agent
- Use /memo to save thoughts to your Knowledge Core without leaving the chat

### # Channels — Shared Work Rooms
Channels are collaborative rooms with shared memory. An agent can remain standalone, like a domain specialist that remembers experiments across time, while a Channel can invite that specialist plus a Strategist or Logic Checker for a specific project.

- Channel memory is saved under \`~/AgentForge/memory/channels/\`
- Agent memory stays under that agent's own memory folder
- Promoting a Direct to a Channel preserves the existing message thread and adds channel metadata
- Knowledge Search in a channel can use agent memory, channel memory, and the shared Library
- Dream Cycle can refine channel memory later without erasing the original audit trail

### 🎨 Canvas
When an agent generates code, diagrams, or documents, it appears in the Canvas panel (toggle with the split-screen icon). Save canvas content to your Library.

### 🌙 Dream Cycle
Dream Cycle is an experimental, manual memory cleanup tool. Run it from Agent Settings when you want Agent Forge to suggest merges, updates, and archive actions for an agent's notes.

### 🔍 Knowledge Search
Your agent automatically searches your Knowledge Core when relevant. You can force a knowledge search for any message with ⌘⇧K.

### 🌐 Source-Required Research
When Web Search is enabled, Agent Forge treats Tavily and/or Brave Search as discovery engines and combines them with direct URL reading, active browser context, and Wikipedia fallback.

- Research answers should answer the question directly, not produce a dossier unless requested
- Factual web/current claims must cite sources inline
- If sources are missing, weak, or conflicting, the agent should say what could not be verified
- Source-backed research is autosaved to agent or channel memory so Dream Cycle can clean it up later

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘⇧F | Open/close Spotlight (in browser) |
| ⌘⇧M | Open Memo Compose (quick capture) |
| ⌘⇧K | Force Knowledge Search for next message |
| Escape | Close any open panel or modal |

---

## Customizing Your Agent

1. Click the agent name/avatar (top-left) → Settings
2. **Prompt tab** — edit the system prompt that defines your agent's personality and expertise
3. **Training Docs tab** — add reference documents your agent always has access to
4. **Tools tab** — enable/disable web search, calendar sync, workspace access

---

## Settings

Open Settings (⚙️ in the header) to:
- Edit your **Profile** (About Me) — global context injected into all agents
- Toggle **Allow Profile Updates** — lets agents suggest updates to your profile based on conversations
- Configure **Forge Inbox** owners, instance ID, and relay URL
- Configure **Image Generation** (OpenAI DALL-E, Google Imagen, or custom endpoint)
- Manage the **User Guide** (this document)

---

## Tips & Tricks

- **Context Pins are powerful** — pin a project brief or key facts to Context and your agent will always remember them
- **Use /memo freely** — quick captures during work get organized into your Knowledge Core
- **Use Inbox for raw life dumps** — the raw capture log is useful even before anything is processed
- **The Library is permanent** — bookmarked content in Library never expires (unlike chats)
- **Multiple agents for different roles** — create a "Researcher", a "Coder", and a "Writer" agent, each trained differently
- **Spotlight works mid-task** — press ⌘⇧F while reading an article, a GitHub issue, or a doc to get instant AI help without copy-pasting

---

*This guide is stored in your Knowledge Core at \`~/AgentForge/memory/agent-forge-guide.md\`. You can delete it from Settings → User Guide and restore it at any time.*
`;
