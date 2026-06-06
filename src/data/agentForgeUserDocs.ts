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
- **Archive** — deleted notes (recoverable)
- **Completed Tasks** — audit trail of finished work

Open the Memory Panel (book icon in the header) to browse Pins, Notes, Library, and Archive.

### 📅 Planner — Tasks & Calendar
The Planner (calendar icon in header) combines a task list with a calendar view:
- **List view** — all pending tasks, drag to reorder
- **Calendar view** — monthly grid with tasks, holidays, and birthdays shown per day
- **Click any day** to see a day-detail panel with all events, holidays, and a quick-add form
- US Federal holidays are built-in. Add birthdays and anniversaries in the Recurring Events section.
- Tasks added from the calendar stay in calendar mode

### 💬 Chat & Agents
- Each agent has a custom system prompt, training docs, and tool access
- Switch agents using the dropdown in the top-left
- Start a new chat with the + button
- Pin important messages to Context (⭐) — pinned content is injected into every future message with that agent
- Use /memo to save thoughts to your Knowledge Core without leaving the chat

### 🎨 Canvas
When an agent generates code, diagrams, or documents, it appears in the Canvas panel (toggle with the split-screen icon). Save canvas content to your Library.

### 🌙 Dream Cycle
Dream Cycle is an experimental, manual memory cleanup tool. Run it from Agent Settings when you want Agent Forge to suggest merges, updates, and archive actions for an agent's notes.

### 🔍 Knowledge Search
Your agent automatically searches your Knowledge Core when relevant. You can force a knowledge search for any message with ⌘⇧K.

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
- Configure **Image Generation** (OpenAI DALL-E, Google Imagen, or custom endpoint)
- Manage the **User Guide** (this document)

---

## Tips & Tricks

- **Context Pins are powerful** — pin a project brief or key facts to Context and your agent will always remember them
- **Use /memo freely** — quick captures during work get organized into your Knowledge Core
- **The Library is permanent** — bookmarked content in Library never expires (unlike chats)
- **Multiple agents for different roles** — create a "Researcher", a "Coder", and a "Writer" agent, each trained differently
- **Spotlight works mid-task** — press ⌘⇧F while reading an article, a GitHub issue, or a doc to get instant AI help without copy-pasting

---

*This guide is stored in your Knowledge Core at \`~/AgentForge/memory/agent-forge-guide.md\`. You can delete it from Settings → User Guide and restore it at any time.*
`;
