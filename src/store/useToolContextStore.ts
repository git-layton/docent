import { create } from 'zustand';

// The currently-open tool's content snapshot, published by tool panels (Inbox, Notes, Calendar, …)
// so the docked agent can actually READ what's on screen — not just know a tab is open. Only one
// tool panel is the active center content at a time, so a single slot is enough; panels clear it on
// unmount. Fed into the agent's context at send time (see buildSystemPrompt `toolContext`).
export interface ToolContextSnapshot {
  label: string; // e.g. "Inbox", "Note: Groceries", "Calendar — June 2026"
  text: string;  // a concise plaintext view of what's shown
}

interface ToolContextStore {
  content: ToolContextSnapshot | null;
  setToolContext: (c: ToolContextSnapshot) => void;
  clearToolContext: () => void;
}

export const useToolContextStore = create<ToolContextStore>((set) => ({
  content: null,
  setToolContext: (c) => set({ content: c }),
  clearToolContext: () => set({ content: null }),
}));
