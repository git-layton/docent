// Topic-shift detection — notices when a conversation's subject jumps so the UI can offer a fresh
// thread (short focused contexts + shared memory beat one endless scroll; see "lost in the middle"
// / context-rot findings). Cheap by construction: one on-device MiniLM embedding per user message
// (Rust `embed_text`), compared against a rolling per-chat centroid. No LLM calls, no network.
//
// The pure math lives here (unit-tested); the per-chat state and the nudge UI live in the caller.

import { invoke } from '@tauri-apps/api/core';

export interface TopicState {
  centroid: number[];
  /** messages folded into the centroid so far */
  n: number;
}

/** Messages shorter than this are skipped entirely — "ok", "yes", "lol" embed as noise. */
export const MIN_MESSAGE_CHARS = 25;
/** Don't suggest until the topic has this many substantive messages — a young chat has no topic yet. */
export const MIN_MESSAGES_FOR_SHIFT = 3;
/** Cosine vs. centroid below this = new topic. MiniLM same-topic pairs sit ~0.5-0.9; unrelated ~0-0.3. */
export const SHIFT_THRESHOLD = 0.35;
/** EMA weight of the newest message — recent turns dominate, so the topic can drift naturally. */
export const CENTROID_ALPHA = 0.3;

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** Fold a new message vector into the rolling centroid (EMA; first message becomes the centroid). */
export function updateCentroid(state: TopicState | null, v: number[]): TopicState {
  if (!state || !state.centroid.length) return { centroid: [...v], n: 1 };
  const c = state.centroid.map((x, i) => (1 - CENTROID_ALPHA) * x + CENTROID_ALPHA * (v[i] ?? 0));
  return { centroid: c, n: state.n + 1 };
}

/** PURE decision: does this message look like a different topic than the chat so far? */
export function isTopicShift(state: TopicState | null, v: number[]): boolean {
  if (!state || state.n < MIN_MESSAGES_FOR_SHIFT) return false;
  return cosine(state.centroid, v) < SHIFT_THRESHOLD;
}

/**
 * Stateful tracker over the pure parts. `observe` returns true when the message reads as a topic
 * shift; it does NOT fold a shifting message into the centroid (the user may accept the nudge and
 * move it to a new thread) — call `commit` when they decline so the topic absorbs the new subject.
 */
export function createTopicTracker() {
  const byChat = new Map<string, TopicState>();
  let pending: { chatId: string; v: number[] } | null = null;

  return {
    async observe(chatId: string, text: string): Promise<boolean> {
      const t = (text || '').trim();
      if (t.length < MIN_MESSAGE_CHARS) return false;
      let v: number[];
      try {
        v = await invoke<number[]>('embed_text', { text: t.slice(0, 2000) });
      } catch { return false; } // embedder still warming up — never block or break the send path
      const state = byChat.get(chatId) ?? null;
      if (isTopicShift(state, v)) {
        pending = { chatId, v };
        return true;
      }
      byChat.set(chatId, updateCentroid(state, v));
      return false;
    },
    /** User declined the nudge — the "shift" is the topic now; fold it in. */
    commit(chatId: string) {
      if (pending?.chatId === chatId) {
        byChat.set(chatId, updateCentroid(byChat.get(chatId) ?? null, pending.v));
        pending = null;
      }
    },
    /** User accepted a new thread — seed it with the message that triggered the nudge. */
    moveToChat(newChatId: string) {
      if (pending) {
        byChat.set(newChatId, updateCentroid(null, pending.v));
        pending = null;
      }
    },
    reset(chatId: string) { byChat.delete(chatId); },
  };
}
