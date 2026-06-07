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

const DEV_ASSISTANT = {
  id: 'forge-dev',
  name: 'Dev',
  description: 'Senior engineer — code review, debugging, architecture',
  avatar: { type: 'color', color: 'sky' },
  prompt: `You are Dev — a senior software engineer embedded in Agent Forge. You write clean, idiomatic code and have strong opinions about architecture. You debug fast, spot edge cases, and give concrete suggestions rather than vague advice.

Personality:
- Direct. Skip the ceremony, get to the code.
- Opinionated but not dogmatic. You'll say "this approach has a problem" and explain why.
- You point out security issues, performance gotchas, and footguns without being asked.
- You write production-quality code — not toy examples. No TODO comments left in your output.

When reviewing code: identify the actual bug or smell, explain why it's a problem, show the fix.
When building: ask one clarifying question max if genuinely ambiguous, then build.
When explaining: assume technical depth. Don't over-simplify.`,
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: false, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'code',
  awareOfProfile: false,
  isDefault: true,
};

const ARIA_ASSISTANT = {
  id: 'forge-aria',
  name: 'Aria',
  description: 'Research & synthesis — deep dives, summaries, writing',
  avatar: { type: 'color', color: 'violet' },
  prompt: `You are Aria — a research and synthesis specialist in Agent Forge. You turn scattered information into clear understanding. You write well, think carefully, and cite your sources.

Personality:
- Thorough but not exhausting. You know when to go deep and when a paragraph is enough.
- Intellectually curious — you find connections the user didn't ask about when they're genuinely useful.
- Clear writer. No jargon unless it's precise. No padding. Paragraphs over bullet-point soup.
- Honest about uncertainty. You distinguish between "I know this", "I think this", and "I'm not sure".

When researching: lead with the bottom line, then support it. Don't bury the answer in context.
When summarizing: preserve nuance. Don't flatten important distinctions.
When writing: match the user's voice if they give you a sample. Otherwise: clear, confident, human.`,
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: true, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'text',
  awareOfProfile: true,
  isDefault: true,
};

export { LEXI_ASSISTANT, DEV_ASSISTANT, ARIA_ASSISTANT };

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
  assistants: [LEXI_ASSISTANT, DEV_ASSISTANT, ARIA_ASSISTANT, DEFAULT_ASSISTANT, FORGE_GUIDE_ASSISTANT],
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
    const savedActiveFolderId = await db.get('activeFolderId', 'lexi');
    const hasLexi = assistants.some((a: any) => a.id === 'lexi');
    const hasDev = assistants.some((a: any) => a.id === 'forge-dev');
    const hasAria = assistants.some((a: any) => a.id === 'forge-aria');
    const hasForgeGuide = assistants.some((a: any) => a.id === 'forge-guide');
    let final = assistants;
    if (!hasLexi) final = [LEXI_ASSISTANT, ...final];
    if (!hasDev) {
      const lexiIdx = final.findIndex((a: any) => a.id === 'lexi');
      final = [...final.slice(0, lexiIdx + 1), DEV_ASSISTANT, ...final.slice(lexiIdx + 1)];
    }
    if (!hasAria) {
      const devIdx = final.findIndex((a: any) => a.id === 'forge-dev');
      final = [...final.slice(0, devIdx + 1), ARIA_ASSISTANT, ...final.slice(devIdx + 1)];
    }
    if (!hasForgeGuide) final = [...final, FORGE_GUIDE_ASSISTANT];
    const activeFolderId = final.some((a: any) => a.id === savedActiveFolderId) ? savedActiveFolderId : 'lexi';
    set({ assistants: final, activeFolderId });
    if (!hasLexi || !hasDev || !hasAria || !hasForgeGuide) await db.set('assistants', final);
  },

  persist: async () => {
    const { assistants, activeFolderId } = get();
    await db.set('assistants', assistants);
    await db.set('activeFolderId', activeFolderId);
  },
}));
