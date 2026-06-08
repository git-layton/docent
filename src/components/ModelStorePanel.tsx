import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Download, CheckCircle, Loader2, AlertCircle, ExternalLink, Zap, Search } from 'lucide-react';
import { MODEL_CATALOG, type CatalogModel } from '../data/modelCatalog';

type ModelStatus = 'idle' | 'downloaded' | 'downloading' | 'installing' | 'ready' | 'error';

interface ModelState {
  status: ModelStatus;
  pct?: number;
  downloadedMb?: number;
  totalMb?: number;
  error?: string;
  endpoint?: string;
}

interface ModelStorePanelProps {
  ramMb: number;
  onModelReady: (model: any) => void;
}

const DEFAULT_PORT = 8080;

function genId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ModelStorePanel({ ramMb, onModelReady }: ModelStorePanelProps) {
  const [states, setStates] = useState<Record<string, ModelState>>({});
  const [search, setSearch] = useState('');
  const unlistenRef = useRef<(() => void) | null>(null);
  const ramGb = Math.floor(ramMb / 1024);

  const setModelState = (id: string, patch: Partial<ModelState>) =>
    setStates(prev => ({ ...prev, [id]: { ...(prev[id] ?? { status: 'idle' }), ...patch } }));

  useEffect(() => {
    // Mark already-downloaded models
    invoke<{ filename: string; size_mb: number }[]>('list_gguf_models').then(downloaded => {
      const names = new Set(downloaded.map(d => d.filename));
      setStates(prev => {
        const next = { ...prev };
        for (const m of MODEL_CATALOG) {
          if (names.has(m.ggufFilename) && !next[m.id]) {
            next[m.id] = { status: 'downloaded' };
          }
        }
        return next;
      });
    }).catch(() => {});

    // Listen for download progress events
    listen('download-progress', (event: any) => {
      const { filename, pct, downloaded_mb, total_mb } = event.payload;
      const model = MODEL_CATALOG.find(m => m.ggufFilename === filename);
      if (model) {
        setModelState(model.id, { status: 'downloading', pct, downloadedMb: downloaded_mb, totalMb: total_mb });
      }
    }).then(unlisten => {
      unlistenRef.current = unlisten;
    });

    return () => {
      unlistenRef.current?.();
    };
  }, []);

  async function handleDownload(model: CatalogModel) {
    setModelState(model.id, { status: 'downloading', pct: 0, downloadedMb: 0, totalMb: model.sizeMb / 1024 });
    try {
      const filePath = await invoke<string>('download_model', {
        url: model.downloadUrl,
        filename: model.ggufFilename,
      });
      setModelState(model.id, { status: 'installing' });
      await launchModel(model, filePath);
    } catch (err: any) {
      if (err === 'cancelled' || String(err).includes('cancelled')) {
        setModelState(model.id, { status: 'idle' });
      } else {
        setModelState(model.id, { status: 'error', error: String(err) });
      }
    }
  }

  async function handleLoad(model: CatalogModel) {
    const dir = await invoke<string>('get_models_dir');
    const filePath = `${dir}/${model.ggufFilename}`;
    setModelState(model.id, { status: 'installing' });
    try {
      await launchModel(model, filePath);
    } catch (err: any) {
      setModelState(model.id, { status: 'error', error: String(err) });
    }
  }

  async function launchModel(model: CatalogModel, filePath: string) {
    const endpoint = await invoke<string>('start_local_model', {
      modelPath: filePath,
      port: DEFAULT_PORT,
    });
    setModelState(model.id, { status: 'ready', endpoint });
    const newModel = {
      id: genId('native'),
      name: model.name,
      provider: 'native',
      modelId: model.ggufFilename.replace('.gguf', ''),
      endpoint,
      apiKey: '',
      contextLimit: model.contextK * 1024,
      canImage: false,
      isLocal: true,
    };
    onModelReady(newModel);
  }

  async function handleCancel(model: CatalogModel) {
    await invoke('cancel_download', { filename: model.ggufFilename });
    setModelState(model.id, { status: 'idle' });
  }

  function handleUseModel(model: CatalogModel) {
    const state = states[model.id];
    if (state?.endpoint) {
      const existing = {
        id: genId('native'),
        name: model.name,
        provider: 'native',
        modelId: model.ggufFilename.replace('.gguf', ''),
        endpoint: state.endpoint,
        apiKey: '',
        contextLimit: model.contextK * 1024,
        canImage: false,
        isLocal: true,
      };
      onModelReady(existing);
    }
  }

  if (ramMb < 6144) {
    return (
      <div className="text-center py-8 text-sm text-neutral-500">
        <p className="font-bold text-neutral-700 dark:text-neutral-300 mb-1">Local models need at least 8GB RAM</p>
        <p className="text-xs">Your device has {ramGb}GB — use cloud models instead.</p>
      </div>
    );
  }

  // ── Tier logic: only show top-tier models as "Recommended" ──────────────────
  const searchLower = search.toLowerCase();
  const matchesSearch = (m: CatalogModel) =>
    !search ||
    m.name.toLowerCase().includes(searchLower) ||
    m.role.toLowerCase().includes(searchLower) ||
    m.bestFor.toLowerCase().includes(searchLower);

  const compatible = MODEL_CATALOG.filter(m => m.ramGb <= ramGb);
  const maxTier = compatible.reduce((mx, m) => Math.max(mx, m.ramGb), 0);

  const recommended = compatible
    .filter(m => m.ramGb === maxTier && m.tag)
    .filter(matchesSearch);

  const others = compatible
    .filter(m => m.ramGb < maxTier || (m.ramGb === maxTier && !m.tag))
    .sort((a, b) => b.ramGb - a.ramGb)   // biggest/best first
    .filter(matchesSearch);

  const tooLarge = MODEL_CATALOG
    .filter(m => m.ramGb > ramGb)
    .filter(matchesSearch);

  const hasResults = recommended.length + others.length + tooLarge.length > 0;

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search models by name, role…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl outline-none focus:border-[#4A5D75] dark:focus:border-[#6A829E] transition-colors"
        />
      </div>

      {!hasResults && (
        <p className="text-xs text-neutral-400 text-center py-4">No models match "{search}"</p>
      )}

      {recommended.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 pt-1">
            Recommended for your {ramGb}GB Mac
          </p>
          {recommended.map(m => <ModelCard key={m.id} model={m} state={states[m.id]} onDownload={handleDownload} onLoad={handleLoad} onCancel={handleCancel} onUse={handleUseModel} />)}
        </div>
      )}
      {others.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 pt-3">
            Also available
          </p>
          {others.map(m => <ModelCard key={m.id} model={m} state={states[m.id]} onDownload={handleDownload} onLoad={handleLoad} onCancel={handleCancel} onUse={handleUseModel} />)}
        </div>
      )}
      {tooLarge.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-300 dark:text-neutral-600 pt-3">
            Needs more RAM
          </p>
          {tooLarge.map(m => (
            <div key={m.id} className="border border-neutral-100 dark:border-neutral-800 rounded-2xl p-4 opacity-50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-neutral-500">{m.name}</span>
                <span className="text-[10px] text-neutral-400">Needs {m.ramGb}GB</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ModelCardProps {
  model: CatalogModel;
  state?: ModelState;
  onDownload: (m: CatalogModel) => void;
  onLoad: (m: CatalogModel) => void;
  onCancel: (m: CatalogModel) => void;
  onUse: (m: CatalogModel) => void;
}

function ModelCard({ model, state, onDownload, onLoad, onCancel, onUse }: ModelCardProps) {
  const status = state?.status ?? 'idle';

  return (
    <div className={`border rounded-2xl p-4 transition-all ${
      status === 'ready'
        ? 'border-[#7A9E8D]/40 bg-[#F0F7F4] dark:bg-[#1A2B24]/30'
        : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900'
    }`}>
      {model.tag && (
        <div className="text-[9px] font-black uppercase tracking-widest text-[#7A9E8D] mb-2">{model.tag}</div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black">{model.name}</span>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
              model.role === 'Coder'
                ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400'
                : model.role === 'Reasoning'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
            }`}>{model.role}</span>
          </div>
          <div className="mt-1.5 space-y-0.5">
            <p className="text-[11px] text-neutral-500">
              <span className="text-[#7A9E8D] font-bold">+</span> {model.bestFor}
            </p>
            <p className="text-[11px] text-neutral-400">
              <span className="font-bold">–</span> {model.notGreatFor}
            </p>
          </div>
        </div>
        <div className="text-[10px] text-neutral-400 shrink-0 text-right">
          {(model.sizeMb / 1024).toFixed(1)} GB
        </div>
      </div>

      <div className="mt-3">
        {status === 'idle' && !model.gated && (
          <button
            onClick={() => onDownload(model)}
            className="flex items-center gap-2 px-3 py-2 bg-[#4A5D75] hover:bg-[#3D4D61] text-white text-[11px] font-black rounded-xl transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            Download {(model.sizeMb / 1024).toFixed(1)} GB
          </button>
        )}
        {status === 'idle' && model.gated && (
          <a
            href={model.gatedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 text-[11px] font-black rounded-xl hover:border-[#4A5D75] hover:text-[#4A5D75] transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View on HuggingFace
          </a>
        )}
        {status === 'downloaded' && (
          <button
            onClick={() => onLoad(model)}
            className="flex items-center gap-2 px-3 py-2 border border-[#4A5D75] text-[#4A5D75] text-[11px] font-black rounded-xl hover:bg-[#4A5D75] hover:text-white transition-all"
          >
            <Zap className="w-3.5 h-3.5" />
            Load model
          </button>
        )}
        {status === 'downloading' && (
          <div className="space-y-2">
            <div className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#4A5D75] rounded-full transition-all duration-300"
                style={{ width: `${state?.pct ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-500 font-mono">
                {state?.pct?.toFixed(0)}% · {state?.downloadedMb?.toFixed(1)} / {state?.totalMb?.toFixed(1)} GB
              </span>
              <button
                onClick={() => onCancel(model)}
                className="text-[10px] text-neutral-400 hover:text-[#C98A8A] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {status === 'installing' && (
          <div className="flex items-center gap-2 text-[11px] text-neutral-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Starting engine…
          </div>
        )}
        {status === 'ready' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-[#7A9E8D] font-bold">
              <CheckCircle className="w-3.5 h-3.5" />
              Ready
            </div>
            <button
              onClick={() => onUse(model)}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#7A9E8D] hover:bg-[#6A8E7D] text-white text-[11px] font-black rounded-xl transition-all"
            >
              Use this model
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="space-y-2">
            <div className="flex items-start gap-1.5 text-[11px] text-[#C98A8A]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-all">{state?.error ?? 'Download failed'}</span>
            </div>
            <button
              onClick={() => onDownload(model)}
              className="text-[11px] text-[#4A5D75] hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
