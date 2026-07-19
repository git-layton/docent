import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Download, CheckCircle, Loader2, AlertCircle, ExternalLink, Zap, Search, FolderOpen, Eye, Mic, ShieldAlert, Trash2 } from 'lucide-react';
import { MODEL_CATALOG, recommendSetup, fitOnMac, type CatalogModel } from '../data/modelCatalog';
import { supportsVision } from '../services/llm';

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
  isAppleSilicon?: boolean;
  onModelReady: (model: any) => void;
  // 'recommended' shows ONLY the single best pick for this Mac (clean getting-started view).
  // 'full' (default) shows the searchable list of every model + "also available" + "needs more RAM".
  mode?: 'full' | 'recommended';
  onDownloadStart?: () => void;
}

const DEFAULT_PORT = 8080;
// The bundled llama-server serves at most 32K context (see start_local_model in lib.rs).
// We launch each model at the largest context fitOnMac says THIS Mac can hold — possibly
// less than 32K — and the stored contextLimit must match what was actually launched,
// otherwise the app would silently overflow the server's window.
const ENGINE_CONTEXT = 32768;

function genId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ModelStorePanel({ ramMb, isAppleSilicon, onModelReady, onDownloadStart, mode = 'full' }: ModelStorePanelProps) {
  const [states, setStates] = useState<Record<string, ModelState>>({});
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'All' | 'General' | 'Coder' | 'Reasoning' | 'Vision' | 'Audio'>('All');
  const [importing, setImporting] = useState(false);
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
      // Match either the model GGUF or its vision projector so progress shows during both downloads.
      const model = MODEL_CATALOG.find(m => m.ggufFilename === filename || m.mmprojFilename === filename);
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
    // Don't start a second download for a model that's already downloading/installing
    // (double-click, or a model already in flight). The backend also guards this.
    const st = states[model.id]?.status;
    if (st === 'downloading' || st === 'installing') return;
    setModelState(model.id, { status: 'downloading', pct: 0, downloadedMb: 0, totalMb: model.sizeMb / 1024 });
    onDownloadStart?.();
    try {
      const filePath = await invoke<string>('download_model', {
        url: model.downloadUrl,
        filename: model.ggufFilename,
      });
      // Vision models ship a separate CLIP projector — fetch it too so llama-server can see.
      let mmprojPath: string | undefined;
      if (model.mmprojUrl && model.mmprojFilename) {
        setModelState(model.id, { status: 'installing' });
        mmprojPath = await invoke<string>('download_model', {
          url: model.mmprojUrl,
          filename: model.mmprojFilename,
        });
      }
      setModelState(model.id, { status: 'installing' });
      await launchModel(model, filePath, mmprojPath);
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
    const mmprojPath = model.mmprojFilename ? `${dir}/${model.mmprojFilename}` : undefined;
    setModelState(model.id, { status: 'installing' });
    try {
      await launchModel(model, filePath, mmprojPath);
    } catch (err: any) {
      setModelState(model.id, { status: 'error', error: String(err) });
    }
  }

  // The context this model is launched at on THIS Mac: the largest rung fitOnMac says
  // fits the memory budget, capped by both the model's own limit and the engine's 32K.
  // A model fitOnMac rejects outright shouldn't be launchable, but if one slips through
  // (e.g. downloaded on a bigger Mac), try the smallest rung and let the engine's
  // friendly OOM error handle it.
  function launchCtxTokens(model: CatalogModel): number {
    const fit = fitOnMac(model, ramGb);
    const fitTokens = (fit.fits ? fit.contextK : 4) * 1024;
    return Math.min(fitTokens, model.contextK * 1024, ENGINE_CONTEXT);
  }

  async function launchModel(model: CatalogModel, filePath: string, mmprojPath?: string) {
    const fit = fitOnMac(model, ramGb);
    const ctxTokens = launchCtxTokens(model);
    const endpoint = await invoke<string>('start_local_model', {
      modelPath: filePath,
      port: DEFAULT_PORT,
      mmprojPath: mmprojPath ?? null,
      ctxTokens,
      kv8bit: fit.kv8bit,
    });
    setModelState(model.id, { status: 'ready', endpoint });
    const newModel = {
      id: genId('native'),
      name: model.name,
      provider: 'native',
      modelId: model.ggufFilename.replace('.gguf', ''),
      endpoint,
      apiKey: '',
      contextLimit: ctxTokens,
      canImage: supportsVision(model.ggufFilename) || !!model.vision,
      canHear: !!model.audio,
      isLocal: true,
      mmprojPath,
    };
    onModelReady(newModel);
  }

  async function handleCancel(model: CatalogModel) {
    await invoke('cancel_download', { filename: model.ggufFilename });
    setModelState(model.id, { status: 'idle' });
  }

  async function handleDelete(model: CatalogModel) {
    // openDialog (plugin-dialog `open`) is the FILE PICKER — not a confirm. Use the webview's
    // native confirm for the "are you sure?" gate.
    if (!window.confirm('Delete this model from your Mac? This frees up space.')) return;

    try {
      await invoke('delete_model', { filename: model.ggufFilename, mmproj: model.mmprojFilename });
      setModelState(model.id, { status: 'idle', endpoint: undefined });
    } catch (err: any) {
      console.error('Failed to delete model', err);
    }
  }

  async function handleUseModel(model: CatalogModel) {
    const state = states[model.id];
    if (!state?.endpoint) return;
    try {
      const dir = model.mmprojFilename ? await invoke<string>('get_models_dir') : '';
      const mmprojPath = model.mmprojFilename ? `${dir}/${model.mmprojFilename}` : undefined;
      const existing = {
        id: genId('native'),
        name: model.name,
        provider: 'native',
        modelId: model.ggufFilename.replace('.gguf', ''),
        endpoint: state.endpoint,
        apiKey: '',
        contextLimit: launchCtxTokens(model),
        canImage: supportsVision(model.ggufFilename) || !!model.vision,
        canHear: !!model.audio,
        isLocal: true,
        mmprojPath,
      };
      onModelReady(existing);
    } catch (err: any) {
      setModelState(model.id, { status: 'error', error: String(err) });
    }
  }

  // Connect a .gguf the user already has on disk (anywhere) — the bundled llama-server
  // can load any local model file, so this works without LM Studio / Ollama.
  async function handleImport() {
    try {
      const selected = await openDialog({ multiple: false, filters: [{ name: 'GGUF model', extensions: ['gguf'] }] });
      if (!selected || typeof selected !== 'string') return;
      setImporting(true);
      const fname = selected.split('/').pop() || 'model.gguf';
      const name = fname.replace(/\.gguf$/i, '');
      // No catalog entry → size unknown here, so no fit-derived context; the engine
      // launches at its 32K default and its OOM error covers an oversized import.
      const endpoint = await invoke<string>('start_local_model', { modelPath: selected, port: DEFAULT_PORT, mmprojPath: null });
      onModelReady({
        id: genId('native'), name, provider: 'native', modelId: name,
        endpoint, apiKey: '', contextLimit: ENGINE_CONTEXT,
        canImage: supportsVision(fname), isLocal: true,
      });
    } catch (err: any) {
      console.error('[AgentForge] model import failed', err);
    } finally {
      setImporting(false);
    }
  }

  const importRow = (
    <button
      onClick={handleImport}
      disabled={importing}
      className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3.5 text-[11px] font-black uppercase tracking-widest text-ink-2 bg-panel-2 hover:bg-panel border border-edge rounded-2xl transition-all disabled:opacity-50 shadow-sm"
    >
      {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
      {importing ? 'Scanning…' : 'Scan for existing models'}
    </button>
  );

  if (isAppleSilicon === false) {
    return (
      <div className="text-center py-8 text-sm text-ink-2">
        <p className="font-bold text-ink mb-1">Local AI runs on Apple Silicon</p>
        <p className="text-xs">This Mac isn't Apple Silicon, so the built-in engine can't run a local model — use a cloud model instead.</p>
      </div>
    );
  }

  if (ramMb < 6144) {
    return (
      <div className="text-center py-8 text-sm text-ink-2">
        <p className="font-bold text-ink mb-1">Local models need at least 8GB RAM</p>
        <p className="text-xs">Your device has {ramGb}GB — use cloud models instead.</p>
      </div>
    );
  }

  // ── Tier logic: only show top-tier models as "Recommended" ──────────────────
  const searchLower = search.toLowerCase();
  const matchesSearch = (m: CatalogModel) =>
    (!search ||
    m.name.toLowerCase().includes(searchLower) ||
    m.role.toLowerCase().includes(searchLower) ||
    m.bestFor.toLowerCase().includes(searchLower)) &&
    (roleFilter === 'All' || 
     m.role === roleFilter || 
     (roleFilter === 'Vision' && m.vision) || 
     (roleFilter === 'Audio' && m.audio));

  // ── Recommended-only: the single best pick for this Mac, no list, no search ──
  if (mode === 'recommended') {
    // Use the memory-computed recommendation (largest model that runs at full 32K
    // within a conservative budget) — never a model this Mac can't actually load.
    const rec = recommendSetup({ totalMb: ramMb, isAppleSilicon: isAppleSilicon ?? true });
    if (rec.kind !== 'local') {
      return (
        <div className="space-y-2">
          <p className="text-xs text-ink-2 leading-relaxed rounded-xl bg-inset border border-edge px-3 py-2.5">
            Your {ramGb}GB Mac is below what a capable local model comfortably needs — a cloud model is the better fit. You can still import one below.
          </p>
          {importRow}
        </div>
      );
    }
    const pick = rec.recommended;
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-ink-3 pl-1">
          Recommended for your {ramGb}GB Mac
        </p>
        <ModelCard model={pick} state={states[pick.id]} onDownload={handleDownload} onLoad={handleLoad} onCancel={handleCancel} onDelete={handleDelete} onUse={handleUseModel} />
        {importRow}
      </div>
    );
  }

  // Group by what each model actually does on THIS Mac (memory-computed), not by a
  // hand-set RAM tier: comfortable (full 32K), runs-but-reduced, or too large.
  const withFit = MODEL_CATALOG.map(m => ({ m, fit: fitOnMac(m, ramGb) })).filter(({ m }) => matchesSearch(m));
  const recommended = withFit
    .filter(({ fit }) => fit.fits && fit.contextK >= 32 && !fit.kv8bit)
    .sort((a, b) => b.m.sizeMb - a.m.sizeMb);
  const others = withFit
    .filter(({ fit }) => fit.fits && !(fit.contextK >= 32 && !fit.kv8bit))
    .sort((a, b) => b.m.sizeMb - a.m.sizeMb);
  const tooLarge = withFit
    .filter(({ fit }) => !fit.fits)
    .sort((a, b) => b.m.sizeMb - a.m.sizeMb)
    .map(({ m }) => m);

  const hasResults = recommended.length + others.length + tooLarge.length > 0;

  return (
    <div className="space-y-2">
      {/* Search and Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3 pointer-events-none" />
          <input
            type="text"
            placeholder="Search models by name, role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-xs bg-inset border border-edge rounded-xl outline-none focus:border-accent transition-colors"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
          {(['All', 'General', 'Coder', 'Reasoning', 'Vision', 'Audio'] as const).map(role => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={`shrink-0 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full border transition-all ${
                roleFilter === role
                  ? 'bg-ink text-surface border-ink shadow-md'
                  : 'bg-panel-2 text-ink-2 border-edge hover:bg-panel shadow-sm'
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      </div>

      {!hasResults && (
        <p className="text-xs text-ink-3 text-center py-4">No models match "{search}"</p>
      )}

      {recommended.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-ink-3 pl-1 pt-2">
            Recommended for your {ramGb}GB Mac
          </p>
          {recommended.map(({ m }) => <ModelCard key={m.id} model={m} state={states[m.id]} onDownload={handleDownload} onLoad={handleLoad} onCancel={handleCancel} onDelete={handleDelete} onUse={handleUseModel} />)}
        </div>
      )}
      {others.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-ink-3 pl-1 pt-4">
            Also runs (Reduced context on your Mac)
          </p>
          {others.map(({ m, fit }) => <ModelCard key={m.id} model={m} state={states[m.id]} fitLabel={fit.label} onDownload={handleDownload} onLoad={handleLoad} onCancel={handleCancel} onDelete={handleDelete} onUse={handleUseModel} />)}
        </div>
      )}
      {tooLarge.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-ink-3 pt-3">
            Too large for this Mac
          </p>
          {tooLarge.map(m => (
            <div key={m.id} className="border border-edge rounded-2xl p-4 opacity-50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-ink-2">{m.name}</span>
                <span className="text-[10px] text-ink-3">{Math.round(m.sizeMb / 1024)}GB · won't fit</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {importRow}
    </div>
  );
}

interface ModelCardProps {
  model: CatalogModel;
  state?: ModelState;
  // Per-THIS-Mac fit line (e.g. "Runs at 8K context (reduced)") — shown so a reduced-
  // context model is never a surprise after a multi-GB download.
  fitLabel?: string;
  onDownload: (m: CatalogModel) => void;
  onLoad: (m: CatalogModel) => void;
  onCancel: (m: CatalogModel) => void;
  onDelete: (m: CatalogModel) => void;
  onUse: (m: CatalogModel) => void;
}

function ModelCard({ model, state, fitLabel, onDownload, onLoad, onCancel, onDelete, onUse }: ModelCardProps) {
  const status = state?.status ?? 'idle';

  return (
    <div className={`border rounded-2xl p-5 transition-all shadow-sm ${
      status === 'ready'
        ? 'border-success/40 bg-success-soft/30'
        : 'border-edge bg-panel-2/40 hover:bg-panel'
    }`}>
      {model.tag && (
        <div className="flex items-center gap-1.5 mb-3">
          <Zap className="w-3 h-3 text-accent" />
          <span className="text-[9px] font-black uppercase tracking-widest text-accent">{model.tag}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-black">{model.name}</span>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
              model.role === 'Coder'
                ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400'
                : model.role === 'Reasoning'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
            }`}>{model.role}</span>
            {model.vision && (
              <span className="flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" title="Supports Vision (Image Understanding)">
                <Eye className="w-3 h-3" /> Vision
              </span>
            )}
            {model.audio && (
              <span className="flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" title="Supports Native Audio Input">
                <Mic className="w-3 h-3" /> Audio
              </span>
            )}
            {model.censorScore && (
              <span className="flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-surface text-ink-2 border border-edge" title={`Filtering Profile: ${model.censorScore}`}>
                <ShieldAlert className="w-3 h-3 text-ink-3" /> {model.censorScore}
              </span>
            )}
          </div>
          <div className="mt-1.5 space-y-0.5">
            <p className="text-[11px] text-ink-2">
              <span className="text-success font-bold">+</span> {model.bestFor}
            </p>
            <p className="text-[11px] text-ink-3">
              <span className="font-bold">–</span> {model.notGreatFor}
            </p>
            {fitLabel && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                On this Mac: {fitLabel}
              </p>
            )}
          </div>
        </div>
        <div className="text-[10px] text-ink-3 shrink-0 text-right">
          {(model.sizeMb / 1024).toFixed(1)} GB
        </div>
      </div>

      <div className="mt-3">
        {status === 'idle' && !model.gated && (
          <button
            onClick={() => onDownload(model)}
            className="flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent-strong text-on-accent text-[11px] font-black rounded-xl transition-all"
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
            className="flex items-center gap-2 px-3 py-2 border border-edge-2 text-ink-2 text-[11px] font-black rounded-xl hover:border-accent hover:text-accent transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View on HuggingFace
          </a>
        )}
        {status === 'downloaded' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onLoad(model)}
              className="flex items-center gap-2 px-4 py-2 border border-accent text-accent text-[11px] font-black uppercase tracking-wide rounded-xl hover:bg-accent hover:text-on-accent transition-all shadow-sm"
            >
              <Zap className="w-3.5 h-3.5" />
              Load model
            </button>
            <button
              onClick={() => onDelete(model)}
              className="flex items-center justify-center p-2 border border-edge text-ink-3 rounded-xl hover:bg-danger hover:text-danger-soft hover:border-danger transition-all"
              title="Delete from Mac"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
        {status === 'downloading' && (
          <div className="space-y-2">
            <div className="h-2 bg-inset rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${state?.pct ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-ink-2 font-mono">
                {state?.pct?.toFixed(0)}% · {state?.downloadedMb?.toFixed(1)} / {state?.totalMb?.toFixed(1)} GB
              </span>
              <button
                onClick={() => onCancel(model)}
                className="text-[10px] text-ink-3 hover:text-danger transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {status === 'installing' && (
          <div className="flex items-center gap-2 text-[11px] text-ink-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Starting engine…
          </div>
        )}
        {status === 'ready' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-success font-bold">
              <CheckCircle className="w-3.5 h-3.5" />
              Ready
            </div>
            <button
              onClick={() => onUse(model)}
              className="flex items-center gap-1.5 px-3 py-2 bg-success hover:opacity-90 text-success-soft text-[11px] font-black rounded-xl transition-all"
            >
              Use this model
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="space-y-2">
            <div className="flex items-start gap-1.5 text-[11px] text-danger">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-all">{state?.error ?? 'Download failed'}</span>
            </div>
            <button
              onClick={() => onDownload(model)}
              className="text-[11px] text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
