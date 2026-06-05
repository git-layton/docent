import { create } from 'zustand';
import { db } from '../services/database';

interface SettingsStore {
  // Model management
  models: any[];
  selectedModelId: string;
  modelValidation: Record<string, string>;

  // User profile & integrations
  userProfile: string;
  integrations: any;
  appSettings: {
    allowProfileUpdates: boolean;
    forgeInstanceId: string;
    relayUrl: string;
    relayAdminToken: string;
    people: Array<{ id: string; label: string; role?: string }>;
    inboxOwners: Array<{ id: string; label: string }>;
  };

  // Profile settings modal
  profileSettingsTab: string;
  showProfileSettings: boolean;

  // Model wizard
  showModelWizard: boolean;
  wizardStep: number;
  editingModel: {
    name: string;
    provider: string;
    modelId: string;
    endpoint: string;
    apiKey: string;
    contextLimit: number;
  };
  fetchedModels: Array<{ id: string; context: number }>;
  modelSearchQuery: string;
  isFetchingModels: boolean;
  fetchModelsError: string | null;
  pendingModelSelections: Array<{ id: string; context: number }>;

  // Actions
  setModels: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setSelectedModelId: (id: string) => void;
  setModelValidation: (fn: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) => void;
  setUserProfile: (v: string) => void;
  setIntegrations: (fn: ((prev: any) => any) | any) => void;
  setAppSettings: (fn: ((prev: any) => any) | any) => void;
  setProfileSettingsTab: (tab: string) => void;
  setShowProfileSettings: (v: boolean) => void;
  setShowModelWizard: (v: boolean) => void;
  setWizardStep: (step: number) => void;
  setEditingModel: (fn: ((prev: any) => any) | any) => void;
  setFetchedModels: (v: Array<{ id: string; context: number }>) => void;
  setModelSearchQuery: (q: string) => void;
  setIsFetchingModels: (v: boolean) => void;
  setFetchModelsError: (e: string | null) => void;
  setPendingModelSelections: (fn: ((prev: any[]) => any[]) | any[]) => void;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  models: [],
  selectedModelId: '',
  modelValidation: {},
  userProfile: '',
  integrations: {
    tavily: { enabled: false, apiKey: '' },
    brave: { enabled: false, apiKey: '' },
    slack: { enabled: false, botToken: '' },
    googleWorkspaces: [],
    gus: { enabled: false, instanceUrl: '', accessToken: '' },
    googleCalendar: { connected: false },
    openai: { apiKey: '' },
    google: { apiKey: '' },
  },
  appSettings: {
    allowProfileUpdates: true,
    forgeInstanceId: 'agent-forge-local',
    relayUrl: '',
    relayAdminToken: '',
    people: [],
    inboxOwners: [
      { id: 'primary', label: 'Primary' },
      { id: 'shared', label: 'Shared' },
    ],
  },
  profileSettingsTab: 'profile',
  showProfileSettings: false,
  showModelWizard: false,
  wizardStep: 3,
  editingModel: { name: '', provider: 'openai', modelId: '', endpoint: '', apiKey: '', contextLimit: 128000 },
  fetchedModels: [],
  modelSearchQuery: '',
  isFetchingModels: false,
  fetchModelsError: null,
  pendingModelSelections: [],

  setModels: (fn) =>
    set(s => ({ models: typeof fn === 'function' ? fn(s.models) : fn })),
  setSelectedModelId: (id) => set({ selectedModelId: id }),
  setModelValidation: (fn) =>
    set(s => ({ modelValidation: typeof fn === 'function' ? fn(s.modelValidation) : fn })),
  setUserProfile: (v) => set({ userProfile: v }),
  setIntegrations: (fn) =>
    set(s => ({ integrations: typeof fn === 'function' ? fn(s.integrations) : fn })),
  setAppSettings: (fn) =>
    set(s => ({ appSettings: typeof fn === 'function' ? fn(s.appSettings) : fn })),
  setProfileSettingsTab: (tab) => set({ profileSettingsTab: tab }),
  setShowProfileSettings: (v) => set({ showProfileSettings: v }),
  setShowModelWizard: (v) => set({ showModelWizard: v }),
  setWizardStep: (step) => set({ wizardStep: step }),
  setEditingModel: (fn) =>
    set(s => ({ editingModel: typeof fn === 'function' ? fn(s.editingModel) : fn })),
  setFetchedModels: (v) => set({ fetchedModels: v }),
  setModelSearchQuery: (q) => set({ modelSearchQuery: q }),
  setIsFetchingModels: (v) => set({ isFetchingModels: v }),
  setFetchModelsError: (e) => set({ fetchModelsError: e }),
  setPendingModelSelections: (fn) =>
    set(s => ({ pendingModelSelections: typeof fn === 'function' ? fn(s.pendingModelSelections) : fn })),

  hydrate: async () => {
    const models = await db.get('models', []);
    const userProfile = await db.get('userProfile', '');
    const savedIntegrations = await db.get('integrations', {});
    if (savedIntegrations.googleWorkspace && !savedIntegrations.googleWorkspaces) {
      const legacy = savedIntegrations.googleWorkspace;
      savedIntegrations.googleWorkspaces = legacy.connected
        ? [{ id: 'default', label: 'Default', ...legacy }]
        : [];
    }
    const settings = await db.get('settings', {});
    const appSettings = await db.get('appSettings', {
      allowProfileUpdates: true,
      forgeInstanceId: 'agent-forge-local',
      relayUrl: '',
      relayAdminToken: '',
      people: [],
      inboxOwners: [
        { id: 'primary', label: 'Primary' },
        { id: 'shared', label: 'Shared' },
      ],
    });
    set(s => ({
      models,
      userProfile,
      integrations: { ...s.integrations, ...savedIntegrations },
      appSettings: { ...s.appSettings, ...appSettings },
      selectedModelId: settings.selectedModelId ?? '',
    }));
  },

  persist: async () => {
    const { models, userProfile, integrations, appSettings, selectedModelId } = get();
    await db.set('models', models);
    await db.set('userProfile', userProfile);
    await db.set('integrations', integrations);
    await db.set('appSettings', appSettings);
    await db.set('settings', { selectedModelId });
  },
}));
