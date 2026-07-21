import { create } from 'zustand';
import { emit } from '@tauri-apps/api/event';
import { db } from '../services/database';
import { repointRetiredAgentRefs } from './useAgentStore';

interface ChatStore {
  chats: any[];
  messages: Record<string, any[]>;
  activeChatId: string | null;
  editingChatId: string | null;
  editingChatName: string;
  editingMessageId: string | null;
  editingMessageContent: string;
  speakingId: string | null;
  chatSearchQuery: string;

  setChats: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setMessages: (fn: ((prev: Record<string, any[]>) => Record<string, any[]>) | Record<string, any[]>) => void;
  setActiveChatId: (id: string | null) => void;
  setEditingChatId: (id: string | null) => void;
  setEditingChatName: (name: string) => void;
  setEditingMessageId: (id: string | null) => void;
  setEditingMessageContent: (content: string) => void;
  setSpeakingId: (id: string | null) => void;
  setChatSearchQuery: (q: string) => void;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  messages: {},
  activeChatId: null,
  editingChatId: null,
  editingChatName: '',
  editingMessageId: null,
  editingMessageContent: '',
  speakingId: null,
  chatSearchQuery: '',

  setChats: (fn) =>
    set(s => ({ chats: typeof fn === 'function' ? fn(s.chats) : fn })),
  setMessages: (fn) =>
    set(s => ({ messages: typeof fn === 'function' ? fn(s.messages) : fn })),
  setActiveChatId: (id) => set({ activeChatId: id }),
  setEditingChatId: (id) => set({ editingChatId: id }),
  setEditingChatName: (name) => set({ editingChatName: name }),
  setEditingMessageId: (id) => set({ editingMessageId: id }),
  setEditingMessageContent: (content) => set({ editingMessageContent: content }),
  setSpeakingId: (id) => set({ speakingId: id }),
  setChatSearchQuery: (q) => set({ chatSearchQuery: q }),

  hydrate: async () => {
    const storedChats = await db.get('chats', []);
    const storedMessages = await db.get('messages', {});
    const storedActiveChatId = await db.get('activeChatId', null);

    const chatIds = new Set(storedChats.map((chat: any) => chat.id));
    const recoveredChats = Object.keys(storedMessages)
      .filter(chatId => !chatIds.has(chatId) && Array.isArray(storedMessages[chatId]))
      .map(chatId => {
        const msgs = storedMessages[chatId] ?? [];
        const first = msgs[0];
        const last = msgs[msgs.length - 1];
        const createdAt = first?.timestamp ?? first?.createdAt ?? Date.now();
        const updatedAt = last?.timestamp ?? last?.createdAt ?? createdAt;
        return {
          id: chatId,
          folderId: 'docent',
          primaryAgentId: 'docent',
          participantAgentIds: ['docent'],
          kind: 'dm',
          name: 'Recovered Chat',
          goal: '',
          createdAt,
          updatedAt,
        };
      });

    // One-assistant merge: threads that belonged to a retired agent (Codey, Forge Guide) become
    // Docent's. Messages are untouched — only the agent references move.
    const chats = [...storedChats, ...recoveredChats].map(repointRetiredAgentRefs);
    const validActiveId = storedActiveChatId && chats.some((chat: any) => chat.id === storedActiveChatId)
      ? storedActiveChatId
      : [...chats].sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]?.id ?? null;

    set({ chats, messages: storedMessages, activeChatId: validActiveId });
  },

  persist: async () => {
    const { chats, messages, activeChatId } = get();
    // Merge with disk before writing so this window can't clobber chats/messages the OVERLAY
    // persisted since we last hydrated (both windows share these keys). Union chats by id (newer
    // updatedAt wins); per shared chat keep the longer message list — both surfaces only append.
    const [diskChats, diskMessages] = await Promise.all([
      db.get('chats', []) as Promise<any[]>,
      db.get('messages', {}) as Promise<Record<string, any[]>>,
    ]);
    const byId = new Map<string, any>();
    for (const c of diskChats) byId.set(c.id, c);
    for (const c of chats) {
      const prev = byId.get(c.id);
      byId.set(c.id, !prev || (c.updatedAt ?? 0) >= (prev.updatedAt ?? 0) ? c : prev);
    }
    const mergedMessages: Record<string, any[]> = { ...diskMessages };
    for (const [id, msgs] of Object.entries(messages)) {
      const prev = mergedMessages[id];
      mergedMessages[id] = !prev || (msgs?.length ?? 0) >= prev.length ? msgs : prev;
    }
    await db.set('chats', Array.from(byId.values()));
    await db.set('messages', mergedMessages);
    await db.set('activeChatId', activeChatId);
    // Let the overlay reload (mirror of the overlay's 'spotlight-chat-updated' → main hydrate).
    emit('main-chat-updated', null).catch(() => {});
  },
}));
