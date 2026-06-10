import { create } from 'zustand';
import { db } from '../services/database';

// ---------------------------------------------------------------------------
// Ghost UI / Marginalia — AI annotations on doc/code-canvas tabs. An "Agent
// Vision" toggle reveals color-coded comment cards; each can carry a suggested
// rewrite that the user applies with one click (handled by MarginaliaLayer).
// v1 is scoped to our own canvas — NOT the native browser webview.
// ---------------------------------------------------------------------------

export type AnnotationStatus = 'open' | 'accepted' | 'dismissed';

export interface Annotation {
  id: string;
  tabId: string;                    // doc/canvas tab this anchors to
  agentId: string;                  // authoring agent
  color: string;                    // per-agent accent (e.g. Dev=blue, Alexis=pink, Aria=green)
  anchor: { kind: 'text' | 'line'; start: number; end: number };
  body: string;                     // the comment
  suggestedText?: string;           // optional inline replacement → enables "Apply Fix"
  status: AnnotationStatus;
  createdAt: number;
}

const genId = () => `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

interface MarginaliaStore {
  annotations: Annotation[];
  agentVisionOn: boolean;
  addAnnotation(a: Omit<Annotation, 'id' | 'createdAt'>): string;
  updateAnnotationStatus(id: string, status: AnnotationStatus): void;
  removeAnnotation(id: string): void;
  setAgentVisionOn(v: boolean): void;
  annotationsForTab(tabId: string): Annotation[];
  hydrate(): Promise<void>;
  persist(): Promise<void>;
}

export const useMarginaliaStore = create<MarginaliaStore>((set, get) => ({
  annotations: [],
  agentVisionOn: false,

  addAnnotation: (a) => {
    const id = genId();
    set(s => ({ annotations: [...s.annotations, { ...a, id, createdAt: Date.now() }] }));
    get().persist();
    return id;
  },

  updateAnnotationStatus: (id, status) => {
    set(s => ({ annotations: s.annotations.map(an => (an.id === id ? { ...an, status } : an)) }));
    get().persist();
  },

  removeAnnotation: (id) => {
    set(s => ({ annotations: s.annotations.filter(an => an.id !== id) }));
    get().persist();
  },

  setAgentVisionOn: (v) => set({ agentVisionOn: v }),

  annotationsForTab: (tabId) => get().annotations.filter(an => an.tabId === tabId && an.status === 'open'),

  hydrate: async () => {
    const saved = await db.get('marginaliaAnnotations', null);
    if (saved !== null) set({ annotations: saved as Annotation[] });
  },

  persist: async () => {
    await db.set('marginaliaAnnotations', get().annotations);
  },
}));
