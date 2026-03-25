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
    const chats = await db.get('chats', []);
    const messages = await db.get('messages', {});
    set({ chats, messages });
  },

  persist: async () => {
    const { chats, messages } = get();
    await db.set('chats', chats);
    await db.set('messages', messages);
  },
}));
