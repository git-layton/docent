import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Radio,
  Server,
  Smartphone,
  User,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAgentStore } from '../store/useAgentStore';
import { db } from '../services/database';
import { ModelStorePanel } from './ModelStorePanel';
import { recommendSetup } from '../data/modelCatalog';
// @ts-ignore — nativeFetch is a plain JS file without a declaration
import { fetchWithRetry } from '../utils/nativeFetch';

interface Props {
  onClose: () => void;
  initialStep?: number;
}

interface RelaySetupResult {
  ok: boolean;
  error?: string;
  instanceId?: string;
  personalToken?: string;
  owners?: Array<{ id: string; label: string; token: string; shareId: string }>;
}

interface RelayStatus {
  installed: boolean;
  running: boolean;
  instanceId: string;
  owners: Array<{ id: string; label: string; token: string; instanceId: string; shareId: string }>;
  tailscaleHostname: string | null;
}

const TOTAL_STEPS = 8;
const genId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ─── Shared primitives ────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round(((step - 1) / (TOTAL_STEPS - 1)) * 100);
  return (
    <div className="w-full h-0.5 bg-inset rounded-full overflow-hidden mb-8">
      <div
        className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Btn({
  onClick, disabled, variant = 'primary', children, className = '',
}: {
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  children: React.ReactNode;
  className?: string;
}) {
  const base = 'flex items-center justify-center gap-2 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none';
  const variants = {
    primary: 'py-3.5 px-6 bg-accent hover:bg-accent-strong text-on-accent shadow-md',
    secondary: 'py-3 px-5 border border-edge-2 text-ink-2 hover:bg-wash',
    ghost: 'py-2 text-mini text-ink-3 hover:text-ink-2 tracking-wide normal-case font-semibold',
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

function CopyChip({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      title="Click to copy"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-inset border border-edge text-mini font-mono text-ink-2 hover:bg-wash transition-colors max-w-full"
    >
      {copied ? <Check className="w-3 h-3 text-success shrink-0" /> : <Copy className="w-3 h-3 shrink-0 opacity-50" />}
      <span className="truncate">{label ?? text}</span>
    </button>
  );
}

function StepIcon({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${color}`}>
      {children}
    </div>
  );
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-7">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-accent to-accent-strong flex items-center justify-center shadow-xl shadow-accent/20">
        <Zap className="w-9 h-9 text-on-accent" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight text-ink">
          Welcome to Agent Forge
        </h1>
        <p className="text-sm text-ink-2 max-w-xs mx-auto leading-relaxed">
          Your personal AI command center. Let's get everything set up — it takes about two minutes.
        </p>
      </div>
      <div className="w-full max-w-xs space-y-2.5 text-left">
        {[
          'Personalize your agents with your profile',
          'Connect an AI model',
          'Set up one-tap iPhone capture',
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-sm text-ink-2">
            <div className="w-5 h-5 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-primary" />
            </div>
            {item}
          </div>
        ))}
      </div>
      <Btn onClick={onNext} className="w-full max-w-xs">
        Get started <ArrowRight className="w-4 h-4" />
      </Btn>
    </div>
  );
}

// ─── Step 2: About You ────────────────────────────────────────────────────────

function StepProfile({ onNext }: { onNext: () => void }) {
  const userProfile = useSettingsStore(s => s.userProfile);
  const existingName = useSettingsStore(s => s.userName);
  const [name, setName] = useState(existingName ?? '');
  const [bio, setBio] = useState(userProfile);

  async function save() {
    if (name.trim()) useSettingsStore.getState().setUserName(name.trim());
    const profile = bio.trim();
    useSettingsStore.getState().setUserProfile(profile);
    await useSettingsStore.getState().persist();
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-primary/10 dark:bg-primary/20">
          <User className="w-6 h-6 text-primary" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-ink">About you</h2>
          <p className="text-xs text-ink-2 mt-0.5">Your agents use this to give you better, more relevant help.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Your name (optional)</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Alex"
            className="w-full bg-inset border border-edge rounded-xl px-4 py-3 text-sm outline-none focus:border-primary dark:focus:border-secondary transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Tell your agents about yourself</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={5}
            placeholder={`e.g. I'm a product designer at a SaaS startup. I care about clean systems, good writing, and shipping fast. I prefer concise answers with concrete examples. I'm working on building my personal knowledge base and using AI to process ideas faster.`}
            className="w-full resize-none bg-inset border border-edge rounded-xl px-4 py-3 text-sm leading-relaxed outline-none focus:border-primary dark:focus:border-secondary transition-colors"
          />
          <p className="text-mini text-ink-3">Be as specific as you like — more context means better responses.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Btn onClick={save} className="w-full">
          Continue <ArrowRight className="w-4 h-4" />
        </Btn>
        <Btn variant="ghost" onClick={onNext} className="w-full">
          Skip for now
        </Btn>
      </div>
    </div>
  );
}

// ─── Step 3: AI Model ─────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'lmstudio',
    name: 'LM Studio',
    sub: 'Runs on this Mac · free · private',
    emoji: '🖥️',
    color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    activeColor: 'bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600',
    endpoint: 'http://localhost:1234/v1',
    defaultModel: '',
    context: 128000,
    local: true,
    free: true,
    freeNote: null,
    keyLabel: null,
    keyPlaceholder: null,
    getKeyUrl: null,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    sub: 'Google · free tier available',
    emoji: '✨',
    color: 'bg-secondary/5 dark:bg-secondary/10 border-secondary/30 dark:border-secondary/40',
    activeColor: 'bg-secondary/10 dark:bg-secondary/20 border-secondary dark:border-secondary',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    context: 1000000,
    local: false,
    free: true,
    freeNote: 'gemini-2.0-flash is free with generous rate limits',
    keyLabel: 'Google AI API key',
    keyPlaceholder: 'AIza…',
    getKeyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'anthropic',
    name: 'Claude',
    sub: 'Anthropic · paid',
    emoji: '🧠',
    color: 'bg-accent/5 dark:bg-accent/10 border-accent/30 dark:border-accent/40',
    activeColor: 'bg-accent/10 dark:bg-accent/20 border-accent dark:border-accent',
    endpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
    context: 200000,
    local: false,
    free: false,
    freeNote: null,
    keyLabel: 'Anthropic API key',
    keyPlaceholder: 'sk-ant-…',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    sub: 'GPT · o-series · paid',
    emoji: '⚡',
    color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
    activeColor: 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 dark:border-emerald-600',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    context: 128000,
    local: false,
    free: false,
    freeNote: null,
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-…',
    getKeyUrl: 'https://platform.openai.com/api-keys',
  },
];

// Connect form — shown after user picks a provider
function ModelConnectForm({
  provider,
  prefilledModelId,
  onAdded,
  onBack,
}: {
  provider: typeof PROVIDERS[0];
  prefilledModelId?: string;
  onAdded: () => void;
  onBack: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(provider.endpoint);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; context: number }[]>([]);
  const [selectedModelId, setSelectedModelId] = useState(prefilledModelId ?? provider.defaultModel);
  const [manualId, setManualId] = useState(prefilledModelId ?? provider.defaultModel);
  const [status, setStatus] = useState<'idle' | 'fetching' | 'ready' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function fetchModels() {
    setStatus('fetching');
    setErrorMsg('');
    try {
      const ep = endpoint.replace(/\/$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;
      const res = await fetch(`${ep}/models`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list: { id: string; context: number }[] = (json.data ?? json.models ?? [])
        .filter((m: any) => !m.id?.includes('embed') && !m.id?.includes('image') && !m.id?.includes('dall-e') && !m.id?.includes('whisper') && !m.id?.includes('tts'))
        .map((m: any) => ({ id: m.id, context: m.context_length ?? provider.context }));
      if (list.length === 0) throw new Error('No chat models found at that endpoint.');
      setFetchedModels(list);
      setSelectedModelId(list[0].id);
      setManualId(list[0].id);
      setStatus('ready');
    } catch (e: any) {
      setErrorMsg(e.message ?? String(e));
      setStatus('error');
    }
  }

  function addModel() {
    const mid = selectedModelId || manualId.trim();
    if (!mid) return;
    const ctx = fetchedModels.find(m => m.id === mid)?.context ?? provider.context;
    const newModel = {
      id: genId('m'),
      name: mid,
      provider: provider.id,
      modelId: mid,
      endpoint,
      apiKey: apiKey.trim(),
      contextLimit: ctx,
      canImage: false,
      isLocal: provider.local,
    };
    const store = useSettingsStore.getState();
    store.setModels((prev: any[]) => [...prev, newModel]);
    store.setSelectedModelId(newModel.id);
    store.persist();
    setStatus('done');
    setTimeout(onAdded, 600);
  }

  if (status === 'done') {
    return (
      <div className="flex items-center gap-3 p-4 rounded-2xl bg-success-soft border border-success/30">
        <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
        <div>
          <p className="text-sm font-bold text-success">Connected!</p>
          <p className="text-xs text-success mt-0.5 font-mono">{selectedModelId || manualId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-4 rounded-xl bg-inset border border-edge">
        <span className="text-lg">{provider.emoji}</span>
        <div className="min-w-0">
          <p className="text-sm font-black text-ink">{provider.name}</p>
          <p className="text-tiny text-ink-3">{provider.sub}</p>
        </div>
        <button onClick={onBack} className="ml-auto text-tiny font-bold text-ink-3 hover:text-ink-2">
          change
        </button>
      </div>

      {provider.free && provider.freeNote && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-success-soft border border-success/30">
          <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-success-soft text-success shrink-0">Free</span>
          <p className="text-mini text-success">{provider.freeNote}</p>
        </div>
      )}

      {provider.local && (
        <div className="space-y-1">
          <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Endpoint</label>
          <input
            value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
            className="w-full bg-inset border border-edge rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-primary transition-colors"
          />
        </div>
      )}

      {provider.keyLabel && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-tiny font-black uppercase tracking-widest text-ink-3">{provider.keyLabel}</label>
            {provider.getKeyUrl && (
              <button
                onClick={() => openUrl(provider.getKeyUrl!)}
                className="flex items-center gap-1 text-tiny font-bold text-primary hover:underline"
              >
                Get key <ExternalLink className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={provider.keyPlaceholder ?? ''}
            className="w-full bg-inset border border-edge rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-primary transition-colors"
          />
        </div>
      )}

      {/* Pre-filled connect button (local rec selected or default model set) */}
      {manualId && (status === 'idle' || status === 'error') && (
        <Btn
          onClick={addModel}
          disabled={!provider.local && !apiKey.trim()}
          className="w-full"
        >
          Connect <span className="font-mono normal-case font-bold">{manualId}</span> <ArrowRight className="w-4 h-4" />
        </Btn>
      )}

      {status !== 'ready' && (
        <Btn
          variant="secondary"
          onClick={fetchModels}
          disabled={status === 'fetching' || (!provider.local && !apiKey.trim())}
          className="w-full"
        >
          {status === 'fetching' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Detecting models…</> : manualId ? 'Detect loaded models instead' : 'Detect available models'}
        </Btn>
      )}

      {status === 'error' && (
        <div className="space-y-2">
          <p className="text-xs text-danger">{errorMsg}</p>
          <div className="space-y-1">
            <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Enter model ID manually</label>
            <input
              value={manualId}
              onChange={e => setManualId(e.target.value)}
              placeholder={provider.defaultModel || 'model-id'}
              className="w-full bg-inset border border-edge rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-primary transition-colors"
            />
            <Btn onClick={addModel} disabled={!manualId.trim()} className="w-full">
              Connect <ArrowRight className="w-4 h-4" />
            </Btn>
          </div>
        </div>
      )}

      {status === 'ready' && fetchedModels.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-tiny font-black uppercase tracking-widest text-ink-3">Choose a model</label>
          <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl border border-edge p-1.5 bg-inset custom-scrollbar">
            {fetchedModels.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedModelId(m.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${selectedModelId === m.id ? 'bg-accent text-on-accent' : 'hover:bg-wash text-ink-2'}`}
              >
                <span className="font-mono truncate">{m.id}</span>
                {selectedModelId === m.id && <Check className="w-3 h-3 shrink-0 ml-2" />}
              </button>
            ))}
          </div>
          <Btn onClick={addModel} disabled={!selectedModelId} className="w-full">
            Connect {selectedModelId} <ArrowRight className="w-4 h-4" />
          </Btn>
        </div>
      )}
    </div>
  );
}

function StepModel({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [hw, setHw] = useState<{ totalMb: number; chip: string; isAppleSilicon: boolean } | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<typeof PROVIDERS[0] | null>(null);
  const [connectingModelId, setConnectingModelId] = useState<string | undefined>(undefined);
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(0);

  useEffect(() => {
    invoke<{ total_mb: number; chip: string; is_apple_silicon: boolean }>('get_hardware_summary')
      .then(r => setHw({ totalMb: r.total_mb, chip: r.chip, isAppleSilicon: r.is_apple_silicon }))
      .catch(() => {});
    // Auto-detect silently on mount
    detectLocalModels();
  }, []);

  async function detectLocalModels() {
    setDetecting(true);
    try {
      const ss = useSettingsStore.getState();
      const existing = ss.models;
      const added: any[] = [];
      const mkSignal = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
      const genId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      try {
        const r = await fetch('http://localhost:1234/v1/models', { signal: mkSignal(1500) });
        if (r.ok) {
          const { data } = await r.json();
          (data ?? []).forEach((m: any) => {
            if (!existing.some((e: any) => e.modelId === m.id && e.endpoint === 'http://localhost:1234/v1'))
              added.push({ id: genId('m'), name: m.id, provider: 'lmstudio', modelId: m.id, endpoint: 'http://localhost:1234/v1', apiKey: '', contextLimit: 32768, canImage: false, isLocal: true });
          });
        }
      } catch (_) {}

      try {
        const r = await fetch('http://localhost:11434/api/tags', { signal: mkSignal(1500) });
        if (r.ok) {
          const { models: om } = await r.json();
          (om ?? []).forEach((m: any) => {
            if (!existing.some((e: any) => e.modelId === m.name && e.endpoint === 'http://localhost:11434/v1'))
              added.push({ id: genId('m'), name: m.name, provider: 'ollama', modelId: m.name, endpoint: 'http://localhost:11434/v1', apiKey: '', contextLimit: 32768, canImage: false, isLocal: true });
          });
        }
      } catch (_) {}

      if (added.length > 0) {
        ss.setModels((prev: any[]) => [...prev, ...added]);
        if (!ss.selectedModelId) ss.setSelectedModelId(added[0].id);
        setDetected(added.length);
      }
    } finally {
      setDetecting(false);
    }
  }

  const currentModels = useSettingsStore(s => s.models);
  const gb = hw ? hw.totalMb / 1024 : 0;
  const rec = hw ? recommendSetup({ totalMb: hw.totalMb, isAppleSilicon: hw.isAppleSilicon }) : null;
  const gemini = PROVIDERS.find(p => p.id === 'gemini')!;

  function startConnect(provider: typeof PROVIDERS[0], modelId?: string) {
    setConnectingProvider(provider);
    setConnectingModelId(modelId);
  }

  // A local model finished downloading + launching in ModelStorePanel — wire it in.
  function handleLocalReady(newModel: any) {
    const store = useSettingsStore.getState();
    store.setModels((prev: any[]) => prev.some((m: any) => m.id === newModel.id) ? prev : [...prev, newModel]);
    store.setSelectedModelId(newModel.id);
    store.persist();
  }

  if (connectingProvider) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <StepIcon color="bg-accent/10 dark:bg-accent/20">
            <Zap className="w-6 h-6 text-accent" />
          </StepIcon>
          <div>
            <h2 className="text-xl font-black tracking-tight text-ink">Connect model</h2>
          </div>
        </div>
        <ModelConnectForm
          provider={connectingProvider}
          prefilledModelId={connectingModelId}
          onAdded={() => { setConnectingProvider(null); setConnectingModelId(undefined); }}
          onBack={() => { setConnectingProvider(null); setConnectingModelId(undefined); }}
        />
        {currentModels.length > 0 && (
          <Btn onClick={onNext} variant="ghost" className="w-full">Skip — continue with existing model</Btn>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-accent/10 dark:bg-accent/20">
          <Zap className="w-6 h-6 text-accent" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-ink">AI model</h2>
          <p className="text-xs text-ink-2 mt-0.5">The brain powering your agents.</p>
        </div>
      </div>

      {/* Auto-detect status */}
      {detecting && (
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Looking for LM Studio and Ollama…
        </div>
      )}
      {!detecting && detected > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-success-soft border border-success/30 text-xs text-success">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          {detected === 1 ? '1 local model detected and connected' : `${detected} local models detected and connected`}
        </div>
      )}
      {!detecting && detected === 0 && currentModels.length === 0 && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-inset border border-edge">
          <span className="text-xs text-ink-2">No local models found</span>
          <button onClick={detectLocalModels} className="text-tiny font-bold text-primary hover:underline">Try again</button>
        </div>
      )}

      {/* Existing models */}
      {currentModels.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-tiny font-black uppercase tracking-widest text-ink-3">Connected</p>
            <button onClick={detectLocalModels} disabled={detecting} className="text-tiny text-primary hover:underline disabled:opacity-40">
              {detecting ? 'Detecting…' : 'Re-detect'}
            </button>
          </div>
          {currentModels.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-inset border border-edge">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-ink truncate font-mono">{m.modelId}</p>
                <p className="text-tiny text-ink-3">{m.provider} · {Math.round(m.contextLimit / 1000)}k ctx</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detected hardware */}
      {hw && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-2">Detected:</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-inset border border-edge text-xs font-mono font-bold text-ink-2">
            {hw.chip} · {Math.round(gb)}GB RAM
          </span>
        </div>
      )}

      {/* Recommendation — Apple Silicon downloads & runs locally; otherwise cloud */}
      {rec && rec.kind === 'local' && (
        <div className="space-y-2">
          <p className="text-tiny font-black uppercase tracking-widest text-ink-3">
            Best for your {hw!.chip} — download &amp; run privately
          </p>
          <ModelStorePanel ramMb={hw!.totalMb} isAppleSilicon onModelReady={handleLocalReady} />

          {/* Cloud alternative */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-edge">
            <span className="text-sm">✨</span>
            <p className="text-xs text-ink-2 flex-1 leading-relaxed">
              Prefer the cloud? <strong>Gemini</strong> is free and needs no download.
            </p>
            <button
              onClick={() => startConnect(gemini)}
              className="text-tiny font-black text-primary hover:underline shrink-0"
            >
              Use Gemini
            </button>
          </div>
        </div>
      )}

      {rec && rec.kind === 'cloud' && (
        <div className="space-y-2">
          <p className="text-tiny font-black uppercase tracking-widest text-ink-3">Our recommendation</p>
          <div className="rounded-2xl border-2 border-secondary/30 dark:border-secondary/40 bg-secondary/5 dark:bg-secondary/10 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-0.5">✨</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-sm font-black text-ink">Gemini 2.0 Flash</p>
                  <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-success-soft text-success shrink-0">Free</span>
                  <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-accent text-on-accent shrink-0">Recommended</span>
                </div>
                <p className="text-xs text-secondary-muted dark:text-secondary-light leading-relaxed">
                  {rec.reason}
                </p>
                <div className="grid grid-cols-2 gap-2 mt-2 text-tiny text-secondary dark:text-secondary-muted">
                  <div className="space-y-0.5">
                    <p className="font-black">Cloud ✓</p>
                    <p>Free with generous limits</p>
                    <p>No RAM requirement</p>
                    <p>Always the latest model</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-black text-ink-3">vs Local</p>
                    <p>Sends data to Google</p>
                    <p>Requires internet</p>
                    <p>API key needed (free)</p>
                  </div>
                </div>
              </div>
            </div>
            <Btn onClick={() => startConnect(gemini)} className="w-full">
              Set up Gemini free <ArrowRight className="w-4 h-4" />
            </Btn>
          </div>
        </div>
      )}

      {/* Browse all options */}
      <button
        onClick={() => setShowAllProviders(v => !v)}
        className="text-mini font-black text-ink-3 hover:text-ink-2 text-left"
      >
        {showAllProviders ? '▲ Hide all options' : '▾ Browse all providers (Claude, OpenAI, …)'}
      </button>

      {showAllProviders && (
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => startConnect(p)}
              className={`flex items-center gap-2.5 p-3 rounded-2xl border-2 text-left transition-all duration-150 hover:opacity-90 ${p.color}`}
            >
              <span className="text-xl">{p.emoji}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-black text-ink leading-none">{p.name}</p>
                  {p.free && <span className="text-[8px] font-black uppercase px-1 py-0.5 rounded bg-success-soft text-success">free</span>}
                </div>
                <p className="text-tiny text-ink-2 mt-0.5 leading-tight">{p.sub}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {currentModels.length > 0 ? (
        <Btn onClick={onNext} className="w-full">Continue <ArrowRight className="w-4 h-4" /></Btn>
      ) : (
        <Btn variant="ghost" onClick={onSkip} className="w-full">I'll set this up later</Btn>
      )}
    </div>
  );
}

// ─── Step 5: Brave Search ─────────────────────────────────────────────────────

function StepBraveSearch({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const integrations = useSettingsStore(s => s.integrations);
  const setIntegrations = useSettingsStore(s => s.setIntegrations);
  const [apiKey, setApiKey] = useState(integrations.brave?.apiKey ?? '');
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function testAndSave() {
    const key = apiKey.trim();
    if (!key) return;
    setStatus('testing');
    setErrorMsg('');
    try {
      await fetchWithRetry(`https://api.search.brave.com/res/v1/web/search?q=test&count=1`, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'X-Subscription-Token': key },
      }, 0);
      setIntegrations((prev: any) => ({ ...prev, brave: { enabled: true, apiKey: key } }));
      await useSettingsStore.getState().persist();
      setStatus('ok');
      setTimeout(onNext, 700);
    } catch (e: any) {
      setErrorMsg(e.message ?? String(e));
      setStatus('error');
    }
  }

  function skipAndSave() {
    if (apiKey.trim()) {
      setIntegrations((prev: any) => ({ ...prev, brave: { enabled: true, apiKey: apiKey.trim() } }));
      useSettingsStore.getState().persist();
    }
    onSkip();
  }

  const alreadyConnected = integrations.brave?.enabled && integrations.brave?.apiKey;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-orange-50 dark:bg-orange-900/30">
          <Globe className="w-6 h-6 text-orange-500" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-ink">Web Search</h2>
          <p className="text-xs text-ink-2 mt-0.5">Let Alexis and your other bots search the live internet.</p>
        </div>
      </div>

      {/* Brave pitch */}
      <div className="rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-black text-orange-900 dark:text-orange-100">Brave Search API</p>
          <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-success-soft text-success shrink-0">Free tier</span>
          <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-orange-500 text-white shrink-0">Recommended</span>
        </div>
        <p className="text-xs text-orange-800 dark:text-orange-300 leading-relaxed">
          Privacy-first search engine with its own independent index. The free tier gives you 2,000 queries/month — plenty for daily use.
        </p>
        <div className="grid grid-cols-2 gap-2 text-tiny text-orange-700 dark:text-orange-400">
          <div className="space-y-0.5">
            <p className="font-black">Free ✓</p>
            <p>2,000 queries/month</p>
            <p>No credit card needed</p>
            <p>Independent index</p>
          </div>
          <div className="space-y-0.5">
            <p className="font-black text-ink-3">How to get a key</p>
            <p>Sign up at brave.com/search/api</p>
            <p>Create a free plan app</p>
            <p>Copy the API key below</p>
          </div>
        </div>
        <button
          onClick={() => openUrl('https://brave.com/search/api/')}
          className="flex items-center gap-1 text-tiny font-black text-orange-700 dark:text-orange-400 hover:underline"
        >
          brave.com/search/api <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>

      {alreadyConnected && status === 'idle' ? (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-success-soft border border-success/30">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <p className="text-sm font-bold text-success">Brave Search already connected</p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-tiny font-black uppercase tracking-widest text-ink-3">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="BSA..."
            className="w-full bg-inset border border-edge rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-primary transition-colors"
          />
          {status === 'error' && <p className="text-xs text-danger">{errorMsg}</p>}
          {status === 'ok' && (
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs font-bold">Connected!</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(alreadyConnected && status === 'idle') ? (
          <Btn onClick={onNext} className="w-full">Continue <ArrowRight className="w-4 h-4" /></Btn>
        ) : (
          <Btn onClick={testAndSave} disabled={!apiKey.trim() || status === 'testing' || status === 'ok'} className="w-full">
            {status === 'testing' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</> : <>Connect Brave Search <ArrowRight className="w-4 h-4" /></>}
          </Btn>
        )}
        <Btn variant="ghost" onClick={skipAndSave} className="w-full">Skip for now</Btn>
      </div>
    </div>
  );
}

// ─── Step 6: Relay ────────────────────────────────────────────────────────────

function StepRelay({
  onNext,
  onSkip,
  onResult,
}: {
  onNext: () => void;
  onSkip: () => void;
  onResult: (r: RelaySetupResult) => void;
}) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RelaySetupResult | null>(null);

  async function install() {
    setStatus('loading');
    setError('');
    try {
      const r = await invoke<RelaySetupResult>('setup_relay');
      if (r.ok) {
        setResult(r);
        onResult(r);
        useSettingsStore.getState().setAppSettings((prev: any) => ({
          ...prev,
          forgeInstanceId: r.instanceId,
          inboxOwners: (r.owners ?? []).map((o: any) => ({ id: o.id, label: o.label })),
        }));
        await useSettingsStore.getState().persist();
        setStatus('success');
      } else {
        setError(r.error ?? 'Unknown error');
        setStatus('error');
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStatus('error');
    }
  }

  // Auto-install when step mounts
  useEffect(() => { install(); }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-blue-50 dark:bg-blue-900/30">
          <Server className="w-6 h-6 text-blue-500" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-ink">Capture relay</h2>
          <p className="text-xs text-ink-2 mt-0.5">Your personal inbox server.</p>
        </div>
      </div>

      {/* How capture works — full system diagram */}
      <div className="p-4 rounded-2xl bg-inset border border-edge">
        <p className="text-tiny font-black uppercase tracking-widest text-ink-3 mb-3">How capture works</p>
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { label: 'Any iOS app', sub: 'Safari, Photos, Notes…', color: 'bg-error/20 dark:bg-error/20 text-error dark:text-error' },
            null,
            { label: 'Tap Share', sub: '"Send to Forge" shortcut', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
            null,
            { label: 'Tailscale tunnel', sub: 'anywhere, not just home Wi-Fi', color: 'bg-secondary/10 dark:bg-secondary/20 text-secondary dark:text-secondary-light' },
            null,
            { label: 'Relay on Mac', sub: 'this step sets this up', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
            null,
            { label: 'Inbox', sub: 'ready to process', color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
          ].map((node, i) =>
            node === null ? (
              <span key={i} className="text-ink-3 font-bold text-lg">→</span>
            ) : (
              <div key={i} className={`px-2.5 py-1.5 rounded-xl text-center ${node.color}`}>
                <p className="text-tiny font-black leading-tight">{node.label}</p>
                <p className="text-micro opacity-70 leading-tight mt-0.5">{node.sub}</p>
              </div>
            )
          )}
        </div>
        <p className="text-tiny text-ink-3 mt-3 leading-relaxed">The next few steps set up each piece. You can skip Tailscale if you only capture on home Wi-Fi.</p>
      </div>

      {/* Plain-language explainer */}
      <div className="space-y-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
        <p className="text-tiny font-black uppercase tracking-widest text-blue-500 dark:text-blue-400">What is this?</p>
        <p className="text-sm text-blue-900 dark:text-blue-200 leading-relaxed font-medium">
          A tiny web server that runs quietly on this Mac and wakes up whenever your iPhone sends something.
        </p>
        <div className="space-y-2">
          {[
            { icon: '📱', text: 'You share a link, photo, or note from your iPhone' },
            { icon: '→', text: 'It travels over your network to this Mac' },
            { icon: '📥', text: 'It lands in your Agent Forge inbox, ready to process' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 text-xs text-blue-800 dark:text-blue-300">
              <span className="shrink-0 w-5 text-center">{item.icon}</span>
              <span className="leading-relaxed">{item.text}</span>
            </div>
          ))}
        </div>
        <p className="text-mini text-blue-600 dark:text-blue-400 leading-relaxed border-t border-blue-200 dark:border-blue-700 pt-3">
          It starts automatically every time you log in and uses no CPU when idle. Captures only come from devices you've authorized — nothing from the internet.
        </p>
      </div>

      <div className={`flex items-center gap-3 p-4 rounded-2xl border transition-all duration-500 ${
        status === 'loading' ? 'bg-inset border-edge' :
        status === 'success' ? 'bg-success-soft border-success/30' :
        'bg-danger-soft border-danger/30'
      }`}>
        {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin text-ink-3 shrink-0" />}
        {status === 'success' && <CheckCircle2 className="w-5 h-5 text-success shrink-0" />}
        {status === 'error' && <X className="w-5 h-5 text-danger shrink-0" />}
        <div>
          <p className={`text-sm font-bold ${
            status === 'loading' ? 'text-ink-2' :
            status === 'success' ? 'text-success' :
            'text-danger'
          }`}>
            {status === 'loading' ? 'Installing your relay…' :
             status === 'success' ? 'Relay is running' :
             'Setup failed'}
          </p>
          {result?.instanceId && (
            <p className="text-mini text-success mt-0.5">ID: {result.instanceId}</p>
          )}
          {status === 'success' && (
            <p className="text-mini text-success mt-0.5">Running on port 8765 · starts on login · captures appear in Inbox</p>
          )}
          {error && <p className="text-mini text-danger mt-1 font-mono leading-relaxed">{error}</p>}
        </div>
      </div>

      {status === 'error' && (
        <div className="flex flex-col gap-2">
          <Btn variant="secondary" onClick={install} className="w-full">Try again</Btn>
          <Btn variant="ghost" onClick={onSkip} className="w-full">Skip relay setup</Btn>
        </div>
      )}

      {status === 'success' && (
        <Btn onClick={onNext} className="w-full">
          Continue <ArrowRight className="w-4 h-4" />
        </Btn>
      )}
    </div>
  );
}

// ─── Step 7: Tailscale ────────────────────────────────────────────────────────

function StepTailscale({
  onNext,
  onSkip,
}: {
  onNext: (hostname: string | null) => void;
  onSkip: () => void;
}) {
  const [macDone, setMacDone] = useState(false);
  const [phoneDone, setPhoneDone] = useState(false);
  const [checking, setChecking] = useState(false);
  const [hostname, setHostname] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  async function checkConnection() {
    setChecking(true);
    try {
      const s = await invoke<RelayStatus>('get_relay_status');
      setHostname(s.tailscaleHostname ?? null);
    } finally {
      setChecking(false);
      setChecked(true);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-secondary/10 dark:bg-secondary/20">
          <Wifi className="w-6 h-6 text-secondary" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-ink">Capture from anywhere</h2>
          <p className="text-xs text-ink-2 mt-0.5">Works on your home Wi-Fi now. Tailscale makes it work everywhere.</p>
        </div>
      </div>

      {/* Plain-language explainer */}
      <div className="space-y-3 p-4 rounded-2xl bg-secondary/5 dark:bg-secondary/10 border border-secondary/20 dark:border-secondary/30">
        <p className="text-tiny font-black uppercase tracking-widest text-secondary dark:text-secondary-light">What is Tailscale?</p>
        <p className="text-sm text-ink leading-relaxed font-medium">
          A free app that creates a private network between your devices — like a VPN, but only between your own stuff.
        </p>
        <div className="space-y-1.5 text-xs text-secondary-muted dark:text-secondary-light">
          <div className="flex items-start gap-2">
            <span className="shrink-0">Without it:</span>
            <span className="leading-relaxed opacity-70">iPhone can only reach this Mac when you're on the same Wi-Fi network</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0">With it:</span>
            <span className="leading-relaxed font-bold">iPhone can reach this Mac from anywhere — coffee shop, work, traveling</span>
          </div>
        </div>
        <p className="text-mini text-secondary dark:text-secondary-muted leading-relaxed border-t border-secondary/20 dark:border-secondary/30 pt-3">
          It's free for personal use. Your captures never go through Tailscale's servers — it just helps your devices find each other.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <p className="text-tiny font-black uppercase tracking-widest text-ink-3">Setup — takes about 3 minutes</p>
        {[
          {
            done: macDone,
            set: setMacDone,
            step: '1',
            label: 'Install Tailscale on this Mac',
            detail: 'Download, open it, sign in with Google or GitHub. You\'ll see it in your menu bar.',
            url: 'https://tailscale.com/download/mac',
            urlLabel: 'tailscale.com/download',
          },
          {
            done: phoneDone,
            set: setPhoneDone,
            step: '2',
            label: 'Install Tailscale on your iPhone',
            detail: 'Same app, same account. Once signed in on both, they\'re on the same private network.',
            url: 'https://apps.apple.com/app/tailscale/id1470499037',
            urlLabel: 'App Store → Tailscale',
          },
        ].map((item, i) => (
          <div
            key={i}
            className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all duration-150 cursor-pointer select-none ${item.done ? 'border-success/40 bg-success-soft' : 'border-edge hover:border-edge-2'}`}
            onClick={() => item.set((v: boolean) => !v)}
          >
            <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center border-2 shrink-0 transition-all ${item.done ? 'bg-success border-success text-success-soft' : 'border-edge-2'}`}>
              {item.done ? <Check className="w-3 h-3" /> : <span className="text-micro font-black text-ink-3">{item.step}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-ink">{item.label}</p>
              <p className="text-mini text-ink-2 mt-0.5 leading-relaxed">{item.detail}</p>
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); openUrl(item.url); }}
                onKeyDown={e => e.key === 'Enter' && openUrl(item.url)}
                className="mt-1 inline-flex items-center gap-1 text-mini text-primary hover:underline cursor-pointer"
              >
                {item.urlLabel} <ExternalLink className="w-2.5 h-2.5" />
              </span>
            </div>
          </div>
        ))}
      </div>

      <Btn variant="secondary" onClick={checkConnection} disabled={checking} className="w-full">
        {checking ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Detecting…</> : <><Radio className="w-3.5 h-3.5" /> Detect my Tailscale hostname</>}
      </Btn>

      {checked && (
        hostname ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-success-soft border border-success/30">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-success shrink-0">Connected:</span>
              <CopyChip text={hostname} />
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-accent/5 dark:bg-accent/10 border border-accent/30 dark:border-accent/40">
            <p className="text-xs text-accent leading-relaxed font-medium">Tailscale not detected yet.</p>
            <p className="text-mini text-accent/80 mt-1 leading-relaxed">
              Make sure Tailscale is running on this Mac (check the menu bar) and you're signed in. You can also skip this and do it later — the Shortcut will still work on home Wi-Fi.
            </p>
          </div>
        )
      )}

      <div className="flex flex-col gap-2">
        <Btn onClick={() => onNext(hostname)} className="w-full">
          Continue <ArrowRight className="w-4 h-4" />
        </Btn>
        <Btn variant="ghost" onClick={onSkip} className="w-full">
          Skip — set this up later
        </Btn>
      </div>
    </div>
  );
}

// ─── Step 8: iOS Shortcut ─────────────────────────────────────────────────────

function StepShortcut({
  relayResult,
  tailscaleHostname,
  onNext,
  onSkip,
}: {
  relayResult: RelaySetupResult | null;
  tailscaleHostname: string | null;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [customHost, setCustomHost] = useState(tailscaleHostname ?? '');
  const token = relayResult?.owners?.[0]?.token ?? relayResult?.personalToken ?? '';
  const instanceId = relayResult?.instanceId ?? '';
  const shareId = relayResult?.owners?.[0]?.shareId ?? 'personal-shortcut';
  const host = customHost.trim() || tailscaleHostname || 'YOUR-MAC-HOSTNAME';
  const relayUrl = `http://${host}:8765/v1/captures`;

  const [copiedJson, setCopiedJson] = useState(false);

  const bodyJson = JSON.stringify({
    source: 'ios_shortcut',
    kind: 'text',
    title: 'Shared from iPhone',
    bodyText: '(Shortcut Input)',
    note: '(Note)',
    instanceId,
    shareId,
    deviceName: 'iPhone',
  }, null, 2);

  function copyJson() {
    navigator.clipboard.writeText(bodyJson);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-error/10 dark:bg-error/20">
          <Smartphone className="w-6 h-6 text-error" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-ink">iPhone Shortcut</h2>
          <p className="text-xs text-ink-2 mt-0.5">Share anything to Agent Forge in two taps.</p>
        </div>
      </div>

      {/* What is a Shortcut? */}
      <div className="p-4 rounded-2xl bg-error/5 dark:bg-error/10 border border-error/20 dark:border-error/30">
        <p className="text-tiny font-black uppercase tracking-widest text-error mb-2">What is a Shortcut?</p>
        <p className="text-sm text-ink leading-relaxed font-medium">
          A Shortcut is an iOS automation you build once in the <strong>Shortcuts</strong> app. Once created, <strong>"Send to Agent Forge"</strong> appears in the Share Sheet of every app on your iPhone — Safari, Photos, Notes, anywhere.
        </p>
        <p className="text-mini text-error/80 mt-2 leading-relaxed">
          The Share Sheet is what appears when you tap the box-with-arrow icon in any app. Your Shortcut becomes one of the options there.
        </p>
      </div>

      {/* Relay URL + token */}
      <div className="space-y-2.5 p-4 rounded-2xl bg-inset border border-edge">
        <div className="space-y-1">
          <p className="text-tiny font-black uppercase tracking-widest text-ink-3">Relay URL</p>
          <CopyChip text={relayUrl} label={relayUrl} />
          {!tailscaleHostname && (
            <input
              value={customHost}
              onChange={e => setCustomHost(e.target.value)}
              placeholder="Enter your Mac's Tailscale hostname or IP…"
              className="w-full mt-1.5 bg-panel border border-edge rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-primary transition-colors"
            />
          )}
        </div>
        {token && (
          <div className="space-y-1">
            <p className="text-tiny font-black uppercase tracking-widest text-ink-3">Bearer Token</p>
            <CopyChip text={token} label={token.slice(0, 16) + '…'} />
          </div>
        )}
      </div>

      {/* Request body */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-tiny font-black uppercase tracking-widest text-ink-3">Request Body (paste into Shortcut)</p>
          <button
            onClick={copyJson}
            className="flex items-center gap-1 text-tiny font-bold text-primary hover:text-primary-hover transition-colors"
          >
            {copiedJson ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
        <pre className="text-tiny leading-relaxed bg-inset border border-edge rounded-xl p-3 overflow-x-auto font-mono text-ink-2">
          {bodyJson}
        </pre>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <p className="text-mini font-black uppercase tracking-widest text-ink-3">Build it on your iPhone</p>
        {[
          'Open the Shortcuts app → tap + → name it "Send to Agent Forge"',
          'Tap the ⚙️ settings icon at the top of the editor → enable "Add to Share Sheet" — this is what makes your Shortcut appear when you tap Share in any app',
          'Add: Receive Any input from Share Sheet',
          'Add: Ask for Input → name it "Note" → make it optional',
          'Add: Text → paste the request body above (replace the placeholder values with actual Shortcut variables)',
          'Add: Get Contents of URL → URL from above → POST → add Authorization and Content-Type headers → set body to the Text block',
          'Add: If → Contents of URL contains "ok" → Show Notification "Saved to Forge"',
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-2.5 text-xs text-ink-2">
            <span className="shrink-0 w-4 h-4 rounded-full bg-primary/10 dark:bg-primary/20 text-primary flex items-center justify-center font-black text-micro mt-0.5">{i + 1}</span>
            <span className="leading-relaxed">{step}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Btn onClick={onNext} className="w-full">
          Done — it's set up <ArrowRight className="w-4 h-4" />
        </Btn>
        <Btn variant="ghost" onClick={onSkip} className="w-full">
          I'll do this later
        </Btn>
      </div>
    </div>
  );
}

// ─── Step 9: Done ─────────────────────────────────────────────────────────────

function StepDone({
  relayOk, tailscaleOk, shortcutDone, onFinish,
}: {
  relayOk: boolean; tailscaleOk: boolean; shortcutDone: boolean; onFinish: () => void;
}) {
  const models = useSettingsStore(s => s.models);
  const userProfile = useSettingsStore(s => s.userProfile);
  const integrations = useSettingsStore(s => s.integrations);

  const items = [
    { label: 'Personal profile', done: !!userProfile },
    { label: 'AI model connected', done: models.length > 0 },
    { label: 'Web search', done: !!(integrations.brave?.enabled && integrations.brave?.apiKey) || !!(integrations.tavily?.enabled && integrations.tavily?.apiKey) },
    { label: 'Capture relay', done: relayOk },
    { label: 'Tailscale', done: tailscaleOk },
    { label: 'iPhone Shortcut', done: shortcutDone },
  ];

  function openAlexis() {
    useAgentStore.getState().setActiveFolderId('alexis');
    onFinish();
  }

  return (
    <div className="flex flex-col items-center text-center gap-7">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/20">
        <CheckCircle2 className="w-9 h-9 text-white" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight text-ink">You're all set</h1>
        <p className="text-sm text-ink-2 max-w-xs mx-auto leading-relaxed">
          Agent Forge is ready. You can always revisit any of these in Settings.
        </p>
      </div>
      <div className="w-full max-w-xs space-y-2">
        {items.map((item, i) => (
          <div key={i} className={`flex items-center gap-3 py-2 px-3 rounded-xl transition-colors ${item.done ? '' : 'opacity-40'}`}>
            {item.done
              ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              : <div className="w-4 h-4 rounded-full border-2 border-edge-2 shrink-0" />
            }
            <span className="text-sm text-ink-2">
              {item.label}
              {!item.done && <span className="text-xs text-ink-3 ml-1">(skipped)</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Alexis intro */}
      <div className="w-full max-w-xs rounded-2xl border-2 border-error/30 bg-error/5 dark:bg-error/10 p-4 text-left space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-error flex items-center justify-center shrink-0 shadow-md shadow-error/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-black text-ink">Meet Alexis</p>
            <p className="text-tiny text-ink-2">Your executive assistant — already waiting for you</p>
          </div>
        </div>
        <p className="text-mini text-ink-2 leading-relaxed">
          Confident, sharp, and a little fun. Think of her as your executive assistant — edit her personality, clone her, or use her as a starting point to build your own.
        </p>
        <button
          onClick={openAlexis}
          className="text-tiny font-black uppercase tracking-widest text-error hover:underline"
        >
          Say hi to Alexis →
        </button>
      </div>

      <Btn onClick={onFinish} className="w-full max-w-xs">
        Open Agent Forge <ArrowRight className="w-4 h-4" />
      </Btn>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard({ onClose, initialStep }: Props) {
  const [step, setStep] = useState(initialStep ?? 1);
  const [relayResult, setRelayResult] = useState<RelaySetupResult | null>(null);
  const [tailscaleHostname, setTailscaleHostname] = useState<string | null>(null);
  const [relayOk, setRelayOk] = useState(false);
  const [tailscaleOk, setTailscaleOk] = useState(false);
  const [shortcutDone, setShortcutDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const next = () => setStep(s => Math.min(s + 1, TOTAL_STEPS));
  const back = () => setStep(s => Math.max(s - 1, 1));

  async function finish() {
    useSettingsStore.getState().setOnboardingComplete(true);
    await db.set('onboardingComplete', true);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
      <div className="relative bg-panel-2 w-full max-w-lg rounded-[2rem] shadow-2xl border border-edge flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 shrink-0">
          <button
            onClick={back}
            className={`p-1.5 rounded-xl transition-all ${step > 1 && step < TOTAL_STEPS ? 'hover:bg-wash text-ink-3' : 'invisible'}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-wash text-ink-3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div ref={scrollRef} className="overflow-y-auto flex-1 px-8 pb-8 pt-4 custom-scrollbar">
          <ProgressBar step={step} />

          {step === 1 && <StepWelcome onNext={next} />}
          {step === 2 && <StepProfile onNext={next} />}
          {step === 3 && <StepModel onNext={next} onSkip={next} />}
          {step === 4 && <StepBraveSearch onNext={next} onSkip={next} />}
          {step === 5 && (
            <StepRelay
              onNext={next}
              onSkip={next}
              onResult={r => { setRelayResult(r); setRelayOk(true); }}
            />
          )}
          {step === 6 && (
            <StepTailscale
              onNext={h => { setTailscaleHostname(h); setTailscaleOk(!!h); next(); }}
              onSkip={() => setStep(8)}
            />
          )}
          {step === 7 && (
            <StepShortcut
              relayResult={relayResult}
              tailscaleHostname={tailscaleHostname}
              onNext={() => { setShortcutDone(true); next(); }}
              onSkip={next}
            />
          )}
          {step === 8 && (
            <StepDone
              relayOk={relayOk}
              tailscaleOk={tailscaleOk}
              shortcutDone={shortcutDone}
              onFinish={finish}
            />
          )}
        </div>
      </div>
    </div>
  );
}
