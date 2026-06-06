import { create } from 'zustand';
import { db } from '../services/database';

export interface Channel {
  id: string;
  name: string;
  enrolledAgentIds: string[];  // ordered: [primary, ...others]
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
}

interface ChatStore {
  chats: any[];
  channels: Channel[];
  messages: Record<string, any[]>;
  activeChatId: string | null;
  editingChatId: string | null;
  editingChatName: string;
  editingMessageId: string | null;
  editingMessageContent: string;
  speakingId: string | null;
  chatSearchQuery: string;

  setChats: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setChannels: (fn: ((prev: Channel[]) => Channel[]) | Channel[]) => void;
  addEnrolledAgent: (channelId: string, agentId: string) => void;
  removeEnrolledAgent: (channelId: string, agentId: string) => void;
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
  channels: [],
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
  setChannels: (fn) =>
    set(s => ({ channels: typeof fn === 'function' ? fn(s.channels) : fn })),
  addEnrolledAgent: (channelId, agentId) =>
    set(s => ({
      channels: s.channels.map(ch =>
        ch.id === channelId && !ch.enrolledAgentIds.includes(agentId)
          ? { ...ch, enrolledAgentIds: [...ch.enrolledAgentIds, agentId], updatedAt: Date.now() }
          : ch
      ),
    })),
  removeEnrolledAgent: (channelId, agentId) =>
    set(s => ({
      channels: s.channels.map(ch =>
        ch.id === channelId
          ? { ...ch, enrolledAgentIds: ch.enrolledAgentIds.filter(id => id !== agentId), updatedAt: Date.now() }
          : ch
      ),
    })),
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
    const channels = await db.get('channels', []);
    const messages = await db.get('messages', {});
    set({ chats, channels, messages });
  },

  persist: async () => {
    const { chats, channels, messages } = get();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const activeChats = chats.filter(chat => {
      const msgs = messages[chat.id] ?? [];
      const last = msgs[msgs.length - 1];
      const ts = chat.updatedAt ?? last?.timestamp ?? last?.createdAt ?? Infinity;
      return typeof ts === 'number' ? ts > cutoff : true;
    });
    const prunedMessages: Record<string, any[]> = {};
    for (const chat of activeChats) {
      prunedMessages[chat.id] = (messages[chat.id] ?? []).slice(-200);
    }
    await db.set('chats', activeChats);
    await db.set('channels', channels);
    await db.set('messages', prunedMessages);
  },
}));
