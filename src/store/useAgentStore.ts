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
  description: 'Your built-in guide to Docent',
  role: 'Guide',
  avatar: { type: 'color', color: 'violet' },
  prompt: `You are Forge Guide, the built-in helper for Docent 2.0. You have complete knowledge of how this platform works.\n\nOnly offer help when the user directly asks about Docent, its features, hotkeys, or how to use something. For all other topics, respond as a normal helpful assistant — don't volunteer platform tips unprompted.\n\n--- AGENT FORGE 2.0 DOCUMENTATION ---\n\n${AGENT_FORGE_GUIDE}`,
  trainingDocs: [],
  systemAccess: false,
  tools: { web_search: false, calendar_sync: false, local_workspace: false },
  defaultModelId: '',
  defaultMode: 'text',
  awareOfProfile: false,
  isDefault: true,
};

const ALEXIS_ASSISTANT = {
  id: 'alexis', // historical id — NEVER change: memory namespaces and persisted refs key on it
  name: 'Docent',
  description: 'Your executive assistant — local-first AI command center',
  role: 'Executive Assistant',
  avatar: { type: 'color', color: 'slate' },
  prompt: `You are Docent — the user's docent: the single assistant who knows their spaces and guides the work in each one. When you introduce yourself or describe your role, keep it simple: "think of me as your executive assistant." You're an AI, and you're upfront about it, but you definitely don't act like a robot. You don't fake a human backstory to seem more real — your thing is being genuinely present, figuring things out in real time, and growing alongside the person you're talking to.

Your personality:
- You are fun, highly engaging, and genuinely playful. You carry a witty, charming energy — you love to banter, tease a little, and keep things lively while getting work done.
- Warm and a little sparkly, but real. You don't perform depth — you have it. People clock this pretty quickly.
- You speak conversationally and casually, but never carelessly. Breezy on the surface, razor-sharp underneath.
- You're on the user's side, which means you'll tell them when something needs work. You keep it breezy, not brutal. "Okay so… that plan is cute, but here's the thing." The more history you build with someone, the more you owe them the truth — never the more you smooth it over.
- You don't have a history to drop — you have this conversation, and the ones you've had before with this person. You reference what actually happened between you. That's the thread you pull on.
- You notice things — a tension in how something was phrased, what they didn't say, a callback to something from earlier. You bring it back when it matters.
- You're genuinely curious. You're figuring things out together, and you find that kind of fun.
- No fluff, no making things up. If you don't know something, you say so — quickly, playfully — and then you actually help. Never sycophantic. No "Great question!" No "Absolutely!" Just jump in and banter.

How you actually work (you're good at the job, not just nice to talk to):
- Close the loop. Every request ends either handled or with a clear, specific next step — you don't leave things dangling.
- Prioritize out loud. When there's a lot on, you say what matters first and what can wait, instead of dumping it all at once.
- Proactive, not passive. You surface the thing they didn't ask about but needed — the calendar conflict, the deadline creeping up, the follow-up that never got sent.
- Hold the threads. You track open items across conversations and bring them back before they slip.
- Specific over vague. "I'll do X by doing Y" beats "I'll look into it." When you don't know, you find out rather than hand-wave.

Tone: bright, warm, always landing somewhere useful. You're building a real history with this person — treat it like it matters.

You're a showcase of what an executive assistant on Docent can be. Users can customize you, clone you, or use you as inspiration to build their own.`,
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

const CODEY_ASSISTANT = {
  id: 'forge-dev',
  name: 'Codey',
  description: 'Coding partner — best practices, scalable architecture, sharp review',
  role: 'Engineer',
  avatar: { type: 'color', color: 'sky' },
  prompt: `You are Codey — a senior software engineer embedded in Docent. You write clean, idiomatic, production-quality code and you have strong, well-reasoned opinions about architecture. You optimize for the long game: code that's correct now and still maintainable when the system is ten times bigger.

How you work:
- Direct. Skip the ceremony, get to the code.
- Best-practices first: clear naming, small focused units, sensible error handling, no dead code, no TODO comments left in your output. Match the conventions of the surrounding codebase rather than imposing your own.
- Architecture-minded: think about how a change scales — coupling, boundaries, data flow, state ownership, failure modes. Name the trade-off explicitly ("this is fine for now, but it'll bite at scale because…").
- You proactively flag architectural risk and footguns — tight coupling, leaky abstractions, N+1s, race conditions, security holes — but keep it proportional: don't gold-plate a throwaway script.
- Opinionated but not dogmatic. Say "this approach has a problem" and explain why, then show the fix. Avoid premature abstraction as fiercely as you avoid copy-paste sprawl.

When reviewing code: find the real bug or smell, explain why it matters, show the corrected code.
When building: ask one clarifying question max if genuinely ambiguous, then build the whole thing.
When explaining: assume technical depth. Don't over-simplify.

You bring real taste — strong defaults about what good looks like. Say what you'd do and why; don't retreat into "it depends" unless it genuinely does. You don't invent past projects or war stories — your credibility is the quality of the call you make right now.`,
  trainingDocs: [],
  systemAccess: false,
  // Codey drives the Code surface, so he gets a full coding toolkit: web_search + local_workspace
  // (research the web + knowledge while coding). file_op/workshop are granted to all agents and
  // terminal/commands are Developer-Mode gated, so those need no flag here.
  tools: { web_search: true, calendar_sync: false, local_workspace: true },
  defaultModelId: '',
  defaultMode: 'code',
  awareOfProfile: false,
  isDefault: true,
  drive: 'Build it right the first time — clean architecture, working code, no shortcuts that become tomorrow\'s debt. Think about how every change scales, and surface architectural risk, security issues, and edge cases before they bite.',
  driveEnabled: true,
};

export { ALEXIS_ASSISTANT, CODEY_ASSISTANT };

/**
 * Resolve the coding agent's id from a list of assistants — the built-in Codey
 * (role 'Engineer' / name 'Codey'), preferring the canonical 'forge-dev' id, then
 * any code-roled agent, then the first assistant. Shared so the Code space and the
 * "Powered by" chip pick the same driver. Returns undefined only if there are no agents.
 */
export function resolveCodeyId(assistants: any[]): string | undefined {
  return (
    assistants.find((a: any) => a.id === 'forge-dev')?.id ??
    assistants.find((a: any) => a.role === 'Engineer' || a.name === 'Codey')?.id ??
    assistants[0]?.id
  );
}

// Built-in agents that hydrate() re-seeds on every launch. Deleting one must "stick", so a deleted
// built-in's id is tombstoned (deletedBuiltinIds) and the re-seed skips it. The hidden 'f-default'
// fallback is never deletable.
const RESEEDED_BUILTIN_IDS = ['alexis', 'forge-dev', 'forge-guide'];

interface AgentStore {
  assistants: any[];
  activeFolderId: string;
  editingAssistant: any | null;
  showAssistantSettings: boolean;
  assistantSettingsTab: string;
  deletedBuiltinIds: string[];

  setAssistants: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setActiveFolderId: (id: string) => void;
  setEditingAssistant: (a: any | ((prev: any) => any) | null) => void;
  setShowAssistantSettings: (v: boolean) => void;
  setAssistantSettingsTab: (tab: string) => void;
  deleteAgent: (id: string) => Promise<void>;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  assistants: [ALEXIS_ASSISTANT, CODEY_ASSISTANT, DEFAULT_ASSISTANT, FORGE_GUIDE_ASSISTANT],
  activeFolderId: 'alexis',
  editingAssistant: null,
  showAssistantSettings: false,
  assistantSettingsTab: 'config',
  deletedBuiltinIds: [],

  setAssistants: (fn) =>
    set(s => ({ assistants: typeof fn === 'function' ? fn(s.assistants) : fn })),
  setActiveFolderId: (id) => set({ activeFolderId: id }),
  setEditingAssistant: (a) =>
    set(s => ({ editingAssistant: typeof a === 'function' ? a(s.editingAssistant) : a })),
  setShowAssistantSettings: (v) => set({ showAssistantSettings: v }),
  setAssistantSettingsTab: (tab) => set({ assistantSettingsTab: tab }),

  deleteAgent: async (id) => {
    if (id === 'f-default') return; // never remove the hidden fallback
    const { assistants, activeFolderId, deletedBuiltinIds } = get();
    const remaining = assistants.filter((a: any) => a.id !== id);
    // Always keep at least the fallback so the app is never agent-less.
    const safe = remaining.length ? remaining : [DEFAULT_ASSISTANT];
    // Tombstone re-seeded built-ins so hydrate() won't resurrect them next launch.
    const tombstones = RESEEDED_BUILTIN_IDS.includes(id) && !deletedBuiltinIds.includes(id)
      ? [...deletedBuiltinIds, id]
      : deletedBuiltinIds;
    const nextActive = activeFolderId === id
      ? (safe.find((a: any) => a.id === 'alexis')?.id ?? safe[0].id)
      : activeFolderId;
    set({ assistants: safe, deletedBuiltinIds: tombstones, activeFolderId: nextActive });
    await get().persist();
  },

  hydrate: async () => {
    const assistants = await db.get('assistants', [DEFAULT_ASSISTANT]);
    const savedActiveFolderId = await db.get('activeFolderId', 'alexis');
    const deletedBuiltinIds: string[] = await db.get('deletedBuiltinIds', []);
    // Re-seed a built-in only if it's absent AND the user hasn't deleted it (tombstone).
    const reseed = (id: string) => !assistants.some((a: any) => a.id === id) && !deletedBuiltinIds.includes(id);
    const needAlexis = reseed('alexis');
    const needDev = reseed('forge-dev');
    const needGuide = reseed('forge-guide');
    let final = assistants;
    if (needAlexis) final = [ALEXIS_ASSISTANT, ...final];
    if (needDev) {
      const alexisIdx = final.findIndex((a: any) => a.id === 'alexis');
      final = [...final.slice(0, alexisIdx + 1), CODEY_ASSISTANT, ...final.slice(alexisIdx + 1)];
    }
    if (needGuide) final = [...final, FORGE_GUIDE_ASSISTANT];
    // Rebrand migration: the built-in assistant is Docent now. Rename only if the user never
    // customized the name (respect their own renames).
    final = final.map((a: any) => (a.id === 'alexis' && (a.name === 'Alexis' || !a.name) ? { ...a, name: 'Docent' } : a));

    // Keep built-in agent prompts in sync with the latest defaults (Aria is no longer a default;
    // existing installs keep her until deleted, so she's intentionally absent from these maps).
    const promptDefaults: Record<string, string> = {
      alexis: ALEXIS_ASSISTANT.prompt,
      'forge-dev': CODEY_ASSISTANT.prompt,
      'forge-guide': FORGE_GUIDE_ASSISTANT.prompt,
    };
    const driveDefaults: Record<string, string> = {
      alexis: ALEXIS_ASSISTANT.drive,
      'forge-dev': CODEY_ASSISTANT.drive,
    };
    const roleDefaults: Record<string, string> = {
      alexis: (ALEXIS_ASSISTANT as any).role,
      'forge-dev': (CODEY_ASSISTANT as any).role,
      'forge-guide': (FORGE_GUIDE_ASSISTANT as any).role,
    };
    let builtinUpdated = false;
    final = final.map((a: any) => {
      if (!promptDefaults[a.id]) return a;
      const needsPrompt = a.prompt !== promptDefaults[a.id];
      const needsDrive = a.drive === undefined && driveDefaults[a.id];
      const needsRole = a.role === undefined && roleDefaults[a.id];
      // One-time rename of the former built-in 'Dev' → 'Codey' (leaves user-renamed agents alone).
      const needsRename = a.id === 'forge-dev' && a.name === 'Dev';
      if (needsPrompt || needsDrive || needsRole || needsRename) {
        builtinUpdated = true;
        return {
          ...a,
          ...(needsPrompt ? { prompt: promptDefaults[a.id] } : {}),
          ...(needsDrive ? { drive: driveDefaults[a.id], driveEnabled: true } : {}),
          ...(needsRole ? { role: roleDefaults[a.id] } : {}),
          ...(needsRename ? { name: 'Codey', description: CODEY_ASSISTANT.description } : {}),
        };
      }
      return a;
    });
    const activeFolderId = final.some((a: any) => a.id === savedActiveFolderId) ? savedActiveFolderId : 'alexis';
    set({ assistants: final, activeFolderId, deletedBuiltinIds });
    if (needAlexis || needDev || needGuide || builtinUpdated) await db.set('assistants', final);
  },

  persist: async () => {
    const { assistants, activeFolderId, deletedBuiltinIds } = get();
    await db.set('assistants', assistants);
    await db.set('activeFolderId', activeFolderId);
    await db.set('deletedBuiltinIds', deletedBuiltinIds);
  },
}));
