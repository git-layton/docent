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
  assistants: [DEFAULT_ASSISTANT, FORGE_GUIDE_ASSISTANT],
  activeFolderId: 'f-default',
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
    const hasForgeGuide = assistants.some((a: any) => a.id === 'forge-guide');
    const final = hasForgeGuide ? assistants : [...assistants, FORGE_GUIDE_ASSISTANT];
    set({ assistants: final });
    if (!hasForgeGuide) await db.set('assistants', final);
  },

  persist: async () => {
    const { assistants } = get();
    await db.set('assistants', assistants);
  },
}));
