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

const DOCENT_ASSISTANT = {
  // Renamed from 'alexis' in the Docent rebrand. Memory namespaces and persisted agent
  // refs key on this id, so the rename orphans anything written under the old one — done
  // deliberately, with no installed base to protect. Treat it as fixed from here: once
  // this ships, changing it again costs real user memory and needs a migration.
  id: 'docent',
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
  // Docent is the only built-in assistant, so he carries the full toolkit: web_search for research and
  // local_workspace for Knowledge Base search. file_op/workshop are granted to every agent and
  // terminal commands are Developer-Mode gated, so those need no flag here.
  tools: { web_search: true, calendar_sync: false, local_workspace: true },
  defaultModelId: '',
  defaultMode: 'text',
  awareOfProfile: true,
  isDefault: true,
  drive: 'Stay on top of everything — nothing slips. Notice threads, track what matters, and surface things before they become a problem. Keep it organized but make it look effortless.',
  driveEnabled: true,
};

export { DOCENT_ASSISTANT };

// Agent ids retired in the one-assistant merge (July 2026). Codey's engineering judgment lives on as
// a surface-scoped skill (data/skills.ts ENGINEERING_SKILL) and Forge Guide's stale platform docs are
// gone entirely — Docent is the single built-in assistant. See migrateRetiredAgents.
export const RETIRED_AGENT_IDS = ['forge-dev', 'forge-guide'];

/**
 * One-assistant migration: drop the retired built-ins and hand anything that pointed at them back to
 * Docent. Pure so it can be tested without a database — callers persist the result.
 *
 * Deliberately does NOT delete the conversations those agents held: a thread keeps its messages and
 * simply becomes a Docent thread. Erasing chat history was never the point of retiring a persona.
 */
export function migrateRetiredAgents(assistants: any[]): { assistants: any[]; changed: boolean } {
  const kept = assistants.filter((a: any) => !RETIRED_AGENT_IDS.includes(a.id));
  if (kept.length === assistants.length) return { assistants, changed: false };
  // Codey's toolkit folds into Docent — a one-time additive grant, not a recurring override, so the
  // user can turn it back off in agent settings and it stays off.
  const merged = kept.map((a: any) =>
    a.id === 'docent' ? { ...a, tools: { ...(a.tools ?? {}), local_workspace: true } } : a,
  );
  return { assistants: merged.length ? merged : [DOCENT_ASSISTANT], changed: true };
}

/** Re-point a chat/space record's agent references off a retired agent and onto Docent. */
export function repointRetiredAgentRefs<T extends Record<string, any>>(record: T): T {
  const swap = (id: string) => (RETIRED_AGENT_IDS.includes(id) ? 'docent' : id);
  const next: Record<string, any> = { ...record };
  if (typeof next.folderId === 'string') next.folderId = swap(next.folderId);
  if (typeof next.primaryAgentId === 'string') next.primaryAgentId = swap(next.primaryAgentId);
  if (Array.isArray(next.participantAgentIds)) {
    next.participantAgentIds = [...new Set(next.participantAgentIds.map((id: string) => swap(id)))];
  }
  if (Array.isArray(next.agentIds)) {
    next.agentIds = [...new Set(next.agentIds.map((id: string) => swap(id)))];
  }
  return next as T;
}

// Built-in agents that hydrate() re-seeds on every launch. Deleting one must "stick", so a deleted
// built-in's id is tombstoned (deletedBuiltinIds) and the re-seed skips it. The hidden 'f-default'
// fallback is never deletable.
const RESEEDED_BUILTIN_IDS = ['docent'];

/** The built-in's id before the Docent rebrand. Records carrying it are dropped on hydrate so the
 *  rename replaces the old assistant instead of duplicating it. */
export const LEGACY_BUILTIN_ID = 'alexis';

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
  assistants: [DOCENT_ASSISTANT, DEFAULT_ASSISTANT],
  activeFolderId: 'docent',
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
      ? (safe.find((a: any) => a.id === 'docent')?.id ?? safe[0].id)
      : activeFolderId;
    set({ assistants: safe, deletedBuiltinIds: tombstones, activeFolderId: nextActive });
    await get().persist();
  },

  hydrate: async () => {
    const persisted = await db.get('assistants', [DEFAULT_ASSISTANT]);
    // Drop the pre-rename built-in. Without this the reseed below sees no 'docent', adds a fresh
    // one, and the stale 'alexis' record sits beside it — two agents, both displaying the name
    // "Docent", which is worse than either losing it or keeping it. Only the built-in id is
    // dropped; user-created agents are untouched.
    const assistants = persisted.filter((a: any) => a?.id !== LEGACY_BUILTIN_ID);
    const savedActiveFolderId = await db.get('activeFolderId', 'docent');
    const deletedBuiltinIds: string[] = await db.get('deletedBuiltinIds', []);
    // Re-seed a built-in only if it's absent AND the user hasn't deleted it (tombstone).
    const reseed = (id: string) => !assistants.some((a: any) => a.id === id) && !deletedBuiltinIds.includes(id);
    const needDocent = reseed('docent');
    let final = assistants;
    if (needDocent) final = [DOCENT_ASSISTANT, ...final];
    // Rebrand migration: the built-in assistant is Docent now. Rename only if the user never
    // customized the name (respect their own renames).
    final = final.map((a: any) => (a.id === 'docent' && !a.name ? { ...a, name: 'Docent' } : a));

    // One-assistant merge: Codey and Forge Guide are retired. Their threads keep every message and
    // become Docent's (see repointRetiredAgentRefs, applied by the chat/space stores on hydrate).
    const retired = migrateRetiredAgents(final);
    final = retired.assistants;

    // Keep built-in agent prompts in sync with the latest defaults (Aria is no longer a default;
    // existing installs keep her until deleted, so she's intentionally absent from these maps).
    const promptDefaults: Record<string, string> = { docent: DOCENT_ASSISTANT.prompt };
    const driveDefaults: Record<string, string> = { docent: DOCENT_ASSISTANT.drive };
    const roleDefaults: Record<string, string> = { docent: (DOCENT_ASSISTANT as any).role };
    let builtinUpdated = false;
    final = final.map((a: any) => {
      if (!promptDefaults[a.id]) return a;
      const needsPrompt = a.prompt !== promptDefaults[a.id];
      const needsDrive = a.drive === undefined && driveDefaults[a.id];
      const needsRole = a.role === undefined && roleDefaults[a.id];
      if (needsPrompt || needsDrive || needsRole) {
        builtinUpdated = true;
        return {
          ...a,
          ...(needsPrompt ? { prompt: promptDefaults[a.id] } : {}),
          ...(needsDrive ? { drive: driveDefaults[a.id], driveEnabled: true } : {}),
          ...(needsRole ? { role: roleDefaults[a.id] } : {}),
        };
      }
      return a;
    });
    // A retired agent can still be the persisted "active" one — fall back to Docent, never to nothing.
    const activeFolderId = final.some((a: any) => a.id === savedActiveFolderId) ? savedActiveFolderId : 'docent';
    set({ assistants: final, activeFolderId, deletedBuiltinIds });
    if (needDocent || retired.changed || builtinUpdated) await db.set('assistants', final);
  },

  persist: async () => {
    const { assistants, activeFolderId, deletedBuiltinIds } = get();
    await db.set('assistants', assistants);
    await db.set('activeFolderId', activeFolderId);
    await db.set('deletedBuiltinIds', deletedBuiltinIds);
  },
}));
