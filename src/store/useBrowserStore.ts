import { create } from 'zustand';

export interface VisitLogEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  wasDigested: boolean;
  isPrivate: boolean;
}

interface BrowserStore {
  visitLog: VisitLogEntry[];
  clearVisitLog: () => void;
}

export const useBrowserStore = create<BrowserStore>(() => ({
  visitLog: [],
  clearVisitLog: () => {},
}));
