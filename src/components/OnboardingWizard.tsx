import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  Cloud,
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

const TOTAL_STEPS = 9;
const genId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ─── Shared primitives ────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round(((step - 1) / (TOTAL_STEPS - 1)) * 100);
  return (
    <div className="w-full h-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden mb-8">
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
    primary: 'py-3.5 px-6 bg-primary hover:bg-primary-hover text-white shadow-md',
    secondary: 'py-3 px-5 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800',
    ghost: 'py-2 text-mini text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 tracking-wide normal-case font-semibold',
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
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-mini font-mono text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors max-w-full"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500 shrink-0" /> : <Copy className="w-3 h-3 shrink-0 opacity-50" />}
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
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-[#2D3A4A] flex items-center justify-center shadow-xl shadow-primary/20">
        <Zap className="w-9 h-9 text-white" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">
          Welcome to Agent Forge
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs mx-auto leading-relaxed">
          Your personal AI command center. Let's get everything set up — it takes about two minutes.
        </p>
      </div>
      <div className="w-full max-w-xs space-y-2.5 text-left">
        {[
          'Personalize your agents with your profile',
          'Connect an AI model',
          'Set up one-tap iPhone capture',
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400">
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
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">About you</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Your agents use this to give you better, more relevant help.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-tiny font-black uppercase tracking-widest text-neutral-400">Your name (optional)</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Alex"
            className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary dark:focus:border-secondary transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-tiny font-black uppercase tracking-widest text-neutral-400">Tell your agents about yourself</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={5}
            placeholder={`e.g. I'm a product designer at a SaaS startup. I care about clean systems, good writing, and shipping fast. I prefer concise answers with concrete examples. I'm working on building my personal knowledge base and using AI to process ideas faster.`}
            className="w-full resize-none bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm leading-relaxed outline-none focus:border-primary dark:focus:border-secondary transition-colors"
          />
          <p className="text-mini text-neutral-400">Be as specific as you like — more context means better responses.</p>
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

// ─── Local model recommendations ─────────────────────────────────────────────

interface LocalRec {
  role: string;
  roleEmoji: string;
  name: string;
  modelId: string;  // what LM Studio returns from /v1/models once loaded
  hfId: string;     // huggingface model id for the download link
  ramGb: number;    // minimum RAM (GB) needed comfortably
  context: number;
  description: string;
  tag: string;      // short badge label
}

// Returns true if the machine has enough RAM to comfortably run Llama 3.3 70B Q4_K_M (~42GB)
export function canRunLlama70B(totalMb: number) {
  return totalMb / 1024 >= 48;
}

function getLocalRecs(totalMb: number): LocalRec[] {
  const gb = totalMb / 1024;

  // 48GB+ — comfortably runs the 70B (Q4_K_M ≈ 42GB)
  if (gb >= 48) {
    return [
      {
        role: 'General',
        roleEmoji: '🦙',
        name: 'Llama-3.3-70B-Instruct',
        modelId: 'llama-3.3-70b-instruct',
        hfId: 'meta-llama/Llama-3.3-70B-Instruct',
        ramGb: 42,
        context: 128000,
        description: 'The best all-rounder for your Mac. Writes beautifully, reasons deeply, handles code — no thinking lag, just instant fluent responses. Q4_K_M fits perfectly in 64GB.',
        tag: 'Best for 64GB',
      },
      {
        role: 'Coder',
        roleEmoji: '💻',
        name: 'Qwen2.5-Coder-32B',
        modelId: 'qwen2.5-coder-32b-instruct',
        hfId: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        ramGb: 20,
        context: 32000,
        description: 'Optional specialist for heavy coding sessions. Beats much larger models on programming tasks and runs fast alongside Llama.',
        tag: 'Best for code',
      },
    ];
  }

  // 28–47GB — 70B won't fit; use Gemma 3 27B as the capable all-rounder
  if (gb >= 28) {
    return [
      {
        role: 'General',
        roleEmoji: '✨',
        name: 'Gemma-3-27B-Instruct',
        modelId: 'gemma-3-27b-instruct',
        hfId: 'google/gemma-3-27b-it',
        ramGb: 17,
        context: 128000,
        description: 'Google\'s sharp 27B model — fast, articulate, and well above its weight class. Great daily driver for 32GB Macs.',
        tag: 'Best for 32GB',
      },
      {
        role: 'Coder',
        roleEmoji: '💻',
        name: 'Qwen2.5-Coder-14B',
        modelId: 'qwen2.5-coder-14b-instruct',
        hfId: 'Qwen/Qwen2.5-Coder-14B-Instruct',
        ramGb: 9,
        context: 32000,
        description: 'Efficient coding specialist — sharp on code, light on RAM, leaves room for the main model.',
        tag: 'Best for code',
      },
    ];
  }

  // 14–27GB — Gemma 4 12B fits well and punches above its weight
  if (gb >= 14) {
    return [
      {
        role: 'General',
        roleEmoji: '✨',
        name: 'Gemma-3-12B-Instruct',
        modelId: 'gemma-3-12b-instruct',
        hfId: 'google/gemma-3-12b-it',
        ramGb: 8,
        context: 128000,
        description: 'Remarkably capable for its size — fast responses, strong reasoning, and fits 16GB with room to spare.',
        tag: 'Best for 16–24GB',
      },
      {
        role: 'Coder',
        roleEmoji: '💻',
        name: 'Qwen2.5-Coder-7B',
        modelId: 'qwen2.5-coder-7b-instruct',
        hfId: 'Qwen/Qwen2.5-Coder-7B-Instruct',
        ramGb: 5,
        context: 32000,
        description: 'Surprisingly capable at code for its size — efficient and quick on constrained hardware.',
        tag: 'Best for code',
      },
    ];
  }

  // ≤13GB — local models will be slow and limited; cloud is the better path
  return [];
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
      <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
        <div>
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Connected!</p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5 font-mono">{selectedModelId || manualId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
        <span className="text-lg">{provider.emoji}</span>
        <div className="min-w-0">
          <p className="text-sm font-black text-neutral-800 dark:text-neutral-200">{provider.name}</p>
          <p className="text-tiny text-neutral-400">{provider.sub}</p>
        </div>
        <button onClick={onBack} className="ml-auto text-tiny font-bold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
          change
        </button>
      </div>

      {provider.free && provider.freeNote && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
          <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-500 text-white shrink-0">Free</span>
          <p className="text-mini text-emerald-700 dark:text-emerald-400">{provider.freeNote}</p>
        </div>
      )}

      {provider.local && (
        <div className="space-y-1">
          <label className="text-tiny font-black uppercase tracking-widest text-neutral-400">Endpoint</label>
          <input
            value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
            className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-primary transition-colors"
          />
        </div>
      )}

      {provider.keyLabel && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-tiny font-black uppercase tracking-widest text-neutral-400">{provider.keyLabel}</label>
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
            className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-primary transition-colors"
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
          <p className="text-xs text-red-500 dark:text-red-400">{errorMsg}</p>
          <div className="space-y-1">
            <label className="text-tiny font-black uppercase tracking-widest text-neutral-400">Enter model ID manually</label>
            <input
              value={manualId}
              onChange={e => setManualId(e.target.value)}
              placeholder={provider.defaultModel || 'model-id'}
              className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-primary transition-colors"
            />
            <Btn onClick={addModel} disabled={!manualId.trim()} className="w-full">
              Connect <ArrowRight className="w-4 h-4" />
            </Btn>
          </div>
        </div>
      )}

      {status === 'ready' && fetchedModels.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-tiny font-black uppercase tracking-widest text-neutral-400">Choose a model</label>
          <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl border border-neutral-200 dark:border-neutral-700 p-1.5 bg-neutral-50 dark:bg-neutral-900 custom-scrollbar">
            {fetchedModels.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedModelId(m.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${selectedModelId === m.id ? 'bg-primary text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'}`}
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
  const [ramMb, setRamMb] = useState(0);
  const [connectingProvider, setConnectingProvider] = useState<typeof PROVIDERS[0] | null>(null);
  const [connectingModelId, setConnectingModelId] = useState<string | undefined>(undefined);
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(0);

  useEffect(() => {
    invoke<{ total_mb: number }>('get_ram_stats')
      .then(r => setRamMb(r.total_mb))
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
  const gb = ramMb / 1024;
  const recs = getLocalRecs(ramMb);
  const hasLocalRec = recs.length > 0 && gb >= 14;
  const lmStudio = PROVIDERS.find(p => p.id === 'lmstudio')!;
  const gemini = PROVIDERS.find(p => p.id === 'gemini')!;
  const primaryRec = recs[0] ?? null;
  const coderRec = recs[1] ?? null;

  function startConnect(provider: typeof PROVIDERS[0], modelId?: string) {
    setConnectingProvider(provider);
    setConnectingModelId(modelId);
  }

  if (connectingProvider) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <StepIcon color="bg-accent/10 dark:bg-accent/20">
            <Zap className="w-6 h-6 text-accent" />
          </StepIcon>
          <div>
            <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">Connect model</h2>
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
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">AI model</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">The brain powering your agents.</p>
        </div>
      </div>

      {/* Auto-detect status */}
      {detecting && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Looking for LM Studio and Ollama…
        </div>
      )}
      {!detecting && detected > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          {detected === 1 ? '1 local model detected and connected' : `${detected} local models detected and connected`}
        </div>
      )}
      {!detecting && detected === 0 && currentModels.length === 0 && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
          <span className="text-xs text-neutral-500">No local models found</span>
          <button onClick={detectLocalModels} className="text-tiny font-bold text-primary hover:underline">Try again</button>
        </div>
      )}

      {/* Existing models */}
      {currentModels.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-tiny font-black uppercase tracking-widest text-neutral-400">Connected</p>
            <button onClick={detectLocalModels} disabled={detecting} className="text-tiny text-primary hover:underline disabled:opacity-40">
              {detecting ? 'Detecting…' : 'Re-detect'}
            </button>
          </div>
          {currentModels.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-neutral-800 dark:text-neutral-200 truncate font-mono">{m.modelId}</p>
                <p className="text-tiny text-neutral-400">{m.provider} · {Math.round(m.contextLimit / 1000)}k ctx</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recommendation section */}
      {ramMb > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-tiny font-black uppercase tracking-widest text-neutral-400">
              {hasLocalRec ? `Best for your ${Math.round(gb)}GB Mac` : 'Our recommendation'}
            </p>
          </div>

          {hasLocalRec && primaryRec ? (
            <>
              {/* Primary local recommendation */}
              <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 dark:bg-primary/10 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-2xl mt-0.5 shrink-0">{primaryRec.roleEmoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-black text-neutral-900 dark:text-neutral-100 font-mono">{primaryRec.name}</p>
                      <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-primary text-white shrink-0">Top pick</span>
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{primaryRec.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-tiny text-neutral-400">~{primaryRec.ramGb}GB RAM · via LM Studio</span>
                      <button
                        onClick={() => openUrl(`https://huggingface.co/${primaryRec.hfId}`)}
                        className="flex items-center gap-1 text-tiny font-bold text-primary hover:underline"
                      >
                        HuggingFace <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 pt-1 border-t border-primary/10">
                  <div className="grid grid-cols-2 gap-2 text-tiny text-neutral-500 dark:text-neutral-400">
                    <div className="space-y-1">
                      <p className="font-black text-emerald-600 dark:text-emerald-400">Local ✓</p>
                      <p>Private — nothing leaves your Mac</p>
                      <p>Free — no API costs ever</p>
                      <p>Fast — no network latency</p>
                    </div>
                    <div className="space-y-1">
                      <p className="font-black text-neutral-400">vs Cloud</p>
                      <p>Needs ~{primaryRec.ramGb}GB free RAM</p>
                      <p>Download once (~25GB)</p>
                      <p>Works offline</p>
                    </div>
                  </div>
                  <p className="text-tiny text-neutral-400 leading-relaxed">
                    Download in LM Studio: search <span className="font-mono">{primaryRec.name}</span>, grab the <span className="font-mono">Q4_K_M</span> variant.
                  </p>
                </div>
                <Btn onClick={() => startConnect(lmStudio, primaryRec.modelId)} className="w-full">
                  Set up LM Studio with {primaryRec.name} <ArrowRight className="w-4 h-4" />
                </Btn>
              </div>

              {/* Coder model option */}
              {coderRec && (
                <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/40 p-4 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <span className="text-base mt-0.5 shrink-0">{coderRec.roleEmoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-black text-neutral-800 dark:text-neutral-200 font-mono">{coderRec.name}</p>
                        <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400 shrink-0">{coderRec.tag}</span>
                      </div>
                      <p className="text-mini text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">{coderRec.description}</p>
                      <p className="text-tiny text-neutral-400 mt-1">~{coderRec.ramGb}GB RAM · add after the main model</p>
                    </div>
                    <button
                      onClick={() => startConnect(lmStudio, coderRec.modelId)}
                      className="text-tiny font-black text-primary hover:underline shrink-0"
                    >
                      Add this
                    </button>
                  </div>
                </div>
              )}

              {/* Cloud alternative */}
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700">
                <span className="text-sm">✨</span>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 flex-1 leading-relaxed">
                  Or use <strong>Gemini</strong> — free cloud API, great if you want instant setup
                </p>
                <button
                  onClick={() => startConnect(gemini)}
                  className="text-tiny font-black text-primary hover:underline shrink-0"
                >
                  Use Gemini
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Low RAM — cloud first */}
              <div className="rounded-2xl border-2 border-secondary/30 dark:border-secondary/40 bg-secondary/5 dark:bg-secondary/10 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-2xl mt-0.5">✨</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-black text-neutral-900 dark:text-secondary-light">Gemini 2.0 Flash</p>
                      <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-500 text-white shrink-0">Free</span>
                      <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-secondary text-white shrink-0">Recommended</span>
                    </div>
                    <p className="text-xs text-secondary-muted dark:text-secondary-light leading-relaxed">
                      Your Mac has {Math.round(gb)}GB RAM — not enough for a capable local model. Gemini's free tier is fast, smart, and has no download required.
                    </p>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-tiny text-secondary dark:text-secondary-muted">
                      <div className="space-y-0.5">
                        <p className="font-black">Cloud ✓</p>
                        <p>Free with generous limits</p>
                        <p>No RAM requirement</p>
                        <p>Always the latest model</p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="font-black text-neutral-400">vs Local</p>
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
            </>
          )}
        </div>
      )}

      {/* Browse all options */}
      <button
        onClick={() => setShowAllProviders(v => !v)}
        className="text-mini font-black text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 text-left"
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
                  <p className="text-sm font-black text-neutral-800 dark:text-neutral-200 leading-none">{p.name}</p>
                  {p.free && <span className="text-[8px] font-black uppercase px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">free</span>}
                </div>
                <p className="text-tiny text-neutral-500 dark:text-neutral-400 mt-0.5 leading-tight">{p.sub}</p>
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

// ─── Step 4: Hardware-Aware Model Tier ───────────────────────────────────────

interface TierDef {
  id: string;
  label: string;
  tagline: string;
  modelName: string;
  ollamaId: string;
  endpoint: string;
  provider: string;
  contextLimit: number;
  isLocal: boolean;
  description: string;
  minGb: number;
}

const TIERS: TierDef[] = [
  {
    id: 'heavy',
    label: 'Heavy Hitter',
    tagline: 'Best open-source local model',
    modelName: 'Llama 3.3 70B',
    ollamaId: 'llama3.3:70b',
    endpoint: 'http://localhost:11434/v1',
    provider: 'ollama',
    contextLimit: 131072,
    isLocal: true,
    description: 'The most capable open-source local model. Your 48GB+ machine can handle it comfortably via Ollama.',
    minGb: 48,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    tagline: 'Great all-rounder for 24GB+',
    modelName: 'Gemma 4 27B',
    ollamaId: 'gemma4:27b',
    endpoint: 'http://localhost:11434/v1',
    provider: 'ollama',
    contextLimit: 131072,
    isLocal: true,
    description: 'Strong reasoning and writing in a package that fits 24GB RAM. Fast and capable via Ollama.',
    minGb: 24,
  },
  {
    id: 'lightweight',
    label: 'Lightweight',
    tagline: 'Efficient model for 12GB+',
    modelName: 'Gemma 4 12B',
    ollamaId: 'gemma4:12b',
    endpoint: 'http://localhost:11434/v1',
    provider: 'ollama',
    contextLimit: 131072,
    isLocal: true,
    description: 'Remarkably capable for its size. Runs well on 12GB+ Macs and leaves room for other apps.',
    minGb: 12,
  },
  {
    id: 'cloud',
    label: 'Cloud-powered',
    tagline: 'Free Gemini API — no download needed',
    modelName: 'Gemini 2.5 Flash',
    ollamaId: 'gemini-2.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    provider: 'gemini',
    contextLimit: 1000000,
    isLocal: false,
    description: 'Your Mac has less than 12GB RAM. Gemini\'s free tier is fast, smart, and requires no download.',
    minGb: 0,
  },
];

function getRecommendedTier(totalMb: number): TierDef {
  const gb = totalMb / 1024;
  if (gb >= 48) return TIERS[0];
  if (gb >= 24) return TIERS[1];
  if (gb >= 12) return TIERS[2];
  return TIERS[3];
}

function StepModelTier({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [totalMb, setTotalMb] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<TierDef | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<{ total_mb: number }>('get_ram_stats')
      .then(r => {
        setTotalMb(r.total_mb);
        setSelected(getRecommendedTier(r.total_mb));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  function applyTier(tier: TierDef) {
    const store = useSettingsStore.getState();
    const newModel = {
      id: genId('m'),
      name: tier.modelName,
      provider: tier.provider,
      modelId: tier.ollamaId,
      endpoint: tier.endpoint,
      apiKey: '',
      contextLimit: tier.contextLimit,
      canImage: false,
      isLocal: tier.isLocal,
    };
    store.setModels((prev: any[]) => [...prev, newModel]);
    store.setSelectedModelId(newModel.id);
    store.persist();
    setSaved(true);
    setTimeout(onNext, 500);
  }

  const totalGb = totalMb != null ? Math.round(totalMb / 1024) : 0;
  const recommended = totalMb != null ? getRecommendedTier(totalMb) : null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Detecting your hardware…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <StepIcon color="bg-accent/10 dark:bg-accent/20">
            <Zap className="w-6 h-6 text-accent" />
          </StepIcon>
          <div>
            <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">Recommended setup</h2>
          </div>
        </div>
        <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Couldn't detect hardware — you can configure your model in Settings.</p>
        </div>
        <Btn variant="ghost" onClick={onSkip} className="w-full">I'll configure this later</Btn>
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
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">Recommended setup for your Mac</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Detected:</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-xs font-mono font-bold text-neutral-700 dark:text-neutral-300">
              {totalGb}GB RAM
            </span>
          </div>
        </div>
      </div>

      {/* Recommended tier — highlighted */}
      {recommended && (
        <div
          onClick={() => setSelected(recommended)}
          className={`rounded-2xl border-2 p-4 space-y-3 cursor-pointer transition-all duration-150 ${selected?.id === recommended.id ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'}`}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
              {recommended.isLocal ? <Server className="w-5 h-5 text-primary" /> : <Cloud className="w-5 h-5 text-primary" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <p className="text-sm font-black text-neutral-900 dark:text-neutral-100">{recommended.label}</p>
                <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-primary text-white shrink-0">Recommended</span>
              </div>
              <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300 font-mono">{recommended.modelName}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">{recommended.description}</p>
            </div>
            {selected?.id === recommended.id && <Check className="w-4 h-4 text-primary shrink-0 mt-1" />}
          </div>
          {selected?.id === recommended.id && (
            <Btn
              onClick={() => applyTier(recommended)}
              disabled={saved}
              className="w-full"
            >
              {saved ? <><CheckCircle2 className="w-4 h-4" /> Set!</> : <>Set as default <ArrowRight className="w-4 h-4" /></>}
            </Btn>
          )}
        </div>
      )}

      {/* Alternative tiers */}
      {TIERS.filter(t => t.id !== recommended?.id).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-tiny font-black uppercase tracking-widest text-neutral-400">Alternatives</p>
          {TIERS.filter(t => t.id !== recommended?.id).map(tier => (
            <div
              key={tier.id}
              onClick={() => setSelected(tier)}
              className={`rounded-xl border p-3 cursor-pointer transition-all duration-150 space-y-2 ${selected?.id === tier.id ? 'border-primary/50 bg-primary/5 dark:bg-primary/10' : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 bg-neutral-50 dark:bg-neutral-800/40'}`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                  {tier.isLocal ? <Server className="w-3.5 h-3.5 text-neutral-500" /> : <Cloud className="w-3.5 h-3.5 text-neutral-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-black text-neutral-800 dark:text-neutral-200">{tier.label}</p>
                    <span className="text-micro text-neutral-400 dark:text-neutral-500 font-mono">·</span>
                    <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">{tier.modelName}</p>
                  </div>
                  <p className="text-mini text-neutral-400 dark:text-neutral-500 mt-0.5">{tier.tagline}</p>
                </div>
                {selected?.id === tier.id && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </div>
              {selected?.id === tier.id && (
                <Btn
                  onClick={() => applyTier(tier)}
                  disabled={saved}
                  className="w-full"
                >
                  {saved ? <><CheckCircle2 className="w-4 h-4" /> Set!</> : <>Set as default <ArrowRight className="w-4 h-4" /></>}
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}

      <Btn variant="ghost" onClick={onSkip} className="w-full">I'll configure this later</Btn>
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
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">Web Search</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Let Lexi and your other bots search the live internet.</p>
        </div>
      </div>

      {/* Brave pitch */}
      <div className="rounded-2xl border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-black text-orange-900 dark:text-orange-100">Brave Search API</p>
          <span className="text-micro font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-500 text-white shrink-0">Free tier</span>
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
            <p className="font-black text-neutral-400">How to get a key</p>
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
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Brave Search already connected</p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-tiny font-black uppercase tracking-widest text-neutral-400">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="BSA..."
            className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-primary transition-colors"
          />
          {status === 'error' && <p className="text-xs text-red-500">{errorMsg}</p>}
          {status === 'ok' && (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
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
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">Capture relay</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Your personal inbox server.</p>
        </div>
      </div>

      {/* How capture works — full system diagram */}
      <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700">
        <p className="text-tiny font-black uppercase tracking-widest text-neutral-400 mb-3">How capture works</p>
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
              <span key={i} className="text-neutral-300 dark:text-neutral-600 font-bold text-lg">→</span>
            ) : (
              <div key={i} className={`px-2.5 py-1.5 rounded-xl text-center ${node.color}`}>
                <p className="text-tiny font-black leading-tight">{node.label}</p>
                <p className="text-micro opacity-70 leading-tight mt-0.5">{node.sub}</p>
              </div>
            )
          )}
        </div>
        <p className="text-tiny text-neutral-400 mt-3 leading-relaxed">The next few steps set up each piece. You can skip Tailscale if you only capture on home Wi-Fi.</p>
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
        status === 'loading' ? 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700' :
        status === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' :
        'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
      }`}>
        {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin text-neutral-400 shrink-0" />}
        {status === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
        {status === 'error' && <X className="w-5 h-5 text-red-500 shrink-0" />}
        <div>
          <p className={`text-sm font-bold ${
            status === 'loading' ? 'text-neutral-600 dark:text-neutral-400' :
            status === 'success' ? 'text-emerald-800 dark:text-emerald-300' :
            'text-red-700 dark:text-red-400'
          }`}>
            {status === 'loading' ? 'Installing your relay…' :
             status === 'success' ? 'Relay is running' :
             'Setup failed'}
          </p>
          {result?.instanceId && (
            <p className="text-mini text-emerald-600 dark:text-emerald-500 mt-0.5">ID: {result.instanceId}</p>
          )}
          {status === 'success' && (
            <p className="text-mini text-emerald-600 dark:text-emerald-500 mt-0.5">Running on port 8765 · starts on login · captures appear in Inbox</p>
          )}
          {error && <p className="text-mini text-red-500 dark:text-red-400 mt-1 font-mono leading-relaxed">{error}</p>}
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
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">Capture from anywhere</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Works on your home Wi-Fi now. Tailscale makes it work everywhere.</p>
        </div>
      </div>

      {/* Plain-language explainer */}
      <div className="space-y-3 p-4 rounded-2xl bg-secondary/5 dark:bg-secondary/10 border border-secondary/20 dark:border-secondary/30">
        <p className="text-tiny font-black uppercase tracking-widest text-secondary dark:text-secondary-light">What is Tailscale?</p>
        <p className="text-sm text-neutral-900 dark:text-secondary-light leading-relaxed font-medium">
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
        <p className="text-tiny font-black uppercase tracking-widest text-neutral-400">Setup — takes about 3 minutes</p>
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
            className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all duration-150 cursor-pointer select-none ${item.done ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20' : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'}`}
            onClick={() => item.set((v: boolean) => !v)}
          >
            <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center border-2 shrink-0 transition-all ${item.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-neutral-300 dark:border-neutral-600'}`}>
              {item.done ? <Check className="w-3 h-3" /> : <span className="text-micro font-black text-neutral-400">{item.step}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{item.label}</p>
              <p className="text-mini text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">{item.detail}</p>
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
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 shrink-0">Connected:</span>
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
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">iPhone Shortcut</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Share anything to Agent Forge in two taps.</p>
        </div>
      </div>

      {/* What is a Shortcut? */}
      <div className="p-4 rounded-2xl bg-error/5 dark:bg-error/10 border border-error/20 dark:border-error/30">
        <p className="text-tiny font-black uppercase tracking-widest text-error mb-2">What is a Shortcut?</p>
        <p className="text-sm text-neutral-900 dark:text-neutral-200 leading-relaxed font-medium">
          A Shortcut is an iOS automation you build once in the <strong>Shortcuts</strong> app. Once created, <strong>"Send to Agent Forge"</strong> appears in the Share Sheet of every app on your iPhone — Safari, Photos, Notes, anywhere.
        </p>
        <p className="text-mini text-error/80 mt-2 leading-relaxed">
          The Share Sheet is what appears when you tap the box-with-arrow icon in any app. Your Shortcut becomes one of the options there.
        </p>
      </div>

      {/* Relay URL + token */}
      <div className="space-y-2.5 p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
        <div className="space-y-1">
          <p className="text-tiny font-black uppercase tracking-widest text-neutral-400">Relay URL</p>
          <CopyChip text={relayUrl} label={relayUrl} />
          {!tailscaleHostname && (
            <input
              value={customHost}
              onChange={e => setCustomHost(e.target.value)}
              placeholder="Enter your Mac's Tailscale hostname or IP…"
              className="w-full mt-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-primary transition-colors"
            />
          )}
        </div>
        {token && (
          <div className="space-y-1">
            <p className="text-tiny font-black uppercase tracking-widest text-neutral-400">Bearer Token</p>
            <CopyChip text={token} label={token.slice(0, 16) + '…'} />
          </div>
        )}
      </div>

      {/* Request body */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-tiny font-black uppercase tracking-widest text-neutral-400">Request Body (paste into Shortcut)</p>
          <button
            onClick={copyJson}
            className="flex items-center gap-1 text-tiny font-bold text-primary hover:text-primary-hover transition-colors"
          >
            {copiedJson ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
        <pre className="text-tiny leading-relaxed bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 overflow-x-auto font-mono text-neutral-600 dark:text-neutral-400">
          {bodyJson}
        </pre>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <p className="text-mini font-black uppercase tracking-widest text-neutral-400">Build it on your iPhone</p>
        {[
          'Open the Shortcuts app → tap + → name it "Send to Agent Forge"',
          'Tap the ⚙️ settings icon at the top of the editor → enable "Add to Share Sheet" — this is what makes your Shortcut appear when you tap Share in any app',
          'Add: Receive Any input from Share Sheet',
          'Add: Ask for Input → name it "Note" → make it optional',
          'Add: Text → paste the request body above (replace the placeholder values with actual Shortcut variables)',
          'Add: Get Contents of URL → URL from above → POST → add Authorization and Content-Type headers → set body to the Text block',
          'Add: If → Contents of URL contains "ok" → Show Notification "Saved to Forge"',
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-2.5 text-xs text-neutral-600 dark:text-neutral-400">
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

  function openLexi() {
    useAgentStore.getState().setActiveFolderId('lexi');
    onFinish();
  }

  return (
    <div className="flex flex-col items-center text-center gap-7">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/20">
        <CheckCircle2 className="w-9 h-9 text-white" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">You're all set</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs mx-auto leading-relaxed">
          Agent Forge is ready. You can always revisit any of these in Settings.
        </p>
      </div>
      <div className="w-full max-w-xs space-y-2">
        {items.map((item, i) => (
          <div key={i} className={`flex items-center gap-3 py-2 px-3 rounded-xl transition-colors ${item.done ? '' : 'opacity-40'}`}>
            {item.done
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              : <div className="w-4 h-4 rounded-full border-2 border-neutral-300 dark:border-neutral-600 shrink-0" />
            }
            <span className="text-sm text-neutral-700 dark:text-neutral-300">
              {item.label}
              {!item.done && <span className="text-xs text-neutral-400 ml-1">(skipped)</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Lexi intro */}
      <div className="w-full max-w-xs rounded-2xl border-2 border-error/30 bg-error/5 dark:bg-error/10 p-4 text-left space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-error flex items-center justify-center shrink-0 shadow-md shadow-error/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-black text-neutral-900 dark:text-neutral-100">Meet Lexi</p>
            <p className="text-tiny text-neutral-500 dark:text-neutral-400">Your first ForgeBot — already waiting for you</p>
          </div>
        </div>
        <p className="text-mini text-neutral-600 dark:text-neutral-400 leading-relaxed">
          Confident, sharp, and a little fun. She's a showcase of what a ForgeBot can be — edit her personality, clone her, or use her as a starting point to build your own.
        </p>
        <button
          onClick={openLexi}
          className="text-tiny font-black uppercase tracking-widest text-error hover:underline"
        >
          Say hi to Lexi →
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
      <div className="relative bg-white dark:bg-neutral-900 w-full max-w-lg rounded-[2rem] shadow-2xl border border-neutral-200/80 dark:border-neutral-800 flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 shrink-0">
          <button
            onClick={back}
            className={`p-1.5 rounded-xl transition-all ${step > 1 && step < TOTAL_STEPS ? 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400' : 'invisible'}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 transition-colors"
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
          {step === 4 && <StepModelTier onNext={next} onSkip={next} />}
          {step === 5 && <StepBraveSearch onNext={next} onSkip={next} />}
          {step === 6 && (
            <StepRelay
              onNext={next}
              onSkip={next}
              onResult={r => { setRelayResult(r); setRelayOk(true); }}
            />
          )}
          {step === 7 && (
            <StepTailscale
              onNext={h => { setTailscaleHostname(h); setTailscaleOk(!!h); next(); }}
              onSkip={() => setStep(9)}
            />
          )}
          {step === 8 && (
            <StepShortcut
              relayResult={relayResult}
              tailscaleHostname={tailscaleHostname}
              onNext={() => { setShortcutDone(true); next(); }}
              onSkip={next}
            />
          )}
          {step === 9 && (
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
