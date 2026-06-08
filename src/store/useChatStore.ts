import { create } from 'zustand';
import { db } from '../services/database';

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
          folderId: 'alexis',
          primaryAgentId: 'alexis',
          participantAgentIds: ['alexis'],
          kind: 'dm',
          name: 'Recovered Chat',
          goal: '',
          createdAt,
          updatedAt,
        };
      });

    const chats = [...storedChats, ...recoveredChats];
    const validActiveId = storedActiveChatId && chats.some((chat: any) => chat.id === storedActiveChatId)
      ? storedActiveChatId
      : [...chats].sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]?.id ?? null;

    set({ chats, messages: storedMessages, activeChatId: validActiveId });
  },

  persist: async () => {
    const { chats, messages, activeChatId } = get();
    await db.set('chats', chats);
    await db.set('messages', messages);
    await db.set('activeChatId', activeChatId);
  },
}));
