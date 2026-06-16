// ─── "Write like me" — runtime orchestration ────────────────────────────────────
// The impure half of the voice layer: harvests the user's SENT comms (iMessage + email),
// distills them into a voice card, and drafts replies on demand. Depends on the model + stores +
// Tauri; imports the pure helpers from voice.ts (one-way, so no import cycle with llm.ts).

import { invoke } from '@tauri-apps/api/core';
import { generateTextResponse } from './llm';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  buildDistillSystemPrompt,
  buildDistillUserPrompt,
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  cleanEmailBody,
  cleanSamples,
  normalizeVoiceProfile,
  packSamples,
  parseDrafts,
  type DraftRequest,
  type VoiceSurface,
} from './voice';

const genId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// A bare one-shot model call: the active model, a throwaway system instruction, no history.
// Mirrors App.tsx's `enhance`. Critically, it does NOT pass `voiceProfile`, so buildSystemPrompt
// never injects the voice block here — the distill/draft system prompts are self-contained.
const runModel = async (systemInstruction: string, userText: string, signal?: AbortSignal): Promise<string> => {
  const { models, selectedModelId, appSettings, integrations } = useSettingsStore.getState();
  const model = models.find((m) => m.id === selectedModelId) ?? models[0] ?? null;
  if (!model) throw new Error('Connect a model first.');
  const agent = { prompt: systemInstruction, tools: {}, awareOfProfile: false, trainingDocs: [] };
  const result = await generateTextResponse({
    messages: [{ id: genId('msg'), role: 'user', content: userText }],
    modelConfig: model,
    profile: '',
    attachedDocs: [],
    agent,
    tasks: [],
    mode: 'text',
    canvasContent: null,
    isDeepThinking: false,
    agentPinnedMessages: [],
    onChunk: null,
    signal: signal ?? null,
    appSettings,
    integrations,
    models,
  });
  return String(result ?? '');
};

// ── Harvest the user's own sent text ──

// iMessage: walk recent chats and keep messages the user sent (fromMe). Best-effort — returns []
// outside Tauri or when Full Disk Access isn't granted.
export const harvestImessageSent = async (maxChats = 25, perChat = 60, cap = 400): Promise<string[]> => {
  try {
    const chats = await invoke<any[]>('imessage_list_chats', { limit: maxChats });
    const out: string[] = [];
    for (const c of chats ?? []) {
      if (out.length >= cap) break;
      try {
        const msgs = await invoke<any[]>('imessage_fetch_messages', { chatId: c.chatId, limit: perChat });
        for (const m of msgs ?? []) {
          if (m?.fromMe && typeof m.text === 'string' && m.text.trim()) out.push(m.text);
        }
      } catch {
        /* skip a thread we can't read */
      }
    }
    return out;
  } catch {
    return [];
  }
};

// Email: read the bodies of messages in each connected account's Sent folder, stripped of quotes.
export const harvestSentEmail = async (perAccount = 40, cap = 120): Promise<string[]> => {
  const { integrations } = useSettingsStore.getState();
  const accounts = (((integrations as any).mailAccounts ?? []) as Array<{ provider: string; email: string }>) || [];
  const out: string[] = [];
  for (const acct of accounts) {
    if (out.length >= cap) break;
    try {
      const cred = await invoke<{ ok: boolean; password?: string }>('keychain_get', {
        host: `mail:${acct.email}`,
      }).catch(() => ({ ok: false }) as { ok: boolean; password?: string });
      if (!cred?.ok || !cred.password) continue;
      const sent = await invoke<Array<{ text: string }>>('mail_fetch_sent', {
        provider: acct.provider,
        email: acct.email,
        password: cred.password,
        limit: perAccount,
      });
      for (const s of sent ?? []) {
        const body = cleanEmailBody(s?.text ?? '');
        if (body) out.push(body);
      }
    } catch {
      /* skip an account we can't reach */
    }
  }
  return out;
};

export interface VoiceBuildResult {
  card: string;
  sampleCounts: { imessage: number; email: number };
}

// Harvest both sources, distill into a voice card. Throws if there's too little to learn from.
export const buildVoiceCard = async (signal?: AbortSignal): Promise<VoiceBuildResult> => {
  const [imsgRaw, emailRaw] = await Promise.all([harvestImessageSent(), harvestSentEmail()]);
  const imsg = cleanSamples(imsgRaw);
  const email = cleanSamples(emailRaw);
  if (imsg.length + email.length < 5) {
    throw new Error(
      "Not enough of your sent messages to learn from yet. Make sure iMessage (Full Disk Access) or a mail account is connected, then try again.",
    );
  }
  const packed = [
    email.length ? `# EMAILS YOU SENT\n${packSamples(email, 2500)}` : '',
    imsg.length ? `# TEXTS YOU SENT\n${packSamples(imsg, 3500)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await runModel(buildDistillSystemPrompt(), buildDistillUserPrompt(packed), signal);
  const card = raw.replace(/^```[a-zA-Z]*\n?/gm, '').replace(/```/g, '').trim();
  if (!card) throw new Error('The model returned an empty voice profile — try again.');
  return { card, sampleCounts: { imessage: imsg.length, email: email.length } };
};

// Draft 1..n replies/messages in the user's voice. Surface decides the default option count
// (texts get a few short choices; email gets one full draft).
export const draftReply = async (
  req: { surface: VoiceSurface; incoming?: string; instruction?: string; recipient?: string; count?: number },
  signal?: AbortSignal,
): Promise<string[]> => {
  const vp = normalizeVoiceProfile(useSettingsStore.getState().appSettings?.voiceProfile);
  const card = vp.card.trim();
  if (!card) throw new Error('No writing voice yet — build it in Settings → My Profile.');
  const count = req.count ?? (req.surface === 'imessage' ? 3 : 1);
  const full: DraftRequest = {
    surface: req.surface,
    card,
    incoming: req.incoming,
    instruction: req.instruction,
    recipient: req.recipient,
    count,
  };
  const raw = await runModel(buildDraftSystemPrompt(full), buildDraftUserPrompt(full), signal);
  const drafts = parseDrafts(raw, count);
  if (drafts.length === 0) throw new Error("Couldn't draft anything — try again.");
  return drafts;
};
