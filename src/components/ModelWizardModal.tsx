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

export function ModelWizardModal({
  onToggleModelSelection,
  onBulkAdd,
  onFetchModels,
  onProviderChange,
  onAddSingleLLM,
}: ModelWizardModalProps) {
  const [ramMb, setRamMb] = useState(0);
  const editingModel = useSettingsStore(s => s.editingModel);
  const modelTab = useSettingsStore(s => s.modelTab);
  const fetchedModels = useSettingsStore(s => s.fetchedModels);
  const modelSearchQuery = useSettingsStore(s => s.modelSearchQuery);
  const isFetchingModels = useSettingsStore(s => s.isFetchingModels);
  const fetchModelsError = useSettingsStore(s => s.fetchModelsError);
  const pendingModelSelections = useSettingsStore(s => s.pendingModelSelections);
  const { setEditingModel, setModelSearchQuery, setShowModelWizard, setWizardStep, setModelTab } = useSettingsStore.getState();

  useEffect(() => {
    invoke<{ total_mb: number }>('get_ram_stats')
      .then(r => setRamMb(r.total_mb))
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200 text-neutral-900 dark:text-white">
      <div className="bg-white dark:bg-neutral-900 w-full max-w-lg rounded-[2rem] p-8 shadow-2xl border border-neutral-200 dark:border-neutral-800 max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">

        {/* Header */}
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#4A5D75] rounded-xl"><Zap className="w-6 h-6 text-white" /></div>
            <h3 className="text-xl font-black tracking-tighter uppercase">Connect LLM</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full"><X className="w-5 h-5" /></button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 mb-6 shrink-0 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-xl">
          <button
            onClick={() => { setModelTab('cloud'); onProviderChange({ target: { value: 'openai' } } as React.ChangeEvent<HTMLSelectElement>); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${modelTab === 'cloud' ? 'bg-white dark:bg-neutral-700 text-[#4A5D75] shadow-sm' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}`}
          >
            <Cloud className="w-3.5 h-3.5" /> Cloud API
          </button>
          <button
            onClick={() => { setModelTab('local'); handleLocalProviderSelect('lmstudio'); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${modelTab === 'local' ? 'bg-white dark:bg-neutral-700 text-[#4A5D75] shadow-sm' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}`}
          >
            <Cpu className="w-3.5 h-3.5" /> Local AI
          </button>
        </div>

        {/* ── Cloud tab ── */}
        {modelTab === 'cloud' && (
          <div className="flex flex-col flex-1 animate-in slide-in-from-left-2 duration-200 space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 shrink-0">Cloud / API Provider</h4>

            <select
              value={CLOUD_PROVIDERS.some(p => p.value === editingModel.provider) ? editingModel.provider : 'openai'}
              onChange={onProviderChange}
              className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-bold shrink-0"
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
                className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono placeholder:font-sans"
              />
            </div>

            <div className="relative shrink-0">
              <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">API Key</label>
              <input
                type="password"
                placeholder="sk-…"
                value={editingModel.apiKey}
                onChange={e => setEditingModel((prev: any) => ({ ...prev, apiKey: e.target.value }))}
                className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono pr-28"
              />
              <button onClick={onFetchModels} disabled={isFetchingModels} className="absolute right-2 bottom-1.5 px-3 py-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg text-[9px] font-black uppercase text-[#4A5D75] dark:text-[#899AB5] hover:bg-[#D6E0EA] dark:hover:bg-[#1E2B38]/20 transition-all disabled:opacity-50">
                {isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Fetch Models'}
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
            />
          </div>
        )}

        {/* ── Local tab ── */}
        {modelTab === 'local' && (
          <div className="flex flex-col flex-1 animate-in slide-in-from-right-2 duration-200 space-y-4">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 shrink-0">Local AI Server</h4>

            {/* Provider buttons */}
            <div className="grid grid-cols-3 gap-2 shrink-0">
              {LOCAL_PROVIDERS.map(p => (
                <button
                  key={p.value}
                  onClick={() => handleLocalProviderSelect(p.value)}
                  className={`py-2.5 px-3 rounded-xl border-2 text-[10px] font-black uppercase tracking-wide transition-all ${editingModel.provider === p.value ? 'border-[#4A5D75] bg-[#F0F4F8] dark:bg-[#1E2B38]/20 text-[#4A5D75]' : 'border-neutral-200 dark:border-neutral-700 text-neutral-400 hover:border-[#9EADC8]'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {localProvider && (
              <div className="bg-[#F0F4F8] dark:bg-[#1A2433] rounded-xl px-4 py-3 text-[10px] text-[#6A829E] font-medium leading-relaxed shrink-0">
                {localProvider.hint}
              </div>
            )}

            <div className="shrink-0">
              <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Endpoint URL</label>
              <input
                type="text"
                value={editingModel.endpoint}
                onChange={e => setEditingModel((prev: any) => ({ ...prev, endpoint: e.target.value }))}
                className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono"
              />
            </div>

            <div className="relative shrink-0">
              <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">API Key (not required for local)</label>
              <input
                type="password"
                placeholder="optional"
                value={editingModel.apiKey}
                onChange={e => setEditingModel((prev: any) => ({ ...prev, apiKey: e.target.value }))}
                className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono pr-28"
              />
              <button onClick={onFetchModels} disabled={isFetchingModels} className="absolute right-2 bottom-1.5 px-3 py-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg text-[9px] font-black uppercase text-[#4A5D75] dark:text-[#899AB5] hover:bg-[#D6E0EA] transition-all disabled:opacity-50">
                {isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Fetch Models'}
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
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Shared model list / manual entry — used by both tabs
function ModelListOrManual({ fetchedModels, modelSearchQuery, setModelSearchQuery, pendingModelSelections, onToggleModelSelection, onBulkAdd, onAddSingleLLM, editingModel, setEditingModel, fetchModelsError }: any) {
  if (fetchModelsError) {
    return <p className="text-[10px] text-[#C98A8A] shrink-0">{fetchModelsError}</p>;
  }

  if (fetchedModels.length > 0) {
    return (
      <div className="flex flex-col flex-1 min-h-[30vh] space-y-3 animate-in slide-in-from-top-2">
        <label className="text-[10px] font-black uppercase text-neutral-400 px-2 tracking-widest shrink-0">Tap to select models to import:</label>
        <div className="px-2 shrink-0">
          <input
            type="text"
            placeholder="Search models..."
            value={modelSearchQuery}
            onChange={e => setModelSearchQuery(e.target.value)}
            className="w-full bg-neutral-100 dark:bg-neutral-800 border-none rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#6A829E]/50 font-bold"
          />
        </div>
        <div className="flex-1 overflow-y-auto border-2 dark:border-neutral-800 p-2 rounded-2xl bg-neutral-50 dark:bg-neutral-950 space-y-2 custom-scrollbar min-h-[200px] max-h-[40vh]">
          {fetchedModels
            .filter((m: any) => m.id.toLowerCase().includes(modelSearchQuery.toLowerCase()))
            .map((m: any) => {
              const isSelected = pendingModelSelections.some((p: any) => p.id === m.id);
              return (
                <button key={m.id} onClick={() => onToggleModelSelection(m)} className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${isSelected ? 'border-[#4A5D75] bg-[#F0F4F8] dark:bg-[#1E2B38]/20 shadow-sm' : 'border-transparent hover:bg-white dark:hover:bg-neutral-800'}`}>
                  <div className="flex flex-col text-left overflow-hidden">
                    <div className="flex items-center gap-1.5">
                      {m.id.includes('dall-e') || m.id.includes('image') ? <span title="Image Generation Model"><ImageIcon className="w-3 h-3 text-[#D4AA7D]" /></span> : null}
                      <span className="text-xs font-bold truncate text-neutral-800 dark:text-neutral-100">{m.id}</span>
                    </div>
                    <span className="text-[9px] font-black text-[#6A829E] uppercase tracking-tight">Limit: {m.context.toLocaleString()} tokens</span>
                  </div>
                  {isSelected ? <CheckCircle2 className="w-5 h-5 text-[#4A5D75] shrink-0" /> : <PlusCircle className="w-5 h-5 text-neutral-300 shrink-0" />}
                </button>
              );
            })}
        </div>
        <button onClick={onBulkAdd} disabled={pendingModelSelections.length === 0} className="shrink-0 w-full py-5 bg-[#4A5D75] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-[#3D4D61] active:scale-95 transition-all disabled:opacity-50">
          Add {pendingModelSelections.length} Model(s)
        </button>
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-4 shrink-0">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Model ID</label>
          <input type="text" placeholder="e.g. llama-3, dall-e-3" value={editingModel.modelId} onChange={e => setEditingModel((prev: any) => ({ ...prev, modelId: e.target.value }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono" />
        </div>
        <div className="w-1/3">
          <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Context Limit</label>
          <input type="number" placeholder="32000" value={editingModel.contextLimit} onChange={e => setEditingModel((prev: any) => ({ ...prev, contextLimit: parseInt(e.target.value) || 0 }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none focus:border-[#6A829E] font-mono" />
        </div>
      </div>
      <div>
        <label className="text-[10px] font-black uppercase opacity-50 mb-1 block">Display Name</label>
        <input type="text" placeholder="Custom Model" value={editingModel.name} onChange={e => setEditingModel((prev: any) => ({ ...prev, name: e.target.value }))} className="w-full bg-neutral-50 dark:bg-neutral-800 border-2 border-neutral-100 dark:border-neutral-700 rounded-xl px-4 py-3 text-xs outline-none font-bold focus:border-[#6A829E]" />
      </div>
      <button onClick={() => onAddSingleLLM({ ...editingModel, name: editingModel.name || editingModel.modelId })} disabled={!editingModel.modelId} className="w-full py-4 bg-[#4A5D75] text-white rounded-xl font-black text-xs uppercase hover:bg-[#3D4D61] disabled:opacity-50 transition-all active:scale-95 shadow-md">
        Connect Single LLM
      </button>
    </div>
  );
}
