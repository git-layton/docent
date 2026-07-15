import { create } from 'zustand';
import { db } from '../services/database';
import { stashSecretsForDisk, rehydrateSecrets } from '../services/secretVault';
import { supportsVision } from '../services/llm';
import { applyTheme, watchSystemTheme, DEFAULT_ACCENT, DEFAULT_THEME } from '../lib/theme';
import type { ThemeMode } from '../lib/theme';
import type { FileGrant, FileActivityEntry } from '../services/fileAccess/types';
import { DEFAULT_VOICE_PROFILE, type VoiceProfile } from '../services/voice';

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
  canHear?: boolean;     // native audio input (Gemma 4); same mmproj projector as vision
  isLocal: boolean;
  mmprojPath?: string;   // local vision: path to the mmproj projector llama-server was launched with
}

interface SettingsStore {
  // Model management
  models: Model[];
  selectedModelId: string;
  modelValidation: Record<string, string>;

  // User profile & integrations
  userName: string;
  userProfile: string;
  userAvatar: string;
  integrations: any;
  appSettings: {
    allowProfileUpdates: boolean;
    imageProvider: string;
    imageModelId: string;
    imageEndpoint: string;
    // Image Understanding (vision) — mirror of the Image Engine, pointed the other way: reads images
    // into text so any chat model can use them. 'auto' uses an already-configured cloud key if present.
    visionProvider: string;   // 'auto' | 'none' | 'google' | 'openai' | 'anthropic' | 'local' | 'custom'
    visionModelId: string;
    visionEndpoint: string;
    dreamAutoEnabled?: boolean;
    showContextWindowLine?: boolean;
    forgeInstanceId?: string;
    inboxOwners?: Array<{ id: string; label: string }>;
    people?: Array<{ id: string; label: string; role?: string }>;
    penguinMode?: boolean;
    // Default text-to-speech voice for reading messages aloud (per-agent overrides this).
    ttsVoiceURI?: string;
    ttsRate?: number;
    ttsPitch?: number;
    // File access (Workshop model). developerMode gates agent shell/command execution (off by default).
    // fileAccessGrants are remembered consent grants for real-filesystem paths (keyed by grantKey()).
    // fileActivity is the receipts feed of file/command ops (newest first, capped).
    developerMode?: boolean;
    fileAccessGrants?: Record<string, FileGrant>;
    fileActivity?: FileActivityEntry[];
    // "Write like me" — the user's distilled writing voice + per-surface toggles. Learned from
    // their own sent comms; injected so agents compose on the user's behalf in their voice.
    voiceProfile?: VoiceProfile;
    newShellEnabled?: boolean;
    glassEnabled?: boolean;
  };

  // Profile settings modal
  profileSettingsTab: string;
  showProfileSettings: boolean;
  imageTestState: { loading: boolean; error: string | null; successUrl: string | null };
  imageEngineModels: any[];
  isFetchingImageModels: boolean;
  visionTestState: { loading: boolean; error: string | null; successUrl: string | null };
  visionEngineModels: any[];
  isFetchingVisionModels: boolean;

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

  // Appearance
  theme: ThemeMode;
  accentColor: string;
  setTheme: (mode: ThemeMode) => void;
  setAccentColor: (accent: string) => void;

  // Onboarding
  onboardingComplete: boolean;
  showOnboarding: boolean;
  onboardingInitialStep: number;
  hasPromptedMacPermissions: boolean;
  setOnboardingComplete: (v: boolean) => void;
  setShowOnboarding: (v: boolean) => void;
  setOnboardingInitialStep: (step: number) => void;
  setHasPromptedMacPermissions: (v: boolean) => void;

  // Actions
  setModels: (fn: ((prev: Model[]) => Model[]) | Model[]) => void;
  setSelectedModelId: (id: string) => void;
  setModelValidation: (fn: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) => void;
  setUserName: (v: string) => void;
  setUserProfile: (v: string) => void;
  setUserAvatar: (v: string) => void;
  setIntegrations: (fn: ((prev: any) => any) | any) => void;
  setAppSettings: (fn: ((prev: any) => any) | any) => void;
  addFileGrant: (grant: FileGrant) => void;
  revokeFileGrant: (key: string) => void;
  logFileActivity: (entry: FileActivityEntry) => void;
  setProfileSettingsTab: (tab: string) => void;
  setShowProfileSettings: (v: boolean) => void;
  setImageTestState: (v: { loading: boolean; error: string | null; successUrl: string | null }) => void;
  setImageEngineModels: (v: any[]) => void;
  setIsFetchingImageModels: (v: boolean) => void;
  setVisionTestState: (v: { loading: boolean; error: string | null; successUrl: string | null }) => void;
  setVisionEngineModels: (v: any[]) => void;
  setIsFetchingVisionModels: (v: boolean) => void;
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
  userAvatar: '',
  integrations: {
    brave: { enabled: false, apiKey: '' },
    tavily: { enabled: false, apiKey: '' },
    googleCalendar: { connected: false },
    openai: { apiKey: '' },
    google: { apiKey: '' },
    anthropic: { apiKey: '' },
    customImage: { apiKey: '' },
    slack: { enabled: false, botToken: '' },
    imessage: { enabled: false, setupComplete: false },
    googleWorkspaces: [],
    gus: { enabled: false, instanceUrl: '', accessToken: '' },
    // Backend-agnostic connectors (see src/services/connectors). Default to 'local' so behavior is
    // unchanged until the user opts into a native (EventKit/Notes.app) or cloud backend.
    calendar: { backend: 'local', selectedCalendarIds: [], googleWorkspaceId: '', migratedToEventkit: false },
    tasks: { backend: 'local', selectedListIds: [], migratedToEventkit: false },
    notes: { backend: 'local' },
  },
  appSettings: {
    allowProfileUpdates: true,
    imageProvider: 'none',
    imageModelId: '',
    imageEndpoint: '',
    visionProvider: 'auto',
    visionModelId: '',
    visionEndpoint: '',
    dreamAutoEnabled: false, // opt-in: the Dream Cycle never auto-runs or auto-mutates memory until the user enables it (README: "manual-only")
    showContextWindowLine: false,
    developerMode: false,
    fileAccessGrants: {},
    fileActivity: [],
    voiceProfile: DEFAULT_VOICE_PROFILE,
    newShellEnabled: false,
    glassEnabled: false,
  },
  profileSettingsTab: 'profile',
  showProfileSettings: false,
  imageTestState: { loading: false, error: null, successUrl: null },
  imageEngineModels: [],
  isFetchingImageModels: false,
  visionTestState: { loading: false, error: null, successUrl: null },
  visionEngineModels: [],
  isFetchingVisionModels: false,
  showModelWizard: false,
  wizardStep: 3,
  editingModel: { name: '', provider: 'openai', modelId: '', endpoint: '', apiKey: '', contextLimit: 128000 },
  fetchedModels: [],
  modelSearchQuery: '',
  isFetchingModels: false,
  fetchModelsError: null,
  pendingModelSelections: [],
  modelTab: 'local',
  onboardingComplete: false,
  showOnboarding: false,
  onboardingInitialStep: 1,
  hasPromptedMacPermissions: false,

  theme: DEFAULT_THEME,
  accentColor: DEFAULT_ACCENT,
  setTheme: (mode) => {
    set({ theme: mode });
    applyTheme(mode, get().accentColor);
    void db.set('theme', mode);
  },
  setAccentColor: (accent) => {
    set({ accentColor: accent });
    applyTheme(get().theme, accent);
    void db.set('accentColor', accent);
  },

  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setShowOnboarding: (v) => set({ showOnboarding: v }),
  setOnboardingInitialStep: (step) => set({ onboardingInitialStep: step }),
  setHasPromptedMacPermissions: (v) => { set({ hasPromptedMacPermissions: v }); void get().persist(); },

  setModels: (fn) =>
    set(s => ({ models: typeof fn === 'function' ? fn(s.models) : fn })),
  setSelectedModelId: (id) => set({ selectedModelId: id }),
  setModelValidation: (fn) =>
    set(s => ({ modelValidation: typeof fn === 'function' ? fn(s.modelValidation) : fn })),
  setUserName: (v) => set({ userName: v }),
  setUserProfile: (v) => set({ userProfile: v }),
  setUserAvatar: (v) => set({ userAvatar: v }),
  setIntegrations: (fn) =>
    set(s => ({ integrations: typeof fn === 'function' ? fn(s.integrations) : fn })),
  setAppSettings: (fn) =>
    set(s => ({ appSettings: typeof fn === 'function' ? fn(s.appSettings) : fn })),
  addFileGrant: (grant) =>
    set(s => ({
      appSettings: {
        ...s.appSettings,
        fileAccessGrants: {
          ...(s.appSettings.fileAccessGrants ?? {}),
          [`${grant.scope}:${grant.effect}:${grant.path}`]: grant,
        },
      },
    })),
  revokeFileGrant: (key) =>
    set(s => {
      const next = { ...(s.appSettings.fileAccessGrants ?? {}) };
      delete next[key];
      return { appSettings: { ...s.appSettings, fileAccessGrants: next } };
    }),
  logFileActivity: (entry) =>
    set(s => ({
      appSettings: {
        ...s.appSettings,
        fileActivity: [entry, ...(s.appSettings.fileActivity ?? [])].slice(0, 100),
      },
    })),
  setProfileSettingsTab: (tab) => set({ profileSettingsTab: tab }),
  setShowProfileSettings: (v) => set({ showProfileSettings: v }),
  setImageTestState: (v) => set({ imageTestState: v }),
  setImageEngineModels: (v) => set({ imageEngineModels: v }),
  setIsFetchingImageModels: (v) => set({ isFetchingImageModels: v }),
  setVisionTestState: (v) => set({ visionTestState: v }),
  setVisionEngineModels: (v) => set({ visionEngineModels: v }),
  setIsFetchingVisionModels: (v) => set({ isFetchingVisionModels: v }),
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
      // Derived from the model id (single source of truth) so models persisted before vision
      // gating existed get the correct flag retroactively, in lockstep with the live UI check.
      canImage: supportsVision(m.modelId ?? ''),
    }));
    const userName = await db.get('userName', '');
    const userProfile = await db.get('userProfile', '');
    const userAvatar = await db.get('userAvatar', '');
    const savedIntegrations = await db.get('integrations', {});
    const settings = await db.get('settings', {});
    const appSettings = await db.get('appSettings', {
      allowProfileUpdates: true,
      imageProvider: 'none',
      imageModelId: '',
      imageEndpoint: '',
      visionProvider: 'auto',
      visionModelId: '',
      visionEndpoint: '',
      newShellEnabled: false,
      glassEnabled: false,
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
    const hasPromptedMacPermissions = await db.get('hasPromptedMacPermissions', false);
    const theme: ThemeMode = await db.get('theme', DEFAULT_THEME);
    const accentColor: string = await db.get('accentColor', DEFAULT_ACCENT);
    applyTheme(theme, accentColor);
    watchSystemTheme(() => get().theme, () => get().accentColor);
    // SEC-APIKEYS: pull model/integration secrets back out of the Keychain into the in-memory store
    // (where llm.ts/integrations.ts expect them). Legacy plaintext still on disk is kept and flagged.
    const { models: hydratedModels, integrations: hydratedIntegrations, needsMigration } =
      await rehydrateSecrets(models, savedIntegrations);
    set(s => ({
      theme,
      accentColor,
      models: hydratedModels,
      userName,
      userProfile,
      userAvatar,
      integrations: { ...s.integrations, ...hydratedIntegrations },
      appSettings: { ...s.appSettings, ...appSettings },
      selectedModelId: settings.selectedModelId ?? '',
      onboardingComplete,
      hasPromptedMacPermissions,
    }));
    // Migrate any legacy plaintext secret into the Keychain + redact the on-disk blob.
    if (needsMigration) void get().persist();
  },

  persist: async () => {
    const { models, userName, userProfile, userAvatar, integrations, appSettings, selectedModelId, onboardingComplete, hasPromptedMacPermissions, theme, accentColor } = get();
    // SEC-APIKEYS: write REDACTED copies to disk — secrets go to the Keychain (a value is only blanked
    // on disk once its Keychain write is confirmed, so a secret is never lost). In-memory state keeps
    // the live secrets. Without Tauri this is a no-op and the blobs persist exactly as before.
    const { models: diskModels, integrations: diskIntegrations } = await stashSecretsForDisk(models, integrations);
    await db.set('theme', theme);
    await db.set('accentColor', accentColor);
    await db.set('models', diskModels);
    await db.set('userName', userName);
    await db.set('userProfile', userProfile);
    await db.set('userAvatar', userAvatar);
    await db.set('integrations', diskIntegrations);
    await db.set('appSettings', appSettings);
    await db.set('settings', { selectedModelId });
    await db.set('onboardingComplete', onboardingComplete);
    await db.set('hasPromptedMacPermissions', hasPromptedMacPermissions);
  },
}));
