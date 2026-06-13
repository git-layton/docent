import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

// Shared, lightweight iMessage state. Right now just the unread-message count that drives the
// Home card subtitle and the tab's activity bubble. One poller (in OmniTabBar) keeps it fresh so
// every consumer reads the same number instead of querying chat.db independently.
interface MessagesStore {
  unread: number;
  refreshUnread: () => Promise<void>;
}

export const useMessagesStore = create<MessagesStore>((set) => ({
  unread: 0,
  refreshUnread: async () => {
    try {
      const n = await invoke<number>('imessage_unread_count');
      set({ unread: n });
    } catch {
      // No Full Disk Access, or not on macOS — show nothing rather than an error.
      set({ unread: 0 });
    }
  },
}));
