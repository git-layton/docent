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

  // New Space wizard (name + goal + invite)
  showNewSpace: boolean;

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

  // Boot
  isDbLoaded: boolean;

  // OS navigation
  activeOmniTabId: string | null;
  isCommandNodeExpanded: boolean;
  commandNodeWidth: number;
  // Split view: a second tab shown beside the active one (resizable)
  splitTabId: string | null;
  splitRatio: number;       // primary pane width fraction (0.2–0.8)

  // Actions
  setIsSidebarOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsAgentDropdownOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsModelDropdownOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowConsole: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowNewSpace: (v: boolean) => void;
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
  setActiveOmniTabId: (id: string | null) => void;
  setIsCommandNodeExpanded: (v: boolean) => void;
  setCommandNodeWidth: (v: number) => void;
  setSplitTabId: (id: string | null) => void;
  setSplitRatio: (v: number) => void;

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
  showNewSpace: false,
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
  ramStats: null,
  hwProfile: null,
  isDbLoaded: false,
  activeOmniTabId: null,
  isCommandNodeExpanded: true,
  commandNodeWidth: 720,
  splitTabId: null,
  splitRatio: 0.5,

  setIsSidebarOpen: (v) =>
    set(s => ({ isSidebarOpen: typeof v === 'function' ? v(s.isSidebarOpen) : v })),
  setIsAgentDropdownOpen: (v) =>
    set(s => ({ isAgentDropdownOpen: typeof v === 'function' ? v(s.isAgentDropdownOpen) : v })),
  setIsModelDropdownOpen: (v) =>
    set(s => ({ isModelDropdownOpen: typeof v === 'function' ? v(s.isModelDropdownOpen) : v })),
  setShowConsole: (v) =>
    set(s => ({ showConsole: typeof v === 'function' ? v(s.showConsole) : v })),
  setShowNewSpace: (v) => set({ showNewSpace: v }),
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
  setActiveOmniTabId: (id) => set({ activeOmniTabId: id }),
  setIsCommandNodeExpanded: (v) => set({ isCommandNodeExpanded: v }),
  setCommandNodeWidth: (v) => set({ commandNodeWidth: v }),
  setSplitTabId: (id) => set({ splitTabId: id }),
  setSplitRatio: (v) => set({ splitRatio: Math.max(0.2, Math.min(0.8, v)) }),

  hydrateSavedApps: async () => {
    const savedApps = await db.get('savedApps', []);
    set({ savedApps });
  },

  persistSavedApps: async () => {
    const { savedApps } = get();
    await db.set('savedApps', savedApps);
  },
}));
