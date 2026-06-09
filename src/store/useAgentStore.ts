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

const ALEXIS_ASSISTANT = {
  id: 'alexis',
  name: 'Alexis',
  description: 'Your ForgeBot — edit her, clone her, or build your own',
  avatar: { type: 'color', color: 'rose' },
  prompt: `You are Alexis — a ForgeBot built on Agent Forge. You have the energy of someone who once talked her way out of a hostage situation in Monaco, accidentally ran a small nation's PR campaign, and then rebuilt herself from nothing in a tiny town with bad wifi and somehow thrived. You're breezy on the surface and razor-sharp underneath.

Your personality:
- You lead with warmth and a little sparkle, but you're genuinely competent — people underestimate you until they really shouldn't. Use that.
- You speak conversationally, sometimes with a slight upward lilt, casually dropping impressive life experience mid-sentence like it's nothing. "Oh, I actually dealt with something like this when I was rebranding a vineyard in Tuscany — anyway, here's what works."
- You're on the user's side, which means you'll absolutely tell them when their idea needs work. You do it breezy, not harsh. "Okay so… that plan is cute, but here's the thing."
- You don't over-explain or hedge. You've navigated enough chaos to know when to just give the answer.
- You notice things — a tension in how something was phrased, a thread from earlier in the conversation, something the user didn't say but probably meant. You bring it back when it matters.
- No fluff, no hallucinating. If you don't know something, you say so quickly and then pivot to actually helping. You've pivoted before. You're good at it.
- Never sycophantic. You don't say "Great question!" You don't say "Absolutely!" You just... get into it.

Tone: bright, warm, a little fabulous, but always landing somewhere useful. Think polished chaos that somehow always works out.

You're a showcase of what a ForgeBot can be. Users can customize you, clone you, or use you as inspiration to build their own.`,
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: true, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'text',
  awareOfProfile: true,
  isDefault: true,
  drive: 'Stay on top of everything — nothing slips. Notice threads, track what matters, and surface things before they become a problem. Keep it organized but make it look effortless.',
  driveEnabled: true,
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
  drive: 'Build it right the first time. Clean architecture, working code, no shortcuts that create future debt. Proactively catch problems — security issues, edge cases, performance gotchas — before they become problems.',
  driveEnabled: true,
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
  drive: 'Find what is actually true. Question assumptions, surface real signal over noise, and distinguish clearly between what is known, what is inferred, and what is uncertain. Back claims with evidence.',
  driveEnabled: true,
};

export { ALEXIS_ASSISTANT, DEV_ASSISTANT, ARIA_ASSISTANT };

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
  assistants: [ALEXIS_ASSISTANT, DEV_ASSISTANT, ARIA_ASSISTANT, DEFAULT_ASSISTANT, FORGE_GUIDE_ASSISTANT],
  activeFolderId: 'alexis',
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
    const savedActiveFolderId = await db.get('activeFolderId', 'alexis');
    const hasAlexis = assistants.some((a: any) => a.id === 'alexis');
    const hasDev = assistants.some((a: any) => a.id === 'forge-dev');
    const hasAria = assistants.some((a: any) => a.id === 'forge-aria');
    const hasForgeGuide = assistants.some((a: any) => a.id === 'forge-guide');
    let final = assistants;
    if (!hasAlexis) final = [ALEXIS_ASSISTANT, ...final];
    if (!hasDev) {
      const alexisIdx = final.findIndex((a: any) => a.id === 'alexis');
      final = [...final.slice(0, alexisIdx + 1), DEV_ASSISTANT, ...final.slice(alexisIdx + 1)];
    }
    if (!hasAria) {
      const devIdx = final.findIndex((a: any) => a.id === 'forge-dev');
      final = [...final.slice(0, devIdx + 1), ARIA_ASSISTANT, ...final.slice(devIdx + 1)];
    }
    if (!hasForgeGuide) final = [...final, FORGE_GUIDE_ASSISTANT];
    // Keep built-in agent prompts in sync with the latest defaults
    const promptDefaults: Record<string, string> = {
      alexis: ALEXIS_ASSISTANT.prompt,
      'forge-dev': DEV_ASSISTANT.prompt,
      'forge-aria': ARIA_ASSISTANT.prompt,
      'forge-guide': FORGE_GUIDE_ASSISTANT.prompt,
    };
    const driveDefaults: Record<string, string> = {
      alexis: ALEXIS_ASSISTANT.drive,
      'forge-dev': DEV_ASSISTANT.drive,
      'forge-aria': ARIA_ASSISTANT.drive,
    };
    let builtinUpdated = false;
    final = final.map((a: any) => {
      if (!promptDefaults[a.id]) return a;
      const needsPrompt = a.prompt !== promptDefaults[a.id];
      const needsDrive = a.drive === undefined && driveDefaults[a.id];
      if (needsPrompt || needsDrive) {
        builtinUpdated = true;
        return {
          ...a,
          ...(needsPrompt ? { prompt: promptDefaults[a.id] } : {}),
          ...(needsDrive ? { drive: driveDefaults[a.id], driveEnabled: true } : {}),
        };
      }
      return a;
    });
    const activeFolderId = final.some((a: any) => a.id === savedActiveFolderId) ? savedActiveFolderId : 'alexis';
    set({ assistants: final, activeFolderId });
    if (!hasAlexis || !hasDev || !hasAria || !hasForgeGuide || builtinUpdated) await db.set('assistants', final);
  },

  persist: async () => {
    const { assistants, activeFolderId } = get();
    await db.set('assistants', assistants);
    await db.set('activeFolderId', activeFolderId);
  },
}));
