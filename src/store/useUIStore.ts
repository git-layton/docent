import { create } from 'zustand';
import { db } from '../services/database';

interface UIStore {
  // Layout
  isSidebarOpen: boolean;
  isAgentDropdownOpen: boolean;
  isModelDropdownOpen: boolean;

  // Debug console
  showConsole: boolean;
  logs: any[];

  // Toast notifications
  toastMessage: string | null;
  toastAction: { label: string; onClick: () => void } | null;

  // Chat input
  input: string;
  attachedDocs: any[];
  generationMode: string;
  isDeepThinking: boolean;
  forcedTool: string | null;
  isPlanMode: boolean;
  pinnedTools: string[];
  isDragging: boolean;
  uploadError: string;
  slashHighlight: number;

  // Canvas & archive
  canvasContent: any;
  canvasTab: string;
  viewMode: string;
  archiveSubView: string;
  archiveSearchQuery: string;
  savedApps: any[];
  showSaveModal: boolean;
  saveAppData: { title: string };

  // System hardware
  ramStats: { total_mb: number; used_mb: number; available_mb: number } | null;
  hwProfile: {
    critical_mb: number;
    cooldown_mb: number;
    recovery_mb: number;
    hud_show_mb: number;
    hud_warn_mb: number;
    rag_results: number;
    rag_snippet_chars: number;
  } | null;

  // Browser panel (co-pilot, opens alongside chat)
  browserOpen: boolean;
  setBrowserOpen: (v: boolean | ((prev: boolean) => boolean)) => void;

  // Boot
  isDbLoaded: boolean;

  // Actions
  setIsSidebarOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsAgentDropdownOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsModelDropdownOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowConsole: (v: boolean | ((prev: boolean) => boolean)) => void;
  addLog: (level: string, msg: string) => void;
  clearLogs: () => void;
  showToast: (msg: string, action?: { label: string; onClick: () => void }) => void;
  clearToast: () => void;
  setInput: (v: string) => void;
  setAttachedDocs: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setGenerationMode: (v: string) => void;
  setIsDeepThinking: (v: boolean | ((prev: boolean) => boolean)) => void;
  setForcedTool: (v: string | null | ((prev: string | null) => string | null)) => void;
  setIsPlanMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  setPinnedTools: (v: string[] | ((prev: string[]) => string[])) => void;
  setIsDragging: (v: boolean) => void;
  setUploadError: (v: string) => void;
  setSlashHighlight: (v: number | ((prev: number) => number)) => void;
  setCanvasContent: (v: any | ((prev: any) => any)) => void;
  setCanvasTab: (v: string) => void;
  setViewMode: (v: string) => void;
  setArchiveSubView: (v: string) => void;
  setArchiveSearchQuery: (v: string) => void;
  setSavedApps: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setShowSaveModal: (v: boolean) => void;
  setSaveAppData: (v: { title: string }) => void;
  setRamStats: (v: { total_mb: number; used_mb: number; available_mb: number } | null) => void;
  setHwProfile: (v: any) => void;
  setIsDbLoaded: (v: boolean) => void;

  // savedApps persistence
  hydrateSavedApps: () => Promise<void>;
  persistSavedApps: () => Promise<void>;
}

export const useUIStore = create<UIStore>((set, get) => ({
  isSidebarOpen: true,
  isAgentDropdownOpen: false,
  isModelDropdownOpen: false,
  showConsole: false,
  logs: [],
  toastMessage: null,
  toastAction: null,
  input: '',
  attachedDocs: [],
  generationMode: 'text',
  isDeepThinking: false,
  forcedTool: null,
  isPlanMode: false,
  pinnedTools: ['web_search', 'local_workspace'],
  isDragging: false,
  uploadError: '',
  slashHighlight: 0,
  canvasContent: null,
  canvasTab: 'preview',
  viewMode: 'chat',
  archiveSubView: 'code',
  archiveSearchQuery: '',
  savedApps: [],
  showSaveModal: false,
  saveAppData: { title: '' },
  browserOpen: false,
  ramStats: null,
  hwProfile: null,
  isDbLoaded: false,

  setIsSidebarOpen: (v) =>
    set(s => ({ isSidebarOpen: typeof v === 'function' ? v(s.isSidebarOpen) : v })),
  setIsAgentDropdownOpen: (v) =>
    set(s => ({ isAgentDropdownOpen: typeof v === 'function' ? v(s.isAgentDropdownOpen) : v })),
  setIsModelDropdownOpen: (v) =>
    set(s => ({ isModelDropdownOpen: typeof v === 'function' ? v(s.isModelDropdownOpen) : v })),
  setShowConsole: (v) =>
    set(s => ({ showConsole: typeof v === 'function' ? v(s.showConsole) : v })),
  addLog: (level, msg) =>
    set(s => ({ logs: [...s.logs.slice(-499), { time: new Date().toLocaleTimeString([], { hour12: false }), level, msg }] })),
  clearLogs: () => set({ logs: [] }),
  showToast: (msg, action) => {
    set({ toastMessage: msg, toastAction: action ?? null });
    setTimeout(() => set({ toastMessage: null, toastAction: null }), 4000);
  },
  clearToast: () => set({ toastMessage: null, toastAction: null }),
  setInput: (v) => set({ input: v }),
  setAttachedDocs: (fn) =>
    set(s => ({ attachedDocs: typeof fn === 'function' ? fn(s.attachedDocs) : fn })),
  setGenerationMode: (v) => set({ generationMode: v }),
  setIsDeepThinking: (v) =>
    set(s => ({ isDeepThinking: typeof v === 'function' ? v(s.isDeepThinking) : v })),
  setForcedTool: (v) =>
    set(s => ({ forcedTool: typeof v === 'function' ? v(s.forcedTool) : v })),
  setIsPlanMode: (v) =>
    set(s => ({ isPlanMode: typeof v === 'function' ? v(s.isPlanMode) : v })),
  setPinnedTools: (v) =>
    set(s => ({ pinnedTools: typeof v === 'function' ? v(s.pinnedTools) : v })),
  setIsDragging: (v) => set({ isDragging: v }),
  setUploadError: (v) => set({ uploadError: v }),
  setSlashHighlight: (v) =>
    set(s => ({ slashHighlight: typeof v === 'function' ? v(s.slashHighlight) : v })),
  setCanvasContent: (v) =>
    set(s => ({ canvasContent: typeof v === 'function' ? v(s.canvasContent) : v })),
  setCanvasTab: (v) => set({ canvasTab: v }),
  setBrowserOpen: (v) =>
    set(s => ({ browserOpen: typeof v === 'function' ? v(s.browserOpen) : v })),
  setViewMode: (v) => set({ viewMode: v }),
  setArchiveSubView: (v) => set({ archiveSubView: v }),
  setArchiveSearchQuery: (v) => set({ archiveSearchQuery: v }),
  setSavedApps: (fn) =>
    set(s => ({ savedApps: typeof fn === 'function' ? fn(s.savedApps) : fn })),
  setShowSaveModal: (v) => set({ showSaveModal: v }),
  setSaveAppData: (v) => set({ saveAppData: v }),
  setRamStats: (v) => set({ ramStats: v }),
  setHwProfile: (v) => set({ hwProfile: v }),
  setIsDbLoaded: (v) => set({ isDbLoaded: v }),

  hydrateSavedApps: async () => {
    const savedApps = await db.get('savedApps', []);
    set({ savedApps });
  },

  persistSavedApps: async () => {
    const { savedApps } = get();
    await db.set('savedApps', savedApps);
  },
}));
