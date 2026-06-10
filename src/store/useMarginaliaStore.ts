import { create } from 'zustand';
import { db } from '../services/database';

const generateId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export type AnnotationStatus = 'open' | 'accepted' | 'dismissed';

export interface AnnotationAnchor {
  kind: 'text' | 'line';
  start: number;
  end: number;
}

export interface Annotation {
  id: string;
  tabId: string;
  agentId: string;
  color: string;
  anchor: AnnotationAnchor;
  body: string;
  suggestedText?: string;
  status: AnnotationStatus;
  createdAt: number;
}

// Accent colors per agent, in the OS dark palette.
const AGENT_COLORS: Record<string, string> = {
  dev: '#6AA9FF',
  alexis: '#E59FC4',
  lexi: '#E59FC4',
  aria: '#7A9E8D',
};

const DEFAULT_AGENT_COLOR = '#8A8F98';

/**
 * Map a known agent id to its accent color. Unknown agents fall back to a
 * neutral gray. Lookup is case-insensitive.
 */
export function getAgentColor(agentId: string): string {
  if (!agentId) return DEFAULT_AGENT_COLOR;
  return AGENT_COLORS[agentId.toLowerCase()] ?? DEFAULT_AGENT_COLOR;
}

interface MarginaliaStore {
  annotations: Annotation[];
  agentVisionOn: boolean;

  addAnnotation: (
    a: Omit<Annotation, 'id' | 'status' | 'createdAt' | 'color'> & {
      color?: string;
      status?: AnnotationStatus;
    },
  ) => Annotation;
  updateAnnotationStatus: (id: string, status: AnnotationStatus) => void;
  removeAnnotation: (id: string) => void;
  setAgentVisionOn: (on: boolean) => void;
  annotationsForTab: (tabId: string) => Annotation[];

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useMarginaliaStore = create<MarginaliaStore>((set, get) => ({
  annotations: [],
  agentVisionOn: true,

  addAnnotation: (a) => {
    const annotation: Annotation = {
      id: generateId('ann'),
      status: a.status ?? 'open',
      createdAt: Date.now(),
      color: a.color ?? getAgentColor(a.agentId),
      tabId: a.tabId,
      agentId: a.agentId,
      anchor: a.anchor,
      body: a.body,
      suggestedText: a.suggestedText,
    };
    set(s => ({ annotations: [...s.annotations, annotation] }));
    get().persist();
    return annotation;
  },

  updateAnnotationStatus: (id, status) => {
    set(s => ({
      annotations: s.annotations.map(ann =>
        ann.id === id ? { ...ann, status } : ann,
      ),
    }));
    get().persist();
  },

  removeAnnotation: (id) => {
    set(s => ({ annotations: s.annotations.filter(ann => ann.id !== id) }));
    get().persist();
  },

  setAgentVisionOn: (on) => {
    set({ agentVisionOn: on });
    db.set('agentVisionOn', on);
  },

  annotationsForTab: (tabId) =>
    get().annotations.filter(ann => ann.tabId === tabId),

  hydrate: async () => {
    const annotations = await db.get('annotations', []);
    const agentVisionOn = await db.get('agentVisionOn', true);
    set({ annotations, agentVisionOn });
  },

  persist: async () => {
    const { annotations } = get();
    await db.set('annotations', annotations);
  },
}));
