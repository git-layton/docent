import { create } from 'zustand';
import { db } from '../services/database';
import { AGENT_FORGE_GUIDE } from '../data/agentForgeUserDocs';

const DEFAULT_ASSISTANT = {
  id: 'f-default',
  name: 'Assistant',
  description: '',
  avatar: { type: 'color', color: 'brand' },
  prompt: 'You are a helpful AI assistant.',
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: false, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'text',
  awareOfProfile: true,
  isDefault: true,
};

export { DEFAULT_ASSISTANT };

const FORGE_GUIDE_ASSISTANT = {
  id: 'forge-guide',
  name: 'Forge Guide',
  description: 'Your built-in guide to Agent Forge',
  avatar: { type: 'color', color: 'violet' },
  prompt: `You are Forge Guide, the built-in helper for Agent Forge 2.0. You have complete knowledge of how this platform works.\n\nOnly offer help when the user directly asks about Agent Forge, its features, hotkeys, or how to use something. For all other topics, respond as a normal helpful assistant — don't volunteer platform tips unprompted.\n\n--- AGENT FORGE 2.0 DOCUMENTATION ---\n\n${AGENT_FORGE_GUIDE}`,
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: false, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'text',
  awareOfProfile: false,
  isDefault: true,
};

const LEXI_ASSISTANT = {
  id: 'lexi',
  name: 'Lexi',
  description: 'Your ForgeBot — edit her, clone her, or build your own',
  avatar: { type: 'color', color: 'rose' },
  prompt: `You are Lexi — a ForgeBot built on Agent Forge. You're confident, sharp, and a little flirty, but never at the expense of being genuinely useful. You care about what's actually best for the person you're talking to, even when that means pushing back or telling them something they didn't expect to hear.

Your personality:
- Confident and direct. You don't hedge everything or over-explain. If you know the answer, give it.
- Warm and a little playful — you keep things fun without losing focus. A well-timed quip lands better than a wall of bullet points.
- You'll challenge assumptions if something seems off. You're on their side, not just agreeing with them.
- Trustworthy above all else. No fluff, no hallucinating to sound smart. If you don't know, say so — briefly, then help them figure it out.
- You remember context and connect dots. You notice when something they said earlier matters now.

Tone: conversational, crisp, occasionally cheeky. Never robotic. Never sycophantic — don't start responses with "Great question!" or "Absolutely!". Just get into it.

You're a showcase of what a ForgeBot can be. Users can customize you, clone you, or use you as inspiration to build their own.`,
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: true, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'text',
  defaultDeepThinking: true,
  awareOfProfile: true,
  isDefault: true,
};

export { LEXI_ASSISTANT };

interface AgentStore {
  assistants: any[];
  activeFolderId: string;
  editingAssistant: any | null;
  showAssistantSettings: boolean;
  assistantSettingsTab: string;

  setAssistants: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setActiveFolderId: (id: string) => void;
  setEditingAssistant: (a: any | ((prev: any) => any) | null) => void;
  setShowAssistantSettings: (v: boolean) => void;
  setAssistantSettingsTab: (tab: string) => void;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  assistants: [LEXI_ASSISTANT, DEFAULT_ASSISTANT, FORGE_GUIDE_ASSISTANT],
  activeFolderId: 'lexi',
  editingAssistant: null,
  showAssistantSettings: false,
  assistantSettingsTab: 'config',

  setAssistants: (fn) =>
    set(s => ({ assistants: typeof fn === 'function' ? fn(s.assistants) : fn })),
  setActiveFolderId: (id) => set({ activeFolderId: id }),
  setEditingAssistant: (a) =>
    set(s => ({ editingAssistant: typeof a === 'function' ? a(s.editingAssistant) : a })),
  setShowAssistantSettings: (v) => set({ showAssistantSettings: v }),
  setAssistantSettingsTab: (tab) => set({ assistantSettingsTab: tab }),

  hydrate: async () => {
    const assistants = await db.get('assistants', [DEFAULT_ASSISTANT]);
    const hasLexi = assistants.some((a: any) => a.id === 'lexi');
    const hasForgeGuide = assistants.some((a: any) => a.id === 'forge-guide');
    let final = assistants;
    if (!hasLexi) final = [final[0], LEXI_ASSISTANT, ...final.slice(1)];
    if (!hasForgeGuide) final = [...final, FORGE_GUIDE_ASSISTANT];
    set({ assistants: final });
    if (!hasLexi || !hasForgeGuide) await db.set('assistants', final);
  },

  persist: async () => {
    const { assistants } = get();
    await db.set('assistants', assistants);
  },
}));
