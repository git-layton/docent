import { create } from 'zustand';
import { db } from '../services/database';
import type { DreamLog } from '../components/DreamDigestModal';

interface GlobalPin {
  id: string;
  chatId: string;
  msgId: string;
  agentId: string;
  spaceId?: string;
  content: string;
  savedAt: number;
}

interface MemoryStore {
  globalPins: GlobalPin[];
  dreamLog: DreamLog | null;
  showDreamBanner: boolean;
  showDreamDigest: boolean;
  isDreamRunning: boolean;
  /** One-time invite to run a first Dream Cycle, shown once memory is worth consolidating. */
  showFirstDreamPrompt: boolean;
  firstDreamFileCount: number;
  /** First-run consent gate: shown before the very first Dream Cycle ever runs, so the user
   *  understands what it does and its cost before any tokens are spent. */
  showDreamConsent: boolean;
  agentForgePath: string;
  showMemmoPanel: boolean;
  memmoPanelTab: 'inbox' | 'pins' | 'notes' | 'library' | 'archive' | 'weblog';
  showMemoCompose: boolean;

  setGlobalPins: (pins: GlobalPin[]) => void;
  saveGlobalPins: (pins: GlobalPin[]) => Promise<void>;
  setDreamLog: (log: DreamLog | null) => void;
  setShowDreamBanner: (v: boolean) => void;
  setShowDreamDigest: (v: boolean) => void;
  setIsDreamRunning: (v: boolean) => void;
  setFirstDreamPrompt: (show: boolean, fileCount?: number) => void;
  setShowDreamConsent: (v: boolean) => void;
  setAgentForgePath: (path: string) => void;
  setShowMemmoPanel: (v: boolean | ((prev: boolean) => boolean)) => void;
  setMemmoPanelTab: (tab: 'inbox' | 'pins' | 'notes' | 'library' | 'archive' | 'weblog') => void;
  setShowMemoCompose: (v: boolean) => void;

  hydrate: () => Promise<void>;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  globalPins: [],
  dreamLog: null,
  showDreamBanner: false,
  showDreamDigest: false,
  isDreamRunning: false,
  showFirstDreamPrompt: false,
  firstDreamFileCount: 0,
  showDreamConsent: false,
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
  setFirstDreamPrompt: (show, fileCount) =>
    set(s => ({ showFirstDreamPrompt: show, firstDreamFileCount: fileCount ?? s.firstDreamFileCount })),
  setShowDreamConsent: (v) => set({ showDreamConsent: v }),
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
