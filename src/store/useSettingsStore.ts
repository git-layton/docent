import { create } from 'zustand';
import { db } from '../services/database';

export const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'native'] as const;

export const isLocalProvider = (provider: string, endpoint?: string): boolean => {
  if ((LOCAL_PROVIDERS as readonly string[]).includes(provider)) return true;
  if (endpoint && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(endpoint)) return true;
  return false;
};

export interface Model {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  endpoint: string;
  apiKey: string;
  contextLimit: number;
  canImage: boolean;
  isLocal: boolean;
}

interface SettingsStore {
  // Model management
  models: Model[];
  selectedModelId: string;
  modelValidation: Record<string, string>;

  // User profile & integrations
  userName: string;
  userProfile: string;
  integrations: any;
  appSettings: {
    allowProfileUpdates: boolean;
    imageProvider: string;
    imageModelId: string;
    imageEndpoint: string;
    dreamAutoEnabled?: boolean;
    forgeInstanceId?: string;
    inboxOwners?: Array<{ id: string; label: string }>;
    people?: Array<{ id: string; label: string; role?: string }>;
  };

  // Profile settings modal
  profileSettingsTab: string;
  showProfileSettings: boolean;
  imageTestState: { loading: boolean; error: string | null; successUrl: string | null };
  imageEngineModels: any[];
  isFetchingImageModels: boolean;

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
  modelTab: 'cloud' | 'local';

  // Onboarding
  onboardingComplete: boolean;
  showOnboarding: boolean;
  onboardingInitialStep: number;
  setOnboardingComplete: (v: boolean) => void;
  setShowOnboarding: (v: boolean) => void;
  setOnboardingInitialStep: (step: number) => void;

  // Actions
  setModels: (fn: ((prev: Model[]) => Model[]) | Model[]) => void;
  setSelectedModelId: (id: string) => void;
  setModelValidation: (fn: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) => void;
  setUserName: (v: string) => void;
  setUserProfile: (v: string) => void;
  setIntegrations: (fn: ((prev: any) => any) | any) => void;
  setAppSettings: (fn: ((prev: any) => any) | any) => void;
  setProfileSettingsTab: (tab: string) => void;
  setShowProfileSettings: (v: boolean) => void;
  setImageTestState: (v: { loading: boolean; error: string | null; successUrl: string | null }) => void;
  setImageEngineModels: (v: any[]) => void;
  setIsFetchingImageModels: (v: boolean) => void;
  setShowModelWizard: (v: boolean) => void;
  setWizardStep: (step: number) => void;
  setEditingModel: (fn: ((prev: any) => any) | any) => void;
  setFetchedModels: (v: Array<{ id: string; context: number }>) => void;
  setModelSearchQuery: (q: string) => void;
  setIsFetchingModels: (v: boolean) => void;
  setFetchModelsError: (e: string | null) => void;
  setPendingModelSelections: (fn: ((prev: any[]) => any[]) | any[]) => void;
  setModelTab: (tab: 'cloud' | 'local') => void;

  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  models: [],
  selectedModelId: '',
  modelValidation: {},
  userName: '',
  userProfile: '',
  integrations: {
    brave: { enabled: false, apiKey: '' },
    tavily: { enabled: false, apiKey: '' },
    googleCalendar: { connected: false },
    openai: { apiKey: '' },
    google: { apiKey: '' },
    customImage: { apiKey: '' },
    slack: { enabled: false, botToken: '' },
    googleWorkspaces: [],
    gus: { enabled: false, instanceUrl: '', accessToken: '' },
  },
  appSettings: {
    allowProfileUpdates: true,
    imageProvider: 'none',
    imageModelId: '',
    imageEndpoint: '',
    dreamAutoEnabled: true,
  },
  profileSettingsTab: 'profile',
  showProfileSettings: false,
  imageTestState: { loading: false, error: null, successUrl: null },
  imageEngineModels: [],
  isFetchingImageModels: false,
  showModelWizard: false,
  wizardStep: 3,
  editingModel: { name: '', provider: 'openai', modelId: '', endpoint: '', apiKey: '', contextLimit: 128000 },
  fetchedModels: [],
  modelSearchQuery: '',
  isFetchingModels: false,
  fetchModelsError: null,
  pendingModelSelections: [],
  modelTab: 'cloud',
  onboardingComplete: false,
  showOnboarding: false,
  onboardingInitialStep: 1,

  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setShowOnboarding: (v) => set({ showOnboarding: v }),
  setOnboardingInitialStep: (step) => set({ onboardingInitialStep: step }),

  setModels: (fn) =>
    set(s => ({ models: typeof fn === 'function' ? fn(s.models) : fn })),
  setSelectedModelId: (id) => set({ selectedModelId: id }),
  setModelValidation: (fn) =>
    set(s => ({ modelValidation: typeof fn === 'function' ? fn(s.modelValidation) : fn })),
  setUserName: (v) => set({ userName: v }),
  setUserProfile: (v) => set({ userProfile: v }),
  setIntegrations: (fn) =>
    set(s => ({ integrations: typeof fn === 'function' ? fn(s.integrations) : fn })),
  setAppSettings: (fn) =>
    set(s => ({ appSettings: typeof fn === 'function' ? fn(s.appSettings) : fn })),
  setProfileSettingsTab: (tab) => set({ profileSettingsTab: tab }),
  setShowProfileSettings: (v) => set({ showProfileSettings: v }),
  setImageTestState: (v) => set({ imageTestState: v }),
  setImageEngineModels: (v) => set({ imageEngineModels: v }),
  setIsFetchingImageModels: (v) => set({ isFetchingImageModels: v }),
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
  setModelTab: (tab) => set({ modelTab: tab }),

  hydrate: async () => {
    const rawModels: any[] = await db.get('models', []);
    // Migrate legacy models that predate the isLocal field
    const models: Model[] = rawModels.map((m: any) => ({
      ...m,
      isLocal: m.isLocal ?? isLocalProvider(m.provider ?? '', m.endpoint ?? ''),
      canImage: m.canImage ?? false,
    }));
    const userName = await db.get('userName', '');
    const userProfile = await db.get('userProfile', '');
    const savedIntegrations = await db.get('integrations', {});
    const settings = await db.get('settings', {});
    const appSettings = await db.get('appSettings', {
      allowProfileUpdates: true,
      imageProvider: 'none',
      imageModelId: '',
      imageEndpoint: '',
    });
    // Migrate legacy single googleWorkspace → googleWorkspaces array
    if (savedIntegrations.googleWorkspace && !savedIntegrations.googleWorkspaces) {
      const gw = savedIntegrations.googleWorkspace;
      if (gw.connected && gw.clientId) {
        savedIntegrations.googleWorkspaces = [{ id: 'default', label: 'Default', ...gw }];
      } else {
        savedIntegrations.googleWorkspaces = [];
      }
      delete savedIntegrations.googleWorkspace;
    }
    const onboardingComplete = await db.get('onboardingComplete', false);
    set(s => ({
      models,
      userName,
      userProfile,
      integrations: { ...s.integrations, ...savedIntegrations },
      appSettings: { ...s.appSettings, ...appSettings },
      selectedModelId: settings.selectedModelId ?? '',
      onboardingComplete,
    }));
  },

  persist: async () => {
    const { models, userName, userProfile, integrations, appSettings, selectedModelId, onboardingComplete } = get();
    await db.set('models', models);
    await db.set('userName', userName);
    await db.set('userProfile', userProfile);
    await db.set('integrations', integrations);
    await db.set('appSettings', appSettings);
    await db.set('settings', { selectedModelId });
    await db.set('onboardingComplete', onboardingComplete);
  },
}));
