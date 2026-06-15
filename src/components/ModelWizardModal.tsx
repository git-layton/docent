import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Zap, Loader2, ImageIcon, CheckCircle2, PlusCircle, Cpu, ArrowRight, ExternalLink } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useSettingsStore } from '../store/useSettingsStore';
import { ModelStorePanel } from './ModelStorePanel';
import { recommendSetup } from '../data/modelCatalog';

// Linked (not asserted) so users verify what's free themselves — keeps us out of pricing claims.
const GOOGLE_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing';

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
    { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash',      context: 1000000, badge: 'Recommended' },
    { id: 'gemini-2.5-pro',        name: 'Gemini 2.5 Pro',        context: 1000000, badge: 'Most capable' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', context: 1000000, badge: 'Fastest' },
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
  google: "Gemini has a free tier — check Google's current pricing",
};

export function ModelWizardModal({
  onToggleModelSelection,
  onBulkAdd,
  onFetchModels,
  onProviderChange,
  onAddSingleLLM,
}: ModelWizardModalProps) {
  const [ramMb, setRamMb] = useState(0);
  const [chip, setChip] = useState('');
  const [isAppleSilicon, setIsAppleSilicon] = useState<boolean | undefined>(undefined);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const editingModel = useSettingsStore(s => s.editingModel);
  const fetchedModels = useSettingsStore(s => s.fetchedModels);
  const modelSearchQuery = useSettingsStore(s => s.modelSearchQuery);
  const isFetchingModels = useSettingsStore(s => s.isFetchingModels);
  const fetchModelsError = useSettingsStore(s => s.fetchModelsError);
  const pendingModelSelections = useSettingsStore(s => s.pendingModelSelections);
  const { setEditingModel, setModelSearchQuery, setShowModelWizard, setWizardStep } = useSettingsStore.getState();

  const currentProvider = CLOUD_PROVIDERS.some(p => p.value === editingModel.provider)
    ? editingModel.provider
    : 'google';

  // Auto-select first recommended model when the advanced cloud form opens or the provider changes
  useEffect(() => {
    if (!showAdvanced || fetchedModels.length > 0) return;
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
  }, [currentProvider, showAdvanced]);

  useEffect(() => {
    invoke<{ total_mb: number; chip: string; is_apple_silicon: boolean }>('get_hardware_summary')
      .then(r => { setRamMb(r.total_mb); setChip(r.chip); setIsAppleSilicon(r.is_apple_silicon); })
      .catch(() => setIsAppleSilicon(false));
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

  // Jump straight into the cloud form, pre-set to Google's free Gemini tier.
  function useGeminiFree() {
    onProviderChange({ target: { value: 'google' } } as React.ChangeEvent<HTMLSelectElement>);
    setShowAdvanced(true);
  }

  const gb = ramMb / 1024;
  const rec = isAppleSilicon === undefined
    ? null
    : recommendSetup({ totalMb: ramMb, isAppleSilicon });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200 text-ink">
      <div className="bg-panel-2 w-full max-w-2xl rounded-[2rem] p-8 shadow-2xl border border-edge max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col">

        {/* Header */}
        <div className="flex justify-between items-center mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-xl"><Zap className="w-6 h-6 text-on-accent" /></div>
            <h3 className="text-xl font-black tracking-tighter uppercase">Connect a model</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-wash rounded-full"><X className="w-5 h-5" /></button>
        </div>

        {/* Scanning hardware */}
        {!rec && (
          <div className="flex items-center gap-2 text-xs text-ink-2 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Scanning your Mac…
          </div>
        )}

        {rec && (
          <div className="flex flex-col flex-1 space-y-4 animate-in fade-in duration-200">

            {/* Detected hardware */}
            {chip && (
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-ink-2">Detected:</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-inset border border-edge text-xs font-mono font-bold text-ink-2">
                  {chip} · {Math.round(gb)}GB RAM
                </span>
              </div>
            )}

            {/* ── The recommendation: privacy ↔ smarts trade-off, both shown, the fit highlighted ── */}
            <p className="text-xs text-ink leading-relaxed shrink-0">
              Two good ways to start — it's a trade-off between <strong>privacy</strong> and <strong>smarts</strong>:
            </p>
            {rec.kind === 'cloud' && rec.reason && (
              <p className="text-[11px] text-ink-3 leading-relaxed -mt-2 shrink-0">{rec.reason}</p>
            )}
            {(() => {
              const localPick = rec.kind === 'local';
              const Local = (
                <div key="local" className={`rounded-2xl border-2 p-4 space-y-2 ${localPick ? 'border-accent bg-accent-soft/30' : 'border-edge'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Cpu className="w-4 h-4 text-ink-2" />
                    <p className="text-sm font-black text-ink">Run on your Mac</p>
                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-secondary/15 text-secondary shrink-0">Private</span>
                    {localPick && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent text-on-accent shrink-0">Best for your Mac</span>}
                  </div>
                  <p className="text-xs text-ink-2 leading-relaxed">
                    Stays on your device, works offline, free — nothing leaves your computer. As smart as your {chip || 'Mac'} can run.
                  </p>
                  <p className="text-[10px] font-bold text-ink-3">📄 ~32K-token context (the on-device engine's limit)</p>
                  <ModelStorePanel ramMb={ramMb} isAppleSilicon={isAppleSilicon} onModelReady={handleModelReady} mode="recommended" />
                </div>
              );
              const Cloud = (
                <div key="cloud" className={`rounded-2xl border-2 p-4 space-y-2 ${!localPick ? 'border-accent bg-accent-soft/30' : 'border-edge'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">✨</span>
                    <p className="text-sm font-black text-ink">Gemini 2.5 Flash</p>
                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-inset text-ink-3 shrink-0">Cloud</span>
                    <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-success-soft text-success shrink-0">Free tier</span>
                    {!localPick && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent text-on-accent shrink-0">Best for your Mac</span>}
                  </div>
                  <p className="text-xs text-ink-2 leading-relaxed">
                    Smarter than local on most Macs, instant, no download. The trade-off: your messages go to Google.
                  </p>
                  <p className="text-[10px] font-bold text-ink-3">📄 1M-token context — whole codebases & long PDFs</p>
                  <button
                    onClick={() => openUrl(GOOGLE_PRICING_URL)}
                    className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-accent hover:underline"
                  >
                    See what's free <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={useGeminiFree}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-accent text-on-accent rounded-2xl font-black text-xs uppercase tracking-widest shadow-md hover:bg-accent-strong active:scale-[0.98] transition-all"
                  >
                    Use Gemini <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              );
              return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start shrink-0">{localPick ? [Local, Cloud] : [Cloud, Local]}</div>;
            })()}

            {/* ── Advanced: pick any provider / endpoint ── */}
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="text-[10px] font-black uppercase tracking-widest text-ink-3 hover:text-ink-2 text-left transition-colors shrink-0 pt-1"
            >
              {showAdvanced ? '▲ Hide providers & custom endpoint' : '▾ Browse all providers (Claude, OpenAI, custom endpoint…)'}
            </button>

            {showAdvanced && (
              <div className="space-y-4 animate-in slide-in-from-top-2 duration-200 border-t border-edge pt-4">
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
                        onClick={() => openUrl(PROVIDER_KEY_URLS[currentProvider])}
                        className="inline-flex items-center gap-1 text-[9px] font-black text-accent hover:underline"
                      >
                        Get key <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                  {FREE_NOTE[currentProvider] && (
                    <p className="text-[9px] font-bold text-ink-3 mb-1.5">
                      {FREE_NOTE[currentProvider]}
                      {currentProvider === 'google' && (
                        <button onClick={() => openUrl(GOOGLE_PRICING_URL)} className="ml-1 text-accent hover:underline">
                          pricing →
                        </button>
                      )}
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
          </div>
        )}
      </div>
    </div>
  );
}

// Shared model list / manual entry — used by the advanced cloud form
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
