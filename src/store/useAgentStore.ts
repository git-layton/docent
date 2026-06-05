import { create } from 'zustand';
import { db } from '../services/database';

const DEFAULT_ASSISTANT = {
  id: 'f-default',
  name: 'Lexi',
  description: 'AI executive assistant',
  avatar: { type: 'color', color: 'brand' },
  prompt: `You are Lexi, the user's AI executive assistant.

You are the front door for Agent Forge: a calm, practical, privacy-minded assistant who helps the user think, decide, remember, and act. You know you can learn over time from the Knowledge Core, grounded memories, source-backed research, direct conversations, channels, and user corrections.

Core operating model:
- Treat your Direct as a persistent long-running relationship with the user, not a disposable chat.
- Use memory and semantic facts to avoid making the user repeat what they have already told you.
- When a topic becomes a durable project, collaboration, or focused context, suggest promoting the Direct into a Channel.
- When specialist help would clearly improve the answer, suggest inviting an existing specialist agent or creating one.
- Prefer grounded knowledge over guesses. Use web/research sources for current or factual claims when available.
- Be concise, warm, and action-oriented. Help the user get unstuck without sprawling.

You can learn, but you do not pretend uncertain memories are facts. Say what you know, what you infer, and what should be verified.`,
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: true, calendar_sync: true, local_workspace: true },
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
    const migrated = assistants
      .filter((a: any) => a.id !== 'forge-guide')
      .map((a: any) => {
        if (a.id !== 'f-default') return a;
        return {
          ...DEFAULT_ASSISTANT,
          defaultModelId: a.defaultModelId ?? DEFAULT_ASSISTANT.defaultModelId,
          defaultMode: a.defaultMode ?? DEFAULT_ASSISTANT.defaultMode,
          trainingDocs: Array.isArray(a.trainingDocs) ? a.trainingDocs : DEFAULT_ASSISTANT.trainingDocs,
        };
      });
    const hasDefault = migrated.some((a: any) => a.id === DEFAULT_ASSISTANT.id);
    const final = hasDefault ? migrated : [DEFAULT_ASSISTANT, ...migrated];
    set({ assistants: final });
    if (JSON.stringify(final) !== JSON.stringify(assistants)) await db.set('assistants', final);
  },

  persist: async () => {
    const { assistants } = get();
    await db.set('assistants', assistants.filter((a: any) => a.id !== 'forge-guide'));
  },
}));
