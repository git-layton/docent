import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  ExternalLink,
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
import { db } from '../services/database';

interface Props {
  onClose: () => void;
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

const TOTAL_STEPS = 7;
const genId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ─── Shared primitives ────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round(((step - 1) / (TOTAL_STEPS - 1)) * 100);
  return (
    <div className="w-full h-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden mb-8">
      <div
        className="h-full bg-[#4A5D75] rounded-full transition-all duration-500 ease-out"
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
    primary: 'py-3.5 px-6 bg-[#4A5D75] hover:bg-[#3D4D61] text-white shadow-md',
    secondary: 'py-3 px-5 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800',
    ghost: 'py-2 text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 tracking-wide normal-case font-semibold',
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
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[11px] font-mono text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors max-w-full"
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
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#4A5D75] to-[#2D3A4A] flex items-center justify-center shadow-xl shadow-[#4A5D75]/20">
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
            <div className="w-5 h-5 rounded-full bg-[#4A5D75]/10 dark:bg-[#4A5D75]/20 flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-[#4A5D75]" />
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
  const [name, setName] = useState('');
  const [bio, setBio] = useState(userProfile);

  async function save() {
    const profile = [name.trim() ? `My name is ${name.trim()}.` : '', bio.trim()].filter(Boolean).join('\n\n');
    useSettingsStore.getState().setUserProfile(profile);
    await useSettingsStore.getState().persist();
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-indigo-50 dark:bg-indigo-900/30">
          <User className="w-6 h-6 text-indigo-500" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">About you</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Your agents use this to give you better, more relevant help.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Your name (optional)</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Alex"
            className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#4A5D75] dark:focus:border-[#6A829E] transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Tell your agents about yourself</label>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={5}
            placeholder={`e.g. I'm a product designer at a SaaS startup. I care about clean systems, good writing, and shipping fast. I prefer concise answers with concrete examples. I'm working on building my personal knowledge base and using AI to process ideas faster.`}
            className="w-full resize-none bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-sm leading-relaxed outline-none focus:border-[#4A5D75] dark:focus:border-[#6A829E] transition-colors"
          />
          <p className="text-[11px] text-neutral-400">Be as specific as you like — more context means better responses.</p>
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
    id: 'anthropic',
    name: 'Claude',
    sub: 'Anthropic API',
    emoji: '🧠',
    color: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800',
    activeColor: 'bg-violet-100 dark:bg-violet-900/40 border-violet-400 dark:border-violet-600',
    endpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-6',
    context: 200000,
    local: false,
    keyLabel: 'Anthropic API key',
    keyPlaceholder: 'sk-ant-…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    sub: 'GPT / o-series',
    emoji: '⚡',
    color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
    activeColor: 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 dark:border-emerald-600',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    context: 128000,
    local: false,
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-…',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    sub: 'Runs on this Mac',
    emoji: '🖥',
    color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    activeColor: 'bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-blue-600',
    endpoint: 'http://localhost:1234/v1',
    defaultModel: '',
    context: 32000,
    local: true,
    keyLabel: null,
    keyPlaceholder: null,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    sub: 'Runs on this Mac',
    emoji: '🦙',
    color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    activeColor: 'bg-orange-100 dark:bg-orange-900/40 border-orange-400 dark:border-orange-600',
    endpoint: 'http://localhost:11434/v1',
    defaultModel: '',
    context: 32000,
    local: true,
    keyLabel: null,
    keyPlaceholder: null,
  },
];

function ModelProviderForm({
  ramMb,
  onAdded,
  onSkip,
}: {
  ramMb: number;
  onAdded: () => void;
  onSkip: () => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<typeof PROVIDERS[0] | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [fetchedModels, setFetchedModels] = useState<{ id: string; context: number }[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [status, setStatus] = useState<'idle' | 'fetching' | 'ready' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [manualId, setManualId] = useState('');

  function selectProvider(p: typeof PROVIDERS[0]) {
    setSelectedProvider(p);
    setEndpoint(p.endpoint);
    setApiKey('');
    setFetchedModels([]);
    setSelectedModelId('');
    setStatus('idle');
    setErrorMsg('');
    setManualId(p.defaultModel);
  }

  async function fetchModels() {
    if (!selectedProvider) return;
    setStatus('fetching');
    setErrorMsg('');
    try {
      const ep = (endpoint || selectedProvider.endpoint).replace(/\/$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;
      const res = await fetch(`${ep}/models`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list: { id: string; context: number }[] = (json.data ?? json.models ?? [])
        .filter((m: any) => !m.id?.includes('embed') && !m.id?.includes('image') && !m.id?.includes('dall-e') && !m.id?.includes('whisper') && !m.id?.includes('tts'))
        .map((m: any) => ({ id: m.id, context: m.context_length ?? selectedProvider.context }));
      if (list.length === 0) throw new Error('No chat models found at that endpoint.');
      setFetchedModels(list);
      setSelectedModelId(list[0].id);
      setStatus('ready');
    } catch (e: any) {
      setErrorMsg(e.message ?? String(e));
      setStatus('error');
    }
  }

  function addModel() {
    const mid = selectedModelId || manualId.trim();
    if (!mid || !selectedProvider) return;
    const ctx = fetchedModels.find(m => m.id === mid)?.context ?? selectedProvider.context;
    const newModel = {
      id: genId('m'),
      name: mid,
      provider: selectedProvider.id,
      modelId: mid,
      endpoint: endpoint || selectedProvider.endpoint,
      apiKey: apiKey.trim(),
      contextLimit: ctx,
      canImage: false,
      isLocal: selectedProvider.local,
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
        <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Model added!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Provider cards */}
      <div className="grid grid-cols-2 gap-2">
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            onClick={() => selectProvider(p)}
            className={`flex items-center gap-2.5 p-3 rounded-2xl border-2 text-left transition-all duration-150 ${selectedProvider?.id === p.id ? p.activeColor : p.color + ' hover:opacity-90'}`}
          >
            <span className="text-xl">{p.emoji}</span>
            <div className="min-w-0">
              <p className="text-sm font-black text-neutral-800 dark:text-neutral-200 leading-none">{p.name}</p>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5">{p.sub}</p>
            </div>
            {selectedProvider?.id === p.id && <Check className="w-3.5 h-3.5 text-current ml-auto shrink-0 opacity-60" />}
          </button>
        ))}
      </div>

      {/* Local model recommendations */}
      {selectedProvider?.local && ramMb > 0 && (() => {
        const recs = getLocalRecs(ramMb);
        const gbLabel = Math.round(ramMb / 1024);

        if (recs.length === 0) {
          return (
            <div className="p-4 rounded-2xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 space-y-2">
              <p className="text-sm font-black text-amber-800 dark:text-amber-300">Local models may be slow on {gbLabel}GB</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                Running a capable model locally needs at least 14GB RAM free. On your machine, a free cloud API will give a much better experience.
              </p>
              <button
                onClick={() => { const cp = PROVIDERS.find(p => p.id === 'openai'); if (cp) selectProvider(cp); }}
                className="text-[11px] font-black text-amber-700 dark:text-amber-400 hover:underline"
              >
                Switch to cloud API instead →
              </button>
            </div>
          );
        }

        return (
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
              What to download for your {gbLabel}GB Mac
            </p>
            {recs.map((rec, i) => (
              <div
                key={rec.hfId}
                className={`rounded-2xl border-2 p-3.5 transition-all duration-150 ${
                  manualId === rec.modelId
                    ? 'border-[#4A5D75] bg-[#4A5D75]/5 dark:bg-[#4A5D75]/10'
                    : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="text-lg mt-0.5 shrink-0">{rec.roleEmoji}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-black text-neutral-800 dark:text-neutral-200 leading-snug font-mono">{rec.name}</p>
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[#4A5D75]/10 text-[#4A5D75] dark:text-[#9EADC8] shrink-0">{rec.tag}</span>
                        {i === 0 && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 shrink-0">Start here</span>}
                      </div>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">{rec.description}</p>
                      <p className="text-[10px] text-neutral-400 mt-1">~{rec.ramGb}GB RAM · Search LM Studio: <span className="font-mono">{rec.name}</span></p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      onClick={() => openUrl(`https://huggingface.co/${rec.hfId}`)}
                      className="flex items-center gap-1 text-[10px] font-bold text-[#4A5D75] hover:underline"
                    >
                      HF <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={() => setManualId(manualId === rec.modelId ? '' : rec.modelId)}
                      className={`text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-lg transition-colors ${
                        manualId === rec.modelId
                          ? 'bg-[#4A5D75] text-white'
                          : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600'
                      }`}
                    >
                      {manualId === rec.modelId ? '✓ Selected' : 'Use this'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Download in LM Studio first (search the model name, grab Q4_K_M), then click Connect below.
            </p>
          </div>
        );
      })()}

      {/* Config fields */}
      {selectedProvider && (
        <div className="space-y-3 pt-1">
          {selectedProvider.local && (
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Endpoint</label>
              <input
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-[#4A5D75] transition-colors"
              />
            </div>
          )}
          {selectedProvider.keyLabel && (
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">{selectedProvider.keyLabel}</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={selectedProvider.keyPlaceholder ?? ''}
                className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-[#4A5D75] transition-colors"
              />
            </div>
          )}

          {manualId && status === 'idle' && (
            <Btn onClick={addModel} className="w-full">
              Connect {manualId} <ArrowRight className="w-4 h-4" />
            </Btn>
          )}

          {!manualId && status !== 'ready' && status !== 'error' && (
            <Btn
              variant="secondary"
              onClick={fetchModels}
              disabled={status === 'fetching' || (!selectedProvider.local && !apiKey.trim())}
              className="w-full"
            >
              {status === 'fetching' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching models…</> : 'Fetch available models'}
            </Btn>
          )}

          {status === 'error' && (
            <div className="space-y-2">
              <p className="text-xs text-red-500 dark:text-red-400">{errorMsg}</p>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Enter model ID manually</label>
                <input
                  value={manualId}
                  onChange={e => setManualId(e.target.value)}
                  placeholder={selectedProvider.defaultModel || 'model-id'}
                  className="w-full bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-[#4A5D75] transition-colors"
                />
              </div>
            </div>
          )}

          {status === 'ready' && fetchedModels.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Choose a model</label>
              <div className="max-h-36 overflow-y-auto space-y-1 rounded-xl border border-neutral-200 dark:border-neutral-700 p-1.5 bg-neutral-50 dark:bg-neutral-900">
                {fetchedModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModelId(m.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${selectedModelId === m.id ? 'bg-[#4A5D75] text-white' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'}`}
                  >
                    <span className="font-mono truncate">{m.id}</span>
                    {selectedModelId === m.id && <Check className="w-3 h-3 shrink-0 ml-2" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(status === 'ready' || status === 'error') && (
            <Btn onClick={addModel} disabled={!selectedModelId && !manualId.trim()} className="w-full">
              Connect model <ArrowRight className="w-4 h-4" />
            </Btn>
          )}
        </div>
      )}

      <Btn variant="ghost" onClick={onSkip} className="w-full">
        I'll set this up later
      </Btn>
    </div>
  );
}

function StepModel({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const models = useSettingsStore(s => s.models);
  const [showAddForm, setShowAddForm] = useState(models.length === 0);
  const [ramMb, setRamMb] = useState(0);

  useEffect(() => {
    invoke<{ total_mb: number }>('get_ram_stats')
      .then(r => setRamMb(r.total_mb))
      .catch(() => {});
  }, []);

  const currentModels = useSettingsStore(s => s.models);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <StepIcon color="bg-amber-50 dark:bg-amber-900/30">
          <Zap className="w-6 h-6 text-amber-500" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">AI model</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">The brain powering your agents.</p>
        </div>
      </div>

      {/* Existing models */}
      {currentModels.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Connected models</p>
          {currentModels.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-neutral-800 dark:text-neutral-200 truncate font-mono">{m.modelId}</p>
                <p className="text-[10px] text-neutral-400">{m.provider} · {Math.round(m.contextLimit / 1000)}k ctx</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add another model toggle */}
      {currentModels.length > 0 && !showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className="text-[11px] font-black text-[#4A5D75] hover:underline text-left"
        >
          + Add another model (local or cloud)
        </button>
      )}

      {showAddForm && (
        <ModelProviderForm
          ramMb={ramMb}
          onAdded={() => { setShowAddForm(false); }}
          onSkip={() => setShowAddForm(false)}
        />
      )}

      {!showAddForm && (
        <Btn onClick={onNext} className="w-full">
          Continue <ArrowRight className="w-4 h-4" />
        </Btn>
      )}

      {currentModels.length === 0 && !showAddForm && (
        <Btn variant="ghost" onClick={onSkip} className="w-full">I'll set this up later</Btn>
      )}
    </div>
  );
}

// ─── Step 4: Relay ────────────────────────────────────────────────────────────

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

      {/* Plain-language explainer */}
      <div className="space-y-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
        <p className="text-[10px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-400">What is this?</p>
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
        <p className="text-[11px] text-blue-600 dark:text-blue-400 leading-relaxed border-t border-blue-200 dark:border-blue-700 pt-3">
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
            <p className="text-[11px] text-emerald-600 dark:text-emerald-500 mt-0.5">ID: {result.instanceId}</p>
          )}
          {status === 'success' && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-500 mt-0.5">Running on port 8765 · starts on login</p>
          )}
          {error && <p className="text-[11px] text-red-500 dark:text-red-400 mt-1 font-mono leading-relaxed">{error}</p>}
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

// ─── Step 5: Tailscale ────────────────────────────────────────────────────────

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
        <StepIcon color="bg-violet-50 dark:bg-violet-900/30">
          <Wifi className="w-6 h-6 text-violet-500" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">Capture from anywhere</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Works on your home Wi-Fi now. Tailscale makes it work everywhere.</p>
        </div>
      </div>

      {/* Plain-language explainer */}
      <div className="space-y-3 p-4 rounded-2xl bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800">
        <p className="text-[10px] font-black uppercase tracking-widest text-violet-500 dark:text-violet-400">What is Tailscale?</p>
        <p className="text-sm text-violet-900 dark:text-violet-200 leading-relaxed font-medium">
          A free app that creates a private network between your devices — like a VPN, but only between your own stuff.
        </p>
        <div className="space-y-1.5 text-xs text-violet-800 dark:text-violet-300">
          <div className="flex items-start gap-2">
            <span className="shrink-0">Without it:</span>
            <span className="leading-relaxed opacity-70">iPhone can only reach this Mac when you're on the same Wi-Fi network</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="shrink-0">With it:</span>
            <span className="leading-relaxed font-bold">iPhone can reach this Mac from anywhere — coffee shop, work, traveling</span>
          </div>
        </div>
        <p className="text-[11px] text-violet-600 dark:text-violet-400 leading-relaxed border-t border-violet-200 dark:border-violet-700 pt-3">
          It's free for personal use. Your captures never go through Tailscale's servers — it just helps your devices find each other.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Setup — takes about 3 minutes</p>
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
            detail: 'Same app, same account. Once you\'re signed in on both, they\'re on the same private network.',
            url: 'https://apps.apple.com/app/tailscale/id1470499037',
            urlLabel: 'App Store → Tailscale',
          },
        ].map((item, i) => (
          <button
            key={i}
            onClick={() => item.set((v: boolean) => !v)}
            className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all duration-150 ${item.done ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20' : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'}`}
          >
            <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center border-2 shrink-0 transition-all ${item.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-neutral-300 dark:border-neutral-600'}`}>
              {item.done ? <Check className="w-3 h-3" /> : <span className="text-[9px] font-black text-neutral-400">{item.step}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{item.label}</p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">{item.detail}</p>
              <button
                onClick={e => { e.stopPropagation(); openUrl(item.url); }}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#4A5D75] hover:underline"
              >
                {item.urlLabel} <ExternalLink className="w-2.5 h-2.5" />
              </button>
            </div>
          </button>
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
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed font-medium">Tailscale not detected yet.</p>
            <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1 leading-relaxed">
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
          Skip — I'll only capture at home
        </Btn>
      </div>
    </div>
  );
}

// ─── Step 6: iOS Shortcut ─────────────────────────────────────────────────────

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
        <StepIcon color="bg-rose-50 dark:bg-rose-900/30">
          <Smartphone className="w-6 h-6 text-rose-500" />
        </StepIcon>
        <div>
          <h2 className="text-xl font-black tracking-tight text-neutral-900 dark:text-neutral-100">iPhone Shortcut</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Share anything to Agent Forge in two taps.</p>
        </div>
      </div>

      {/* Relay URL + token */}
      <div className="space-y-2.5 p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700">
        <div className="space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Relay URL</p>
          <CopyChip text={relayUrl} label={relayUrl} />
          {!tailscaleHostname && (
            <input
              value={customHost}
              onChange={e => setCustomHost(e.target.value)}
              placeholder="Enter your Mac's Tailscale hostname or IP…"
              className="w-full mt-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-[#4A5D75] transition-colors"
            />
          )}
        </div>
        {token && (
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Bearer Token</p>
            <CopyChip text={token} label={token.slice(0, 16) + '…'} />
          </div>
        )}
      </div>

      {/* Request body */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Request Body (paste into Shortcut)</p>
          <button
            onClick={copyJson}
            className="flex items-center gap-1 text-[10px] font-bold text-[#4A5D75] hover:text-[#3D4D61] transition-colors"
          >
            {copiedJson ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
        <pre className="text-[10px] leading-relaxed bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 overflow-x-auto font-mono text-neutral-600 dark:text-neutral-400">
          {bodyJson}
        </pre>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-neutral-400">Build it on your iPhone</p>
        {[
          'Open Shortcuts → tap + → name it "Send to Agent Forge"',
          'Tap the ⓘ icon → enable Use as Share Sheet → All input types',
          'Add: Receive Any input from Share Sheet',
          'Add: Ask for Input → name it "Note" → make it optional',
          'Add: Text → paste the request body above (replace the placeholder values with actual Shortcut variables)',
          'Add: Get Contents of URL → URL from above → POST → add Authorization and Content-Type headers → set body to the Text block',
          'Add: If → Contents of URL contains "ok" → Show Notification "Saved to Forge"',
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-2.5 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="shrink-0 w-4 h-4 rounded-full bg-[#4A5D75]/10 dark:bg-[#4A5D75]/20 text-[#4A5D75] flex items-center justify-center font-black text-[9px] mt-0.5">{i + 1}</span>
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

// ─── Step 7: Done ─────────────────────────────────────────────────────────────

function StepDone({
  relayOk, tailscaleOk, shortcutDone, onFinish,
}: {
  relayOk: boolean; tailscaleOk: boolean; shortcutDone: boolean; onFinish: () => void;
}) {
  const models = useSettingsStore(s => s.models);
  const userProfile = useSettingsStore(s => s.userProfile);

  const items = [
    { label: 'Personal profile', done: !!userProfile },
    { label: 'AI model connected', done: models.length > 0 },
    { label: 'Capture relay', done: relayOk },
    { label: 'Tailscale', done: tailscaleOk },
    { label: 'iPhone Shortcut', done: shortcutDone },
  ];

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
      <Btn onClick={onFinish} className="w-full max-w-xs">
        Open Agent Forge <ArrowRight className="w-4 h-4" />
      </Btn>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard({ onClose }: Props) {
  const [step, setStep] = useState(1);
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
          {step === 4 && (
            <StepRelay
              onNext={next}
              onSkip={next}
              onResult={r => { setRelayResult(r); setRelayOk(true); }}
            />
          )}
          {step === 5 && (
            <StepTailscale
              onNext={h => { setTailscaleHostname(h); setTailscaleOk(!!h); next(); }}
              onSkip={next}
            />
          )}
          {step === 6 && (
            <StepShortcut
              relayResult={relayResult}
              tailscaleHostname={tailscaleHostname}
              onNext={() => { setShortcutDone(true); next(); }}
              onSkip={next}
            />
          )}
          {step === 7 && (
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
