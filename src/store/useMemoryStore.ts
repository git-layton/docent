import { create } from 'zustand';
import { db } from '../services/database';
import type { DreamLog } from '../components/DreamDigestModal';

interface GlobalPin {
  id: string;
  chatId: string;
  msgId: string;
  agentId: string;
  content: string;
  savedAt: number;
}

interface MemoryStore {
  globalPins: GlobalPin[];
  dreamLog: DreamLog | null;
  showDreamBanner: boolean;
  showDreamDigest: boolean;
  isDreamRunning: boolean;
  agentForgePath: string;
  showMemmoPanel: boolean;
  memmoPanelTab: 'pins' | 'memos' | 'library' | 'archive';
  showMemoCompose: boolean;

  setGlobalPins: (pins: GlobalPin[]) => void;
  saveGlobalPins: (pins: GlobalPin[]) => Promise<void>;
  setDreamLog: (log: DreamLog | null) => void;
  setShowDreamBanner: (v: boolean) => void;
  setShowDreamDigest: (v: boolean) => void;
  setIsDreamRunning: (v: boolean) => void;
  setAgentForgePath: (path: string) => void;
  setShowMemmoPanel: (v: boolean | ((prev: boolean) => boolean)) => void;
  setMemmoPanelTab: (tab: 'pins' | 'memos' | 'library' | 'archive') => void;
  setShowMemoCompose: (v: boolean) => void;

  hydrate: () => Promise<void>;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  globalPins: [],
  dreamLog: null,
  showDreamBanner: false,
  showDreamDigest: false,
  isDreamRunning: false,
  agentForgePath: '',
  showMemmoPanel: false,
  memmoPanelTab: 'library',
  showMemoCompose: false,

  setGlobalPins: (pins) => set({ globalPins: pins }),
  saveGlobalPins: async (pins) => {
    set({ globalPins: pins });
    await db.set('globalPins', pins);
  },
  setDreamLog: (log) => set({ dreamLog: log }),
  setShowDreamBanner: (v) => set({ showDreamBanner: v }),
  setShowDreamDigest: (v) => set({ showDreamDigest: v }),
  setIsDreamRunning: (v) => set({ isDreamRunning: v }),
  setAgentForgePath: (path) => set({ agentForgePath: path }),
  setShowMemmoPanel: (v) =>
    set(s => ({ showMemmoPanel: typeof v === 'function' ? v(s.showMemmoPanel) : v })),
  setMemmoPanelTab: (tab) => set({ memmoPanelTab: tab }),
  setShowMemoCompose: (v) => set({ showMemoCompose: v }),

  hydrate: async () => {
    const globalPins = await db.get('globalPins', []);
    set({ globalPins });
  },
}));
