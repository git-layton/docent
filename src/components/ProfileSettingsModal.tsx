import { useState, useEffect } from 'react';
import {
  Settings, X, ImageIcon, ShieldCheck, Loader2, Wand2, Globe, Database, CalendarDays, Link, BookOpen,
  MessageSquare, Mail, FolderOpen, CheckCircle2, Layers, Plus, Trash2, CalendarClock
} from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { invoke } from '@tauri-apps/api/core';
import { db } from '../services/database';
import { AGENT_FORGE_GUIDE, AGENT_FORGE_GUIDE_RELATIVE_PATH } from '../data/agentForgeUserDocs';

interface ProfileSettingsModalProps {
  fetchImageModels: () => void;
  testImageEngine: () => void;
  viewImageInCanvas: (src: string) => void;
}

export function ProfileSettingsModal({ fetchImageModels, testImageEngine, viewImageInCanvas }: ProfileSettingsModalProps) {
  const userName = useSettingsStore(s => s.userName);
  const userProfile = useSettingsStore(s => s.userProfile);
  const integrations = useSettingsStore(s => s.integrations);
  const appSettings = useSettingsStore(s => s.appSettings);
  const profileSettingsTab = useSettingsStore(s => s.profileSettingsTab);
  const imageTestState = useSettingsStore(s => s.imageTestState);
  const imageEngineModels = useSettingsStore(s => s.imageEngineModels);
  const isFetchingImageModels = useSettingsStore(s => s.isFetchingImageModels);
  const models = useSettingsStore(s => s.models);
  const { setUserName, setUserProfile, setIntegrations, setAppSettings, setProfileSettingsTab,
    setImageTestState, setImageEngineModels, setShowProfileSettings } = useSettingsStore.getState();

  const agentForgePath = useMemoryStore(s => s.agentForgePath);

  const [guideStatus, setGuideStatus] = useState<'installed' | 'deleted' | 'checking'>('checking');

  useEffect(() => {
    db.get('userDocsInstalled', false).then(v => setGuideStatus(v ? 'installed' : 'deleted'));
  }, []);

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

  const hasImplicitGoogleKey = models.some((m: any) => m.provider === 'google' && m.apiKey);
  const hasImplicitOpenAIKey = models.some((m: any) => m.provider === 'openai' && m.apiKey);
  const activeImageKey = appSettings.imageProvider === 'openai'
    ? (integrations.openai?.apiKey || models.find((m: any) => m.provider === 'openai' && m.apiKey)?.apiKey)
    : appSettings.imageProvider === 'google'
    ? (integrations.google?.apiKey || models.find((m: any) => m.provider === 'google' && m.apiKey)?.apiKey)
    : integrations.customImage?.apiKey || '';

  const onClose = () => { setShowProfileSettings(false); setImageTestState({ loading: false, error: null, successUrl: null }); };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white dark:bg-neutral-900 w-full max-w-2xl rounded-[2rem] p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-white flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3"><div className="p-2 bg-neutral-900 dark:bg-white rounded-xl"><Settings className="w-6 h-6 text-white dark:text-neutral-900" /></div><h3 className="text-xl font-black tracking-tighter uppercase">System Settings</h3></div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800 mb-6 shrink-0">
          {['profile', 'integrations'].map(tab => <button key={tab} onClick={() => setProfileSettingsTab(tab)} className={`pb-3 px-4 text-xs font-black uppercase tracking-widest transition-all ${profileSettingsTab === tab ? 'text-[#4A5D75] border-b-2 border-[#4A5D75]' : 'text-neutral-400'}`}>{tab === 'profile' ? 'My Profile' : 'Integrations'}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {profileSettingsTab === 'profile' ? (
            <div>
              <div className="mb-5">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#4A5D75] dark:text-[#9EADC8] mb-2 block">Your Name <span className="text-[#C98A8A]">*</span></label>
                <input
                  type="text"
                  value={userName}
                  onChange={e => setUserName(e.target.value)}
                  placeholder="What should we call you?"
                  className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl px-5 py-3 text-sm font-medium outline-none focus:border-[#6A829E] dark:text-neutral-100"
                />
                <p className="text-[10px] text-neutral-400 mt-1.5 font-medium">All agents will address you by this name.</p>
              </div>
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
          ) : (
            <div className="space-y-6">

              {/* Image Generation Tooling - Engineered UX */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-6">
                 <div>
                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-2 mb-1"><ImageIcon className="w-4 h-4 text-[#D4AA7D]" /> Image Engine</h4>
                    <p className="text-xs text-neutral-500 font-medium">Configure your preferred AI image generator API. Keys are stored locally.</p>
                 </div>

                 <div>
                    <label className="text-[10px] font-black uppercase opacity-50 mb-2 block tracking-widest">Provider</label>
                    <select value={appSettings.imageProvider} onChange={e => { setAppSettings((prev: any) => ({ ...prev, imageProvider: e.target.value, imageModelId: '', imageEndpoint: '' })); setImageTestState({loading:false, error:null, successUrl:null}); setImageEngineModels([]); }} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-bold">
                       <option value="none">Disabled</option>
                       <option value="openai">OpenAI (DALL-E & Compatible)</option>
                       <option value="google">Google (Imagen)</option>
                       <option value="custom">Custom Endpoint</option>
                    </select>
                 </div>

                 {/* Dynamic API Key Reveal & Testing */}
                 {appSettings.imageProvider !== 'none' && (
                    <div className="animate-in slide-in-from-top-2 fade-in duration-300 bg-neutral-50 dark:bg-neutral-950 p-4 rounded-2xl border border-neutral-100 dark:border-neutral-800 flex flex-col gap-4">

                       {/* Key Handling */}
                       {appSettings.imageProvider === 'google' && hasImplicitGoogleKey ? (
                          <div className="flex items-center gap-3 text-xs font-bold text-[#9FBBAF] bg-[#9FBBAF]/10 p-3 rounded-xl border border-[#9FBBAF]/20">
                             <ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting Google API Key from Chat Models.
                          </div>
                       ) : appSettings.imageProvider === 'openai' && hasImplicitOpenAIKey ? (
                          <div className="flex items-center gap-3 text-xs font-bold text-[#9FBBAF] bg-[#9FBBAF]/10 p-3 rounded-xl border border-[#9FBBAF]/20">
                             <ShieldCheck className="w-5 h-5 shrink-0" /> Active: Inheriting OpenAI API Key from Chat Models.
                          </div>
                       ) : (
                          <div className="flex flex-col gap-2">
                             <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">API Key</label>
                             <input
                                type="password"
                                value={
                                   appSettings.imageProvider === 'google' ? integrations.google?.apiKey || '' :
                                   appSettings.imageProvider === 'openai' ? integrations.openai?.apiKey || '' :
                                   integrations.customImage?.apiKey || ''
                                }
                                onChange={e => {
                                   const val = e.target.value;
                                   if (appSettings.imageProvider === 'google') setIntegrations((prev: any) => ({ ...prev, google: { apiKey: val } }));
                                   else if (appSettings.imageProvider === 'openai') setIntegrations((prev: any) => ({ ...prev, openai: { apiKey: val } }));
                                   else setIntegrations((prev: any) => ({ ...prev, customImage: { apiKey: val } }));
                                }}
                                placeholder={appSettings.imageProvider === 'google' ? "AIzaSy..." : "sk-..."}
                                className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-mono transition-all"
                             />
                          </div>
                       )}

                       {/* Custom Endpoint Field */}
                       {appSettings.imageProvider === 'custom' && (
                          <div className="flex flex-col gap-2">
                             <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Custom Base URL</label>
                             <input
                                type="text"
                                value={appSettings.imageEndpoint || ''}
                                onChange={e => setAppSettings((prev: any) => ({ ...prev, imageEndpoint: e.target.value }))}
                                placeholder="https://your-custom-endpoint.com/v1"
                                className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-mono transition-all"
                             />
                          </div>
                       )}

                       {/* Fetch Models & Model Selection */}
                       <div className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-4">
                           <div className="flex items-center justify-between">
                              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Target Model ID</label>
                              <button onClick={fetchImageModels} disabled={isFetchingImageModels || !activeImageKey} className="text-[10px] font-black uppercase tracking-widest text-[#4A5D75] hover:text-[#2C3E50] dark:text-[#9EADC8] dark:hover:text-white disabled:opacity-50 transition-all flex items-center gap-1">
                                  {isFetchingImageModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />} Fetch Models
                              </button>
                           </div>

                           {imageEngineModels.length > 0 ? (
                               <select value={appSettings.imageModelId || ''} onChange={e => setAppSettings((prev: any) => ({ ...prev, imageModelId: e.target.value }))} className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-bold transition-all">
                                   <option value="" disabled>Select a model...</option>
                                   {imageEngineModels.map(m => <option key={m} value={m}>{m}</option>)}
                               </select>
                           ) : (
                               <input
                                  type="text"
                                  value={appSettings.imageModelId || ''}
                                  onChange={e => setAppSettings((prev: any) => ({ ...prev, imageModelId: e.target.value }))}
                                  placeholder={appSettings.imageProvider === 'google' ? "e.g. imagen-3.0-generate-001" : "e.g. dall-e-3"}
                                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] font-mono transition-all"
                               />
                           )}
                       </div>

                       {/* TEST INTEGRATION BLOCK */}
                       <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 flex flex-col gap-3">
                          <button
                             onClick={testImageEngine}
                             disabled={imageTestState.loading || !activeImageKey || !appSettings.imageModelId}
                             className="flex items-center justify-center gap-2 w-full py-3 bg-[#F0F4F8] hover:bg-[#D6E0EA] text-[#4A5D75] dark:bg-[#1E2B38]/30 dark:hover:bg-[#1E2B38]/50 dark:text-[#9EADC8] rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                          >
                             {imageTestState.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                             {imageTestState.loading ? 'Testing...' : 'Test Connection (Cat in Banana Costume)'}
                          </button>

                          {imageTestState.loading && (
                              <div className="p-3 bg-[#4A5D75]/10 text-[#4A5D75] dark:text-[#9EADC8] rounded-xl border border-[#4A5D75]/20 text-xs font-bold leading-relaxed flex items-center gap-2 animate-pulse">
                                  <Loader2 className="w-4 h-4 animate-spin" /> Generating test image, please wait...
                              </div>
                          )}

                          {imageTestState.error && (
                              <div className="p-3 bg-[#C98A8A]/10 text-[#C98A8A] rounded-xl border border-[#C98A8A]/20 text-xs font-bold leading-relaxed">
                                  {imageTestState.error}
                              </div>
                          )}
                          {imageTestState.successUrl && (
                              <div className="p-2 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-sm text-center animate-in fade-in zoom-in-95">
                                  <img src={imageTestState.successUrl} alt="Test Success" className="w-full max-w-[200px] h-auto rounded-lg mx-auto mb-2 cursor-pointer" onClick={() => viewImageInCanvas(imageTestState.successUrl as string)} title="View full size in Canvas" />
                                  <span className="text-[10px] font-black uppercase tracking-widest text-[#9FBBAF] flex items-center justify-center gap-1 mt-2"><ShieldCheck className="w-3 h-3" /> Connection Successful</span>
                              </div>
                          )}
                       </div>
                    </div>
                 )}

                 {/* Output Preference */}
                 {appSettings.imageProvider !== 'none' && (
                     <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
                        <span className="text-[10px] font-black uppercase opacity-50 mb-3 block tracking-widest">Image Delivery Method</span>
                        <div className="flex bg-neutral-100 dark:bg-neutral-800 p-1.5 rounded-xl">
                           <button onClick={() => setAppSettings((prev: any) => ({ ...prev, defaultImageOutput: 'canvas' } as any))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${(appSettings as any).defaultImageOutput === 'canvas' ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75] dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}>Canvas Artifact</button>
                           <button onClick={() => setAppSettings((prev: any) => ({ ...prev, defaultImageOutput: 'document' } as any))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${(appSettings as any).defaultImageOutput === 'document' ? 'bg-white dark:bg-neutral-700 shadow-sm text-[#4A5D75] dark:text-white' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}>In-Chat Message</button>
                        </div>
                     </div>
                 )}
              </div>

              {/* Brave Search Integration */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                     <div className="flex items-center gap-3">
                         <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-xl shadow-sm border border-orange-100 dark:border-orange-800"><Globe className="w-5 h-5 text-orange-500" /></div>
                         <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Brave Search</span>
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">2,000 free/mo</span>
                            </div>
                            <span className="text-xs text-neutral-500 font-medium mt-0.5">Privacy-focused web search. Free tier included. <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer" className="text-[#6A829E] hover:underline font-bold inline-flex items-center gap-1">Get API Key <Link className="w-2.5 h-2.5"/></a></span>
                         </div>
                     </div>
                     <button onClick={() => setIntegrations((prev: any) => ({ ...prev, brave: { ...prev.brave, enabled: !prev.brave?.enabled } }))} className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${integrations.brave?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}>{integrations.brave?.enabled ? 'Enabled' : 'Enable'}</button>
                 </div>
                 {integrations.brave?.enabled && (
                    <div className="animate-in slide-in-from-top-2 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                       <input type="password" value={integrations.brave?.apiKey || ''} onChange={e => setIntegrations((prev: any) => ({ ...prev, brave: { ...prev.brave, apiKey: e.target.value } }))} placeholder="Paste your BSA... API key here" className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all" />
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

              {/* Slack Integration */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><MessageSquare className="w-5 h-5 text-[#6A829E]" /></div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Slack</span>
                      <span className="text-xs text-neutral-500 font-medium mt-0.5">Let agents search messages and post to channels. Requires a Slack bot token.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({ ...prev, slack: { ...prev.slack, enabled: !prev.slack?.enabled } }))}
                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 ${integrations.slack?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}
                  >{integrations.slack?.enabled ? 'Enabled' : 'Enable'}</button>
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
                      Create a Slack app at <span className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 rounded">api.slack.com/apps</span> → OAuth &amp; Permissions → add scopes: <span className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 rounded">channels:history, channels:read, chat:write, search:read</span> → install to workspace → copy Bot User OAuth Token.
                    </p>
                    {integrations.slack?.botToken && (
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#9FBBAF]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Token saved
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Google Workspace Integration — multi-account */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700 flex items-center gap-1">
                      <Mail className="w-4 h-4 text-[#C98A8A]" />
                      <FolderOpen className="w-4 h-4 text-[#D4AA7D]" />
                      <CalendarClock className="w-4 h-4 text-[#6A829E]" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">Google Workspace</span>
                      <span className="text-xs text-neutral-500 font-medium mt-0.5">Gmail · Drive · Calendar — add multiple accounts.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({
                      ...prev,
                      googleWorkspaces: [...(prev.googleWorkspaces ?? []), { id: `gw-${Date.now()}`, label: '', clientId: '', clientSecret: '', refreshToken: '', scopes: { gmail: false, drive: false, calendar: false } }]
                    }))}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-[#4A5D75] text-white hover:bg-[#3D4D61] transition-all shadow-sm shrink-0"
                  ><Plus className="w-3.5 h-3.5" /> Add Account</button>
                </div>

                {(integrations.googleWorkspaces ?? []).length === 0 && (
                  <p className="text-[10px] text-neutral-400 text-center py-2">No Google accounts added yet. Click "Add Account" to connect one.</p>
                )}

                {(integrations.googleWorkspaces ?? []).map((acct: any, idx: number) => (
                  <div key={acct.id} className="flex flex-col gap-3 pt-4 border-t border-neutral-100 dark:border-neutral-800 animate-in slide-in-from-top-2">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={acct.label}
                        onChange={e => setIntegrations((prev: any) => {
                          const arr = [...(prev.googleWorkspaces ?? [])];
                          arr[idx] = { ...arr[idx], label: e.target.value };
                          return { ...prev, googleWorkspaces: arr };
                        })}
                        placeholder="Account label (e.g. Work, Personal)"
                        className="flex-1 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#6A829E] font-bold transition-all"
                      />
                      <button
                        onClick={() => setIntegrations((prev: any) => ({
                          ...prev,
                          googleWorkspaces: (prev.googleWorkspaces ?? []).filter((_: any, i: number) => i !== idx)
                        }))}
                        className="p-2 text-neutral-400 hover:text-[#C98A8A] transition-colors"
                      ><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {[
                        { field: 'clientId', label: 'OAuth Client ID', placeholder: 'xxxx.apps.googleusercontent.com' },
                        { field: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'GOCSPX-...' },
                      ].map(f => (
                        <div key={f.field} className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{f.label}</label>
                          <input
                            type="password"
                            value={acct[f.field] || ''}
                            onChange={e => setIntegrations((prev: any) => {
                              const arr = [...(prev.googleWorkspaces ?? [])];
                              arr[idx] = { ...arr[idx], [f.field]: e.target.value };
                              return { ...prev, googleWorkspaces: arr };
                            })}
                            placeholder={f.placeholder}
                            className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Refresh Token</label>
                      <input
                        type="password"
                        value={acct.refreshToken || ''}
                        onChange={e => setIntegrations((prev: any) => {
                          const arr = [...(prev.googleWorkspaces ?? [])];
                          arr[idx] = { ...arr[idx], refreshToken: e.target.value };
                          return { ...prev, googleWorkspaces: arr };
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
                          const active = acct.scopes?.[scope.id];
                          return (
                            <button
                              key={scope.id}
                              onClick={() => setIntegrations((prev: any) => {
                                const arr = [...(prev.googleWorkspaces ?? [])];
                                arr[idx] = { ...arr[idx], scopes: { ...arr[idx].scopes, [scope.id]: !active } };
                                return { ...prev, googleWorkspaces: arr };
                              })}
                              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${active ? 'bg-[#F0F4F8] dark:bg-[#1E2B38]/40 border-[#4A5D75]/30 text-[#4A5D75] dark:text-[#9EADC8]' : 'border-neutral-200 dark:border-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}`}
                            >
                              <ScopeIcon className={`w-3.5 h-3.5 ${active ? scope.color : ''}`} />
                              {scope.label}
                              {active && <CheckCircle2 className="w-3 h-3 text-[#9FBBAF]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {acct.clientId && acct.refreshToken && (
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#9FBBAF]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Credentials saved
                      </div>
                    )}
                  </div>
                ))}

                {(integrations.googleWorkspaces ?? []).length > 0 && (
                  <p className="text-[10px] text-neutral-400 leading-relaxed pt-2 border-t border-neutral-100 dark:border-neutral-800">
                    <span className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 rounded">console.cloud.google.com</span> → project → enable Gmail/Drive/Calendar APIs → OAuth 2.0 Desktop credentials → run OAuth flow once → paste refresh token.
                  </p>
                )}
              </div>

              {/* GUS — Salesforce Agile Accelerator */}
              <div className="p-6 rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-100 dark:border-neutral-700"><Layers className="w-5 h-5 text-[#6A829E]" /></div>
                    <div className="flex flex-col">
                      <span className="text-sm font-black uppercase tracking-widest dark:text-neutral-200 block">GUS</span>
                      <span className="text-xs text-neutral-500 font-medium mt-0.5">Salesforce Agile Accelerator — query work items, stories, and sprints.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, enabled: !prev.gus?.enabled } }))}
                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm shrink-0 ${integrations.gus?.enabled ? 'bg-[#DCE7E1] text-[#7A9E8D] dark:bg-[#2C3E35]/30 dark:text-[#B5CDBF]' : 'bg-[#4A5D75] text-white hover:bg-[#3D4D61]'}`}
                  >{integrations.gus?.enabled ? 'Enabled' : 'Enable'}</button>
                </div>
                {integrations.gus?.enabled && (
                  <div className="animate-in slide-in-from-top-2 pt-4 border-t border-neutral-100 dark:border-neutral-800 flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Salesforce Instance URL</label>
                      <input
                        type="text"
                        value={integrations.gus?.instanceUrl || ''}
                        onChange={e => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, instanceUrl: e.target.value } }))}
                        placeholder="https://yourorg.my.salesforce.com"
                        className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Access Token / Session ID</label>
                      <input
                        type="password"
                        value={integrations.gus?.accessToken || ''}
                        onChange={e => setIntegrations((prev: any) => ({ ...prev, gus: { ...prev.gus, accessToken: e.target.value } }))}
                        placeholder="00Dxx0000..."
                        className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#6A829E] font-mono transition-all"
                      />
                    </div>
                    <p className="text-[10px] text-neutral-400 leading-relaxed">
                      Get a session token via Salesforce CLI: <span className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 rounded">sf org display --target-org &lt;alias&gt;</span> and copy the Access Token. Or create a Connected App with OAuth to get a long-lived token.
                    </p>
                    {integrations.gus?.instanceUrl && integrations.gus?.accessToken && (
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#9FBBAF]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Credentials saved
                      </div>
                    )}
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
