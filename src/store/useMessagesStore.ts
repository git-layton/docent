import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

// Shared iMessage state. We use a local "watermark" system to track read state, decoupling from
// macOS's chat.db which overwrites our mutations and suffers from iCloud sync "ghost unread" flooding.
interface MessagesStore {
  watermarks: Record<string, number>; // chatId -> max message ID seen
  unreadChats: number;
  markChatRead: (chatId: string, maxMessageId: number) => void;
  refreshUnread: () => Promise<void>;
}

export const useMessagesStore = create<MessagesStore>()(
  persist(
    (set, get) => ({
      watermarks: {},
      unreadChats: 0,
      markChatRead: (chatId, maxMessageId) => {
        set((state) => {
          const current = state.watermarks[chatId] || 0;
          if (maxMessageId <= current) return state;
          return { watermarks: { ...state.watermarks, [chatId]: maxMessageId } };
        });
      },
      refreshUnread: async () => {
        try {
          const chats = await invoke<any[]>('imessage_list_chats', { limit: 50 });
          const { watermarks } = get();
          let unread = 0;
          for (const chat of chats) {
            // A chat is unread if it has an incoming message newer than our watermark.
            // If we've never seen the chat, we mark it as unread ONLY if the last message is incoming.
            const wm = watermarks[chat.chatId.toString()] || 0;
            if (!chat.lastFromMe && chat.latestMsgId > wm) {
              unread++;
            }
          }
          set({ unreadChats: unread });
        } catch {
          // No Full Disk Access, or not on macOS
          set({ unreadChats: 0 });
        }
      },
    }),
    {
      name: 'docent-imessage-watermarks',
      partialize: (state) => ({ watermarks: state.watermarks }),
    }
  )
);

