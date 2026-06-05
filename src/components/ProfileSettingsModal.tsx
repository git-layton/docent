import { useState, useEffect } from 'react';
import {
  Settings, X, Loader2, Globe, Database, CalendarDays, Link, BookOpen, Inbox, Search,
  Cpu, Server, Trash2, Plus, User, MessageSquare, Mail, FolderOpen, CheckCircle2, Layers, CalendarClock
} from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useUIStore } from '../store/useUIStore';
import { invoke } from '@tauri-apps/api/core';
import { db } from '../services/database';
import { AGENT_FORGE_GUIDE, AGENT_FORGE_GUIDE_RELATIVE_PATH } from '../data/agentForgeUserDocs';
import { getLocalModelRecommendation } from '../services/modelRecommendations';

export function ProfileSettingsModal() {
  const userProfile = useSettingsStore(s => s.userProfile);
  const integrations = useSettingsStore(s => s.integrations);
  const appSettings = useSettingsStore(s => s.appSettings);
  const profileSettingsTab = useSettingsStore(s => s.profileSettingsTab);
  const models = useSettingsStore(s => s.models);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);
  const { setUserProfile, setIntegrations, setAppSettings, setProfileSettingsTab,
    setShowProfileSettings, setShowModelWizard, setWizardStep,
    setEditingModel, setFetchedModels, setPendingModelSelections, setFetchModelsError, setModelSearchQuery,
    setSelectedModelId, setModels } = useSettingsStore.getState();

  const agentForgePath = useMemoryStore(s => s.agentForgePath);
  const ramStats = useUIStore(s => s.ramStats);
  const hwProfile = useUIStore(s => s.hwProfile);
  const modelRecommendation = getLocalModelRecommendation(ramStats?.total_mb ?? hwProfile?.total_mb ?? null);

  const [guideStatus, setGuideStatus] = useState<'installed' | 'deleted' | 'checking'>('checking');
  const [ownerDraft, setOwnerDraft] = useState('');
  const [peopleDraft, setPeopleDraft] = useState('');
  const [semanticStatus, setSemanticStatus] = useState<{ documents: number; entities: number; facts: number; relations: number } | null>(null);
  const [semanticSyncing, setSemanticSyncing] = useState(false);

  useEffect(() => {
    db.get('userDocsInstalled', false).then(v => setGuideStatus(v ? 'installed' : 'deleted'));
    refreshSemanticStatus();
  }, []);

  useEffect(() => {
    const owners = Array.isArray(appSettings.inboxOwners) && appSettings.inboxOwners.length
      ? appSettings.inboxOwners
      : [{ id: 'primary', label: 'Primary' }, { id: 'shared', label: 'Shared' }];
    setOwnerDraft(owners.map((owner: any) => `${owner.id}: ${owner.label}`).join('\n'));
  }, [appSettings.inboxOwners]);

  useEffect(() => {
    const people = Array.isArray(appSettings.people) ? appSettings.people : [];
    setPeopleDraft(people.map((person: any) => `${person.id}: ${person.label}${person.role ? `: ${person.role}` : ''}`).join('\n'));
  }, [appSettings.people]);

  const openModelWizard = (provider: string) => {
    const endpoint =
      provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' :
      provider === 'huggingface' ? 'https://api-inference.huggingface.co/v1' :
      provider === 'anthropic' ? 'https://api.anthropic.com/v1' :
      provider === 'google' ? '' :
      'https://api.openai.com/v1';
    const existingKey = models.find((m: any) => m.provider === provider && m.apiKey)?.apiKey || '';
    setEditingModel({
      name:
        provider === 'lmstudio' ? 'LM Studio Engine' :
        provider === 'openai' ? 'OpenAI' :
        provider === 'anthropic' ? 'Claude' :
        provider === 'google' ? 'Gemini' :
        'Custom Model',
      provider,
      modelId: '',
      endpoint,
      apiKey: existingKey,
      contextLimit: 32000,
    });
    setFetchedModels([]);
    setPendingModelSelections([]);
    setFetchModelsError(null);
    setModelSearchQuery('');
    setWizardStep(3);
    setShowModelWizard(true);
  };

  const savePeople = () => {
    const people = peopleDraft
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [rawId, rawLabel, ...roleParts] = line.split(':');
        const id = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
        const label = (rawLabel ?? '').trim() || id || 'Person';
        const role = roleParts.join(':').trim();
        return id ? { id, label, ...(role ? { role } : {}) } : null;
      })
      .filter((person): person is { id: string; label: string; role?: string } => Boolean(person));
    setAppSettings((prev: any) => ({ ...prev, people }));
  };

  const saveInboxOwners = () => {
    const owners = ownerDraft
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [rawId, ...labelParts] = line.split(':');
        const id = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
        const label = labelParts.join(':').trim() || id || 'Inbox';
        return id ? { id, label } : null;
      })
      .filter((owner): owner is { id: string; label: string } => Boolean(owner));
    setAppSettings((prev: any) => ({ ...prev, inboxOwners: owners.length ? owners : prev.inboxOwners }));
  };

  const refreshSemanticStatus = async () => {
    const status = await invoke<{ documents: number; entities: number; facts: number; relations: number }>('get_semantic_layer_status').catch(() => null);
    if (status) setSemanticStatus(status);
  };

  const syncSemanticLayer = async () => {
    setSemanticSyncing(true);
    try {
      await invoke('sync_semantic_layer');
      await refreshSemanticStatus();
    } finally {
      setSemanticSyncing(false);
    }
  };

  const handleRestoreGuide = async () => {
    if (!agentForgePath) return;
    try {
      await invoke('write_memory', {
        path: `${agentForgePath}/${AGENT_FORGE_GUIDE_RELATIVE_PATH}`,
        content: AGENT_FORGE_GUIDE,
        commitMessage: 'Restore Agent Forge user guide',
        agentId: null,
        contextTokens: null,
        ramState: null,
      });
      await db.set('userDocsInstalled', true);
      setGuideStatus('installed');
    } catch (e) {
      console.error('[AgentForge] Failed to restore user guide:', e);
    }
  };

  const handleDeleteGuide = async () => {
    if (!agentForgePath) return;
    try {
      await invoke('delete_memory_file', {
        path: `${agentForgePath}/${AGENT_FORGE_GUIDE_RELATIVE_PATH}`,
      });
      await db.set('userDocsInstalled', false);
      setGuideStatus('deleted');
    } catch (e) {
      console.error('[AgentForge] Failed to delete user guide:', e);
    }
  };

  const onClose = () => setShowProfileSettings(false);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white dark:bg-neutral-900 w-full max-w-2xl rounded-[2rem] p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3"><div className="p-2 bg-neutral-900 dark:bg-white rounded-xl"><Settings className="w-6 h-6 text-white dark:text-neutral-900" /></div><h3 className="text-xl font-black tracking-tighter uppercase">System Settings</h3></div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800 mb-6 shrink-0">
          {['profile', 'models', 'people', 'integrations', 'inbox'].map(tab => <button key={tab} onClick={() => setProfileSettingsTab(tab)} className={`pb-3 px-4 text-xs font-black uppercase tracking-widest transition-all ${profileSettingsTab === tab ? 'text-[#4A5D75] border-b-2 border-[#4A5D75]' : 'text-neutral-400'}`}>{tab === 'profile' ? 'My Profile' : tab}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {profileSettingsTab === 'profile' ? (
            <div>
              <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">About Me (Global Context)</label>
              <textarea value={userProfile} onChange={e => setUserProfile(e.target.value)} rows={8} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl px-5 py-4 text-sm font-medium resize-none outline-none focus:border-[#6A829E] dark:text-neutral-100" placeholder="" />

              {/* Automated Profile Update Toggle */}
              <div className="mt-6 flex items-center justify-between p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
                 <div className="flex flex-col">
                    <span className="text-sm font-bold dark:text-neutral-200 block">Allow Profile Updates</span>
                    <span className="text-[10px] text-neutral-500 font-medium tracking-wide">AI can autonomously propose updates to your profile from chat conversations.</span>
                 </div>
                 <button onClick={() => setAppSettings((prev: any) => ({ ...prev, allowProfileUpdates: !prev.allowProfileUpdates }))} className={`w-10 h-5 rounded-full transition-all relative shrink-0 ${appSettings.allowProfileUpdates ? 'bg-[#4A5D75]' : 'bg-neutral-300 dark:bg-neutral-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${appSettings.allowProfileUpdates ? 'right-0.5' : 'left-0.5'}`} />
                 </button>
              </div>

              {/* User Guide section */}
              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4 mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-4 h-4 text-[#6A829E] shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">User Guide</p>
                      <p className="text-xs text-neutral-500 mt-0.5">Agent Forge 2.0 help docs in your Knowledge Core</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {guideStatus === 'installed' ? (
                      <>
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Installed</span>
                        <button onClick={handleDeleteGuide} className="text-xs text-neutral-400 hover:text-rose-500 transition-colors">Remove</button>
                      </>
                    ) : guideStatus === 'deleted' ? (
                      <>
                        <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Not installed</span>
                        <button onClick={handleRestoreGuide} className="text-xs font-bold text-[#4A5D75] hover:text-[#3D4D61] transition-colors">Restore</button>
                      </>
                    ) : (
                      <span className="text-[10px] text-neutral-400">...</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : profileSettingsTab === 'models' ? (
            <div className="space-y-6">
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
                <div className="flex items-center justify-between gap-4 mb-5">
                  <div>
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2"><Cpu className="w-4 h-4 text-[#6A829E]" /> Models</h4>
                    <p className="text-xs text-neutral-500 font-medium mt-1">Connect at least one chat model before Lexi or any specialist can answer.</p>
                  </div>
                  <button onClick={() => openModelWizard('openai')} className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-all flex items-center gap-2">
                    <Plus className="w-3.5 h-3.5" /> Add Model
                  </button>
                </div>

                <div className="mb-5 p-4 rounded-2xl border border-[#D6E0EA] dark:border-[#2C3E50]/60 bg-[#F7FAFC] dark:bg-[#1E2B38]/20">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#6A829E]">Recommended for this computer</p>
                      <p className="text-sm font-black text-neutral-900 dark:text-neutral-100 mt-1">{modelRecommendation.headline}</p>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">{modelRecommendation.strategy}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-[10px] font-black uppercase tracking-widest text-[#6A829E] shrink-0">
                      {modelRecommendation.ramLabel}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {modelRecommendation.options.slice(0, 2).map(option => (
                      <button
                        key={`${option.provider}-${option.modelId}`}
                        onClick={() => {
                          setEditingModel({
                            name: option.name,
                            provider: option.provider,
                            modelId: option.modelId,
                            endpoint: option.endpoint,
                            apiKey: '',
                            contextLimit: option.contextLimit,
                          });
                          setFetchedModels([]);
                          setPendingModelSelections([]);
                          setFetchModelsError(null);
                          setModelSearchQuery('');
                          setWizardStep(3);
                          setShowModelWizard(true);
                        }}
                        className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-left hover:border-[#899AB5] transition-all"
                      >
                        <span className="block text-[10px] font-black text-neutral-800 dark:text-neutral-100">{option.name}</span>
                        <span className="block text-[9px] font-mono text-neutral-500">{option.modelId}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 mb-5">
                  <button onClick={() => openModelWizard('lmstudio')} className="p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 hover:border-[#6A829E] hover:bg-[#F0F4F8] dark:hover:bg-[#1E2B38]/30 text-left transition-all">
                    <Server className="w-4 h-4 text-[#D4AA7D] mb-2" />
                    <p className="text-xs font-black uppercase tracking-widest">LM Studio</p>
                    <p className="text-[10px] text-neutral-500 mt-1 font-medium">Supported local path · 127.0.0.1:1234</p>
                  </button>
                </div>

                <div className="space-y-2">
                  {models.length === 0 ? (
                    <div className="p-4 rounded-2xl bg-[#F9F4EE] dark:bg-[#5C452E]/20 border border-[#EEDCC4] dark:border-[#5C452E]/30 text-xs font-bold text-[#9C7A3C] dark:text-[#D4AA7D]">
                      No chat model is connected yet.
                    </div>
                  ) : models.map((model: any) => (
                    <div key={model.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
                      <button onClick={() => setSelectedModelId(model.id)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black truncate">{model.name}</span>
                          {selectedModelId === model.id && <span className="text-[9px] font-black uppercase tracking-widest text-[#7A9E8D]">Active</span>}
                        </div>
                        <p className="text-[10px] text-neutral-500 font-mono truncate">{model.provider} · {model.modelId}</p>
                      </button>
                      <button onClick={() => { setModels((prev: any[]) => prev.filter(x => x.id !== model.id)); if (selectedModelId === model.id) setSelectedModelId(models.find((m: any) => m.id !== model.id)?.id ?? ''); }} className="p-2 rounded-lg text-neutral-400 hover:text-[#C98A8A] hover:bg-[#F7EBEB] dark:hover:bg-[#4A2E2E]/30 transition-all" title="Remove model">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : profileSettingsTab === 'people' ? (
            <div className="space-y-6">
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-5">
                <div>
                  <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-1"><User className="w-4 h-4 text-[#7A9E8D]" /> People</h4>
                  <p className="text-xs text-neutral-500 font-medium">Real humans Agent Forge can keep context about. They are not agents and they do not run models or tools.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-700 dark:text-neutral-200">People</p>
                    <p className="text-[10px] text-neutral-500 mt-1 leading-relaxed">Human profiles for family, teammates, clients, or capture owners.</p>
                  </div>
                  <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-700 dark:text-neutral-200">Agents</p>
                    <p className="text-[10px] text-neutral-500 mt-1 leading-relaxed">AI specialists with prompts, tools, memory, and model settings.</p>
                  </div>
                  <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-700 dark:text-neutral-200">Channels</p>
                    <p className="text-[10px] text-neutral-500 mt-1 leading-relaxed">Shared project rooms where agents collaborate around a goal.</p>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Human Profiles</label>
                <textarea
                  value={peopleDraft}
                  onChange={e => setPeopleDraft(e.target.value)}
                  rows={6}
                  className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono resize-none"
                  placeholder={'me: Me: Primary user\npartner: Partner: Family context\nclient: Client: Work context'}
                />
                  <p className="text-[10px] text-neutral-500 mt-2">One profile per line as <code>person-id: Display Name: context</code>. Leave this empty if Agent Forge is only for one person right now.</p>
                </div>
                <button onClick={savePeople} className="w-full py-3 bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all">
                  Save People
                </button>
                <div className="rounded-2xl border border-[#D6E0EA] dark:border-[#2C3E50]/60 bg-[#F7FAFC] dark:bg-[#1E2B38]/20 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#6A829E]">Capture owners</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">Shortcut and relay ownership is configured in the Inbox tab. Use the same IDs here only when a real person also needs a visible profile in the left rail.</p>
                </div>
              </div>
            </div>
          ) : profileSettingsTab === 'inbox' ? (
            <div className="space-y-6">
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-5">
                <div>
                  <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-1"><Inbox className="w-4 h-4 text-[#6A829E]" /> Forge Inbox</h4>
                  <p className="text-xs text-neutral-500 font-medium">Pair share-sheet Shortcuts and relay tokens to the right local Agent Forge instance and capture owner.</p>
                  <p className="text-[10px] text-neutral-400 mt-1">The desktop app reads the local <code>~/AgentForge/inbox/raw</code> folder; the relay should run on the same always-on Mac as this Agent Forge instance.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Instance ID</label>
                    <input
                      type="text"
                      value={appSettings.forgeInstanceId || ''}
                      onChange={e => setAppSettings((prev: any) => ({ ...prev, forgeInstanceId: e.target.value }))}
                      placeholder="agent-forge-home"
                      className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Relay URL</label>
                    <input
                      type="text"
                      value={appSettings.relayUrl || ''}
                      onChange={e => setAppSettings((prev: any) => ({ ...prev, relayUrl: e.target.value }))}
                      placeholder="http://macbook-air:8765"
                      className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Admin Token</label>
                    <input
                      type="password"
                      value={appSettings.relayAdminToken || ''}
                      onChange={e => setAppSettings((prev: any) => ({ ...prev, relayAdminToken: e.target.value }))}
                      placeholder="optional admin token from ~/.agent-forge-relay.env"
                      className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Capture Owners</label>
                  <textarea
                    value={ownerDraft}
                    onChange={e => setOwnerDraft(e.target.value)}
                    rows={5}
                    className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono resize-none"
                    placeholder={'primary: Primary\nshared: Shared'}
                  />
                  <p className="text-[10px] text-neutral-500 mt-2">One owner per line as <code>owner-id: Label</code>. Relay tokens should use the same owner IDs so each Shortcut lands in the right inbox.</p>
                </div>

                <button onClick={saveInboxOwners} className="w-full py-3 bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all">
                  Save Inbox Owners
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500 leading-relaxed">
                Relay token routes use <code>ownerId:Owner Label:token:instanceId:shareId</code>. That is what connects a specific Shortcut/share action to the right Agent Forge instance and the right capture owner.
              </div>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Semantic Layer */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><Database className="w-5 h-5 text-[#6A829E]" /></div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200">Semantic Layer</span>
                    <span className="text-xs text-neutral-500 font-medium mt-0.5">Local facts, entities, and relationships extracted from grounded memory.</span>
                    <span className="text-[10px] text-neutral-400 mt-1">
                      {semanticStatus
                        ? `${semanticStatus.documents} docs · ${semanticStatus.entities} entities · ${semanticStatus.facts} facts · ${semanticStatus.relations} relations`
                        : 'Status unavailable until the Knowledge Core is ready.'}
                    </span>
                  </div>
                </div>
                <button onClick={syncSemanticLayer} disabled={semanticSyncing} className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#4A5D75] text-white hover:bg-[#3D4D61] disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                  {semanticSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                  {semanticSyncing ? 'Syncing' : 'Sync Now'}
                </button>
              </div>

              {/* Slack Integration */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><MessageSquare className="w-5 h-5 text-[#6A829E]" /></div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Slack</span>
                      <span className="text-xs text-neutral-500 font-medium mt-0.5">Search workspace messages and prepare posts for approval.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({ ...prev, slack: { ...prev.slack, enabled: !prev.slack?.enabled } }))}
                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 ${integrations.slack?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}
                  >
                    {integrations.slack?.enabled ? 'Enabled' : 'Enable'}
                  </button>
                </div>
                {integrations.slack?.enabled && (
                  <div className="animate-in slide-in-from-top-2 pt-4 border-t border-neutral-100 dark:border-neutral-800 flex flex-col gap-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Bot Token</label>
                    <input
                      type="password"
                      value={integrations.slack?.botToken || ''}
                      onChange={e => setIntegrations((prev: any) => ({ ...prev, slack: { ...prev.slack, botToken: e.target.value } }))}
                      placeholder="xoxb-..."
                      className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                    />
                    <p className="text-[10px] text-neutral-400 leading-relaxed">
                      Add Slack OAuth scopes <code>channels:history</code>, <code>channels:read</code>, <code>chat:write</code>, and <code>search:read</code>, then paste the Bot User OAuth Token.
                    </p>
                    {integrations.slack?.botToken && (
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#7A9E8D]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Token saved
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Google Workspace Integration */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700 flex items-center gap-1">
                      <Mail className="w-4 h-4 text-[#C98A8A]" />
                      <FolderOpen className="w-4 h-4 text-[#D4AA7D]" />
                      <CalendarClock className="w-4 h-4 text-[#6A829E]" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Google Workspace</span>
                      <span className="text-xs text-neutral-500 font-medium mt-0.5">Gmail, Drive, and Calendar across multiple accounts.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({
                      ...prev,
                      googleWorkspaces: [...(prev.googleWorkspaces ?? []), { id: `gw-${Date.now()}`, label: '', clientId: '', clientSecret: '', refreshToken: '', connected: true, scopes: { gmail: false, drive: false, calendar: false } }]
                    }))}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-all shadow-sm shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Account
                  </button>
                </div>

                {(integrations.googleWorkspaces ?? []).length === 0 && (
                  <p className="text-[10px] text-neutral-400 text-center py-2">No Google accounts added yet.</p>
                )}

                {(integrations.googleWorkspaces ?? []).map((account: any, index: number) => (
                  <div key={account.id} className="flex flex-col gap-3 pt-4 border-t border-neutral-100 dark:border-neutral-800 animate-in slide-in-from-top-2">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={account.label || ''}
                        onChange={e => setIntegrations((prev: any) => {
                          const accounts = [...(prev.googleWorkspaces ?? [])];
                          accounts[index] = { ...accounts[index], label: e.target.value };
                          return { ...prev, googleWorkspaces: accounts };
                        })}
                        placeholder="Account label, for example Work or Personal"
                        className="flex-1 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#6A829E] font-bold transition-all"
                      />
                      <button
                        onClick={() => setIntegrations((prev: any) => ({ ...prev, googleWorkspaces: (prev.googleWorkspaces ?? []).filter((_: any, i: number) => i !== index) }))}
                        className="p-2 text-neutral-400 hover:text-[#C98A8A] transition-colors"
                        title="Remove account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[
                        { field: 'clientId', label: 'OAuth Client ID', placeholder: 'xxxx.apps.googleusercontent.com' },
                        { field: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'GOCSPX-...' },
                      ].map(field => (
                        <div key={field.field} className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{field.label}</label>
                          <input
                            type="password"
                            value={account[field.field] || ''}
                            onChange={e => setIntegrations((prev: any) => {
                              const accounts = [...(prev.googleWorkspaces ?? [])];
                              accounts[index] = { ...accounts[index], [field.field]: e.target.value };
                              return { ...prev, googleWorkspaces: accounts };
                            })}
                            placeholder={field.placeholder}
                            className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Refresh Token</label>
                      <input
                        type="password"
                        value={account.refreshToken || ''}
                        onChange={e => setIntegrations((prev: any) => {
                          const accounts = [...(prev.googleWorkspaces ?? [])];
                          accounts[index] = { ...accounts[index], refreshToken: e.target.value };
                          return { ...prev, googleWorkspaces: accounts };
                        })}
                        placeholder="1//0g..."
                        className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Scopes</label>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { id: 'gmail', label: 'Gmail', icon: Mail, color: 'text-[#C98A8A]' },
                          { id: 'drive', label: 'Drive / Docs', icon: FolderOpen, color: 'text-[#D4AA7D]' },
                          { id: 'calendar', label: 'Calendar', icon: CalendarClock, color: 'text-[#6A829E]' },
                        ].map(scope => {
                          const ScopeIcon = scope.icon;
                          const active = account.scopes?.[scope.id];
                          return (
                            <button
                              key={scope.id}
                              onClick={() => setIntegrations((prev: any) => {
                                const accounts = [...(prev.googleWorkspaces ?? [])];
                                accounts[index] = { ...accounts[index], scopes: { ...accounts[index].scopes, [scope.id]: !active } };
                                return { ...prev, googleWorkspaces: accounts };
                              })}
                              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${active ? 'bg-[#F0F4F8] dark:bg-[#1E2B38]/40 border-[#4A5D75]/30 text-[#4A5D75] dark:text-[#9EADC8]' : 'border-neutral-200 dark:border-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}`}
                            >
                              <ScopeIcon className={`w-3.5 h-3.5 ${active ? scope.color : ''}`} />
                              {scope.label}
                              {active && <CheckCircle2 className="w-3 h-3 text-[#7A9E8D]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {account.clientId && account.refreshToken && (
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#7A9E8D]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Credentials saved
                      </div>
                    )}
                  </div>
                ))}

                {(integrations.googleWorkspaces ?? []).length > 0 && (
                  <p className="text-[10px] text-neutral-400 leading-relaxed pt-2 border-t border-neutral-100 dark:border-neutral-800">
                    Enable the Gmail, Drive, and Calendar APIs in Google Cloud, create OAuth 2.0 desktop credentials, run the OAuth flow once, then paste the refresh token.
                  </p>
                )}
              </div>

              {/* GUS Integration */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><Layers className="w-5 h-5 text-[#6A829E]" /></div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">GUS</span>
                      <span className="text-xs text-neutral-500 font-medium mt-0.5">Salesforce Agile Accelerator work items, stories, and sprints.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, enabled: !prev.gus?.enabled } }))}
                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 ${integrations.gus?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}
                  >
                    {integrations.gus?.enabled ? 'Enabled' : 'Enable'}
                  </button>
                </div>
                {integrations.gus?.enabled && (
                  <div className="animate-in slide-in-from-top-2 pt-4 border-t border-neutral-100 dark:border-neutral-800 flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Salesforce Instance URL</label>
                      <input
                        type="text"
                        value={integrations.gus?.instanceUrl || ''}
                        onChange={e => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, instanceUrl: e.target.value } }))}
                        placeholder="https://example.my.salesforce.com"
                        className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Access Token / Session ID</label>
                      <input
                        type="password"
                        value={integrations.gus?.accessToken || ''}
                        onChange={e => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, accessToken: e.target.value } }))}
                        placeholder="00D..."
                        className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                      />
                    </div>
                    {integrations.gus?.instanceUrl && integrations.gus?.accessToken && (
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#7A9E8D]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Credentials saved
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tavily Web Search Integration */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                     <div className="flex items-center gap-3">
                         <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><Globe className="w-5 h-5 text-[#6A829E]" /></div>
                         <div className="flex flex-col">
                            <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Tavily Web Search</span>
                            <span className="text-xs text-neutral-500 font-medium mt-0.5">1,000 free AI searches/month. <a href="https://tavily.com" target="_blank" rel="noreferrer" className="text-[#6A829E] hover:underline font-bold inline-flex items-center gap-1">Get API Key <Link className="w-2.5 h-2.5"/></a></span>
                         </div>
                     </div>
                     <button onClick={() => setIntegrations((prev: any) => ({ ...prev, tavily: { ...prev.tavily, enabled: !prev.tavily?.enabled } }))} className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${integrations.tavily?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}>{integrations.tavily?.enabled ? 'Enabled' : 'Enable'}</button>
                 </div>
                 {integrations.tavily?.enabled && (
                    <div className="animate-in slide-in-from-top-2 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                       <input type="password" value={integrations.tavily?.apiKey || ''} onChange={e => setIntegrations((prev: any) => ({ ...prev, tavily: { ...prev.tavily, apiKey: e.target.value } }))} placeholder="Paste your tvly-... API key here" className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all" />
                    </div>
                 )}
              </div>

              {/* Brave Web Search Integration */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                     <div className="flex items-center gap-3">
                         <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><Search className="w-5 h-5 text-[#6A829E]" /></div>
                         <div className="flex flex-col">
                            <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Brave Search</span>
                            <span className="text-xs text-neutral-500 font-medium mt-0.5">Optional second source-discovery provider. Agent Forge still reads result URLs before citing them.</span>
                         </div>
                     </div>
                     <button onClick={() => setIntegrations((prev: any) => ({ ...prev, brave: { ...prev.brave, enabled: !prev.brave?.enabled } }))} className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${integrations.brave?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}>{integrations.brave?.enabled ? 'Enabled' : 'Enable'}</button>
                 </div>
                 {integrations.brave?.enabled && (
                    <div className="animate-in slide-in-from-top-2 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                       <input type="password" value={integrations.brave?.apiKey || ''} onChange={e => setIntegrations((prev: any) => ({ ...prev, brave: { ...prev.brave, apiKey: e.target.value } }))} placeholder="Paste your Brave Search API key" className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all" />
                       <p className="text-[10px] text-neutral-500 mt-2">Brave and Tavily can run together; duplicate URLs are deduped before the source tray is shown.</p>
                    </div>
                 )}
              </div>

              {/* Local Planner */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-[#F9F4EE] dark:bg-[#5C452E]/20 rounded-xl shadow-sm border border-[#EEDCC4] dark:border-[#5C452E]/30"><CalendarDays className="w-5 h-5 text-[#D4AA7D]" /></div>
                  <div className="flex flex-col">
                    <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200">Local Planner</span>
                    <span className="text-xs text-neutral-500 font-medium mt-0.5">Events & reminders saved to <code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded text-[11px]">~/AgentForge/memory/tasks.md</code></span>
                    <span className="text-[10px] text-neutral-400 mt-0.5">Enable the "Local Planner" tool on an agent to let it add tasks.</span>
                  </div>
                </div>
                <span className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#9FBBAF]/20 text-[#7A9E8D] border border-[#9FBBAF]/30">Active</span>
              </div>

            </div>
          )}
        </div>
        <button onClick={onClose} className="w-full py-5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl mt-6 shrink-0 active:scale-[0.98] transition-all">Done</button>
      </div>
    </div>
  );
}
