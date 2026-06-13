import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Zap, Loader2, ImageIcon, CheckCircle2, PlusCircle, Cloud, Cpu } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { ModelStorePanel } from './ModelStorePanel';

interface ModelWizardModalProps {
  onToggleModelSelection: (m: any) => void;
  onBulkAdd: () => void;
  onFetchModels: () => void;
  onProviderChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onAddSingleLLM: (model: any) => void;
}

const CLOUD_PROVIDERS = [
  { value: 'openai',      label: 'OpenAI' },
  { value: 'anthropic',   label: 'Anthropic (Claude)' },
  { value: 'google',      label: 'Google (Gemini)' },
  { value: 'huggingface', label: 'Hugging Face' },
];

interface RecModel { id: string; name: string; context: number; badge?: string }

const RECOMMENDED_MODELS: Record<string, RecModel[]> = {
  openai: [
    { id: 'gpt-4o',         name: 'GPT-4o',         context: 128000,   badge: 'Best all-rounder' },
    { id: 'gpt-4o-mini',    name: 'GPT-4o Mini',    context: 128000,   badge: 'Fast · cheap' },
    { id: 'o4-mini',        name: 'o4-mini',         context: 100000,   badge: 'Reasoning' },
    { id: 'gpt-4.1',        name: 'GPT-4.1',         context: 1047576,  badge: '' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', context: 200000, badge: 'Recommended' },
    { id: 'claude-opus-4-5',   name: 'Claude Opus 4.5',   context: 200000, badge: 'Most capable' },
    { id: 'claude-haiku-3-5',  name: 'Claude 3.5 Haiku',  context: 200000, badge: 'Fast' },
  ],
  google: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', context: 1000000, badge: 'Free · recommended' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', context: 1000000, badge: 'Thinking' },
    { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   context: 2000000, badge: 'Most capable' },
  ],
  huggingface: [
    { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B',   context: 128000, badge: '' },
    { id: 'mistralai/Mistral-7B-Instruct-v0.3',    name: 'Mistral 7B',     context: 32000,  badge: '' },
    { id: 'microsoft/phi-4',                        name: 'Phi-4',          context: 16384,  badge: 'Compact' },
  ],
};

const PROVIDER_KEY_URLS: Record<string, string> = {
  openai:      'https://platform.openai.com/api-keys',
  anthropic:   'https://console.anthropic.com/settings/keys',
  google:      'https://aistudio.google.com/apikey',
  huggingface: 'https://huggingface.co/settings/tokens',
};

const FREE_NOTE: Record<string, string> = {
  google: 'gemini-2.0-flash is free with generous rate limits',
};

export function ModelWizardModal({
  onToggleModelSelection,
  onBulkAdd,
  onFetchModels,
  onProviderChange,
  onAddSingleLLM,
}: ModelWizardModalProps) {
  const [ramMb, setRamMb] = useState(0);
  const [isAppleSilicon, setIsAppleSilicon] = useState<boolean | undefined>(undefined);
  const editingModel = useSettingsStore(s => s.editingModel);
  const modelTab = useSettingsStore(s => s.modelTab);
  const fetchedModels = useSettingsStore(s => s.fetchedModels);
  const modelSearchQuery = useSettingsStore(s => s.modelSearchQuery);
  const isFetchingModels = useSettingsStore(s => s.isFetchingModels);
  const fetchModelsError = useSettingsStore(s => s.fetchModelsError);
  const pendingModelSelections = useSettingsStore(s => s.pendingModelSelections);
  const { setEditingModel, setModelSearchQuery, setShowModelWizard, setWizardStep, setModelTab } = useSettingsStore.getState();

  const currentProvider = CLOUD_PROVIDERS.some(p => p.value === editingModel.provider)
    ? editingModel.provider
    : 'google';

  // Auto-select first recommended model when tab opens or provider changes
  useEffect(() => {
    if (modelTab !== 'cloud' || fetchedModels.length > 0) return;
    const recs = RECOMMENDED_MODELS[currentProvider] ?? [];
    if (recs.length === 0) return;
    const alreadySelected = recs.some((r: RecModel) => r.id === editingModel.modelId);
    if (!alreadySelected) {
      const first = recs[0];
      setEditingModel((prev: any) => ({
        ...prev,
        modelId: first.id,
        contextLimit: first.context,
        name: first.name,
      }));
    }
  }, [currentProvider, modelTab]);

  useEffect(() => {
    invoke<{ total_mb: number; is_apple_silicon: boolean }>('get_hardware_summary')
      .then(r => { setRamMb(r.total_mb); setIsAppleSilicon(r.is_apple_silicon); })
      .catch(() => {});
  }, []);

  const onClose = () => { setShowModelWizard(false); setWizardStep(3); };

  function handleModelReady(newModel: any) {
    const store = useSettingsStore.getState();
    store.setModels((prev: any[]) => {
      if (prev.some((m: any) => m.id === newModel.id)) return prev;
      return [...prev, newModel];
    });
    store.setSelectedModelId(newModel.id);
    store.setModelValidation((prev: any) => ({ ...prev, [newModel.id]: 'ok' }));
    store.persist();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200 text-ink">
      <div className="bg-panel-2 w-full max-w-lg rounded-[2rem] p-8 shadow-2xl border border-edge max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">

        {/* Header */}
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-xl"><Zap className="w-6 h-6 text-on-accent" /></div>
            <h3 className="text-xl font-black tracking-tighter uppercase">Connect LLM</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-wash rounded-full"><X className="w-5 h-5" /></button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 mb-6 shrink-0 bg-inset p-1 rounded-xl">
          <button
            onClick={() => { setModelTab('cloud'); onProviderChange({ target: { value: 'google' } } as React.ChangeEvent<HTMLSelectElement>); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${modelTab === 'cloud' ? 'bg-panel text-accent shadow-sm' : 'text-ink-3 hover:text-ink-2'}`}
          >
            <Cloud className="w-3.5 h-3.5" /> Cloud API
          </button>
          <button
            onClick={() => setModelTab('local')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${modelTab === 'local' ? 'bg-panel text-accent shadow-sm' : 'text-ink-3 hover:text-ink-2'}`}
          >
            <Cpu className="w-3.5 h-3.5" /> Local AI
          </button>
        </div>

        {/* ── Cloud tab ── */}
        {modelTab === 'cloud' && (
          <div className="flex flex-col flex-1 animate-in slide-in-from-left-2 duration-200 space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-ink-3 shrink-0">Cloud / API Provider</h4>

            <select
              value={currentProvider}
              onChange={onProviderChange}
              className="w-full bg-inset border-2 border-edge rounded-xl px-4 py-3 text-xs outline-none focus:border-accent font-bold shrink-0"
            >
              {CLOUD_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>

            <div className="shrink-0">
              <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Endpoint URL (optional override)</label>
              <input
                type="text"
                placeholder="e.g. https://api.openai.com/v1"
                value={editingModel.endpoint}
                onChange={e => setEditingModel((prev: any) => ({ ...prev, endpoint: e.target.value }))}
                className="w-full bg-inset border-2 border-edge rounded-xl px-4 py-3 text-xs outline-none focus:border-accent font-mono placeholder:font-sans"
              />
            </div>

            <div className="relative shrink-0">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-black uppercase opacity-50">API Key</label>
                {PROVIDER_KEY_URLS[currentProvider] && (
                  <button
                    onClick={() => window.open(PROVIDER_KEY_URLS[currentProvider], '_blank')}
                    className="text-[9px] font-black text-accent hover:underline"
                  >
                    {FREE_NOTE[currentProvider] ? 'Get free key →' : 'Get key →'}
                  </button>
                )}
              </div>
              {FREE_NOTE[currentProvider] && (
                <p className="text-[9px] font-bold text-success mb-1.5">
                  ✓ {FREE_NOTE[currentProvider]}
                </p>
              )}
              <input
                type="password"
                placeholder="sk-…"
                value={editingModel.apiKey}
                onChange={e => setEditingModel((prev: any) => ({ ...prev, apiKey: e.target.value }))}
                className="w-full bg-inset border-2 border-edge rounded-xl px-4 py-3 text-xs outline-none focus:border-accent font-mono pr-28"
              />
              <button onClick={onFetchModels} disabled={isFetchingModels} className="absolute right-2 bottom-1.5 px-3 py-1.5 bg-inset rounded-lg text-[9px] font-black uppercase text-accent hover:bg-accent-soft/50 transition-all disabled:opacity-50">
                {isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : fetchedModels.length > 0 ? 'Refresh' : 'Fetch all'}
              </button>
            </div>

            <ModelListOrManual
              fetchedModels={fetchedModels}
              modelSearchQuery={modelSearchQuery}
              setModelSearchQuery={setModelSearchQuery}
              pendingModelSelections={pendingModelSelections}
              onToggleModelSelection={onToggleModelSelection}
              onBulkAdd={onBulkAdd}
              onAddSingleLLM={onAddSingleLLM}
              editingModel={editingModel}
              setEditingModel={setEditingModel}
              fetchModelsError={fetchModelsError}
              provider={currentProvider}
            />
          </div>
        )}

        {/* ── Local tab ── */}
        {modelTab === 'local' && (
          <div className="flex flex-col flex-1 animate-in slide-in-from-right-2 duration-200">
            <ModelStorePanel ramMb={ramMb} isAppleSilicon={isAppleSilicon} onModelReady={handleModelReady} />
          </div>
        )}
      </div>
    </div>
  );
}

// Shared model list / manual entry — used by the cloud tab
function ModelListOrManual({ fetchedModels, modelSearchQuery, setModelSearchQuery, pendingModelSelections, onToggleModelSelection, onBulkAdd, onAddSingleLLM, editingModel, setEditingModel, fetchModelsError, provider }: any) {
  const [showManual, setShowManual] = useState(false);

  if (fetchModelsError) {
    return <p className="text-[10px] text-danger shrink-0">{fetchModelsError}</p>;
  }

  if (fetchedModels.length > 0) {
    return (
      <div className="flex flex-col flex-1 min-h-[30vh] space-y-3 animate-in slide-in-from-top-2">
        <label className="text-[10px] font-black uppercase text-ink-3 px-2 tracking-widest shrink-0">Tap to select models to import:</label>
        <div className="px-2 shrink-0">
          <input
            type="text"
            placeholder="Search models..."
            value={modelSearchQuery}
            onChange={e => setModelSearchQuery(e.target.value)}
            className="w-full bg-inset border-none rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-accent/50 font-bold"
          />
        </div>
        <div className="flex-1 overflow-y-auto border-2 border-edge p-2 rounded-2xl bg-inset space-y-2 custom-scrollbar min-h-[200px] max-h-[40vh]">
          {fetchedModels
            .filter((m: any) => m.id.toLowerCase().includes(modelSearchQuery.toLowerCase()))
            .map((m: any) => {
              const isSelected = pendingModelSelections.some((p: any) => p.id === m.id);
              return (
                <button key={m.id} onClick={() => onToggleModelSelection(m)} className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-accent bg-accent-soft/40 shadow-sm' : 'border-transparent hover:bg-wash'}`}>
                  <div className="flex flex-col text-left overflow-hidden">
                    <div className="flex items-center gap-1.5">
                      {m.id.includes('dall-e') || m.id.includes('image') ? <span title="Image Generation Model"><ImageIcon className="w-3 h-3 text-warning" /></span> : null}
                      <span className="text-xs font-bold truncate text-ink">{m.id}</span>
                    </div>
                    <span className="text-[9px] font-black text-accent uppercase tracking-tight">Limit: {m.context.toLocaleString()} tokens</span>
                  </div>
                  {isSelected ? <CheckCircle2 className="w-5 h-5 text-accent shrink-0" /> : <PlusCircle className="w-5 h-5 text-ink-3 shrink-0" />}
                </button>
              );
            })}
        </div>
        <button onClick={onBulkAdd} disabled={pendingModelSelections.length === 0} className="shrink-0 w-full py-5 bg-accent text-on-accent rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-accent-strong active:scale-95 transition-all disabled:opacity-50">
          Add {pendingModelSelections.length} Model(s)
        </button>
      </div>
    );
  }

  // ── Recommended models (empty state — shown before "Fetch all") ──
  const recs: RecModel[] = RECOMMENDED_MODELS[provider] ?? [];

  return (
    <div className="space-y-4 shrink-0">
      {recs.length > 0 && (
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-ink-3 mb-2 block">Available models</label>
          <div className="space-y-1.5 rounded-2xl border-2 border-edge p-1.5 bg-inset">
            {recs.map((m: RecModel) => {
              const isSelected = editingModel.modelId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setEditingModel((prev: any) => ({
                    ...prev,
                    modelId: m.id,
                    contextLimit: m.context,
                    name: m.name,
                  }))}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left ${
                    isSelected
                      ? 'border-accent bg-accent-soft/40 shadow-sm'
                      : 'border-transparent hover:bg-wash'
                  }`}
                >
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-xs font-bold text-ink truncate">{m.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] font-mono text-ink-3 truncate">{m.id}</span>
                      {m.badge && (
                        <span className="text-[9px] font-black text-accent shrink-0">{m.badge}</span>
                      )}
                    </div>
                  </div>
                  {isSelected
                    ? <CheckCircle2 className="w-4 h-4 text-accent shrink-0 ml-2" />
                    : <PlusCircle className="w-4 h-4 text-ink-3 shrink-0 ml-2" />
                  }
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Connect CTA */}
      <button
        onClick={() => onAddSingleLLM({ ...editingModel, name: editingModel.name || editingModel.modelId })}
        disabled={!editingModel.modelId}
        className="w-full py-5 bg-accent text-on-accent rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-accent-strong active:scale-95 transition-all disabled:opacity-50"
      >
        {editingModel.modelId
          ? `Connect ${editingModel.name || editingModel.modelId}`
          : 'Select a model above'}
      </button>

      {/* Manual entry toggle */}
      <button
        onClick={() => setShowManual((v: boolean) => !v)}
        className="text-[9px] font-black uppercase tracking-widest text-ink-3 hover:text-ink-2 w-full text-center transition-colors"
      >
        {showManual ? '▲ hide manual entry' : '▾ enter model ID manually'}
      </button>

      {showManual && (
        <div className="space-y-3 pt-1 animate-in slide-in-from-top-1 duration-150">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Model ID</label>
              <input type="text" placeholder="e.g. llama-3, dall-e-3" value={editingModel.modelId} onChange={e => setEditingModel((prev: any) => ({ ...prev, modelId: e.target.value }))} className="w-full bg-inset border-2 border-edge rounded-xl px-4 py-3 text-xs outline-none focus:border-accent font-mono" />
            </div>
            <div className="w-1/3">
              <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Context Limit</label>
              <input type="number" placeholder="32000" value={editingModel.contextLimit} onChange={e => setEditingModel((prev: any) => ({ ...prev, contextLimit: parseInt(e.target.value) || 0 }))} className="w-full bg-inset border-2 border-edge rounded-xl px-4 py-3 text-xs outline-none focus:border-accent font-mono" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Display Name</label>
            <input type="text" placeholder="Custom Model" value={editingModel.name} onChange={e => setEditingModel((prev: any) => ({ ...prev, name: e.target.value }))} className="w-full bg-inset border-2 border-edge rounded-xl px-4 py-3 text-xs outline-none font-bold focus:border-accent" />
          </div>
        </div>
      )}
    </div>
  );
}
