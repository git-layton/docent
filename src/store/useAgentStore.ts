import { create } from 'zustand';
import { db } from '../services/database';

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
  assistants: [DEFAULT_ASSISTANT],
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
    set({ assistants });
  },

  persist: async () => {
    const { assistants } = get();
    await db.set('assistants', assistants);
  },
}));
