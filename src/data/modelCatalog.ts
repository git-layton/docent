export interface CatalogModel {
  id: string;
  name: string;
  ggufFilename: string;
  downloadUrl: string;
  sizeMb: number;
  ramGb: number;       // minimum comfortable RAM
  contextK: number;
  role: 'General' | 'Coder' | 'Reasoning';
  bestFor: string;
  notGreatFor: string;
  tag?: string;        // badge shown on card; also marks model as a top pick
  primary?: boolean;   // THE single get-started pick for its RAM tier (drives recommendSetup)
  gated?: boolean;     // requires HuggingFace login — show link instead of download
  gatedUrl?: string;
  // Local vision: a natively-multimodal model (e.g. Gemma 3) becomes image-capable when llama-server
  // is launched with its CLIP projector (--mmproj). Download mmprojFilename from mmprojUrl alongside
  // the model and pass the on-disk path to start_local_model.
  vision?: boolean;
  mmprojUrl?: string;
  mmprojFilename?: string;
}

// ─── 8 GB tier ────────────────────────────────────────────────────────────────
// All fit in 8GB RAM. Smallest, fastest to download.

const TIER_8: CatalogModel[] = [
  {
    id: 'qwen25-7b',
    name: 'Qwen 2.5 7B',
    ggufFilename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    sizeMb: 4792,
    ramGb: 8,
    contextK: 32,
    role: 'General',
    bestFor: 'Chat, Q&A, writing, analysis',
    notGreatFor: 'Complex multi-step coding',
    tag: 'Best for 8GB',
    primary: true,
  },
  {
    id: 'qwen25coder-7b',
    name: 'Qwen 2.5 Coder 7B',
    ggufFilename: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    sizeMb: 4792,
    ramGb: 8,
    contextK: 32,
    role: 'Coder',
    bestFor: 'Code generation, debugging, quick scripts',
    notGreatFor: 'Long natural-language conversations',
  },
  {
    id: 'deepseek-r1-7b',
    name: 'DeepSeek R1 7B',
    ggufFilename: 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf',
    sizeMb: 4792,
    ramGb: 8,
    contextK: 32,
    role: 'Reasoning',
    bestFor: 'Step-by-step reasoning, math, logic problems',
    notGreatFor: 'Casual chat, creative writing',
  },
  {
    id: 'gemma3-4b',
    name: 'Gemma 3 4B',
    ggufFilename: 'google_gemma-3-4b-it-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/google_gemma-3-4b-it-Q4_K_M.gguf',
    sizeMb: 2490,
    ramGb: 8,
    contextK: 128,
    role: 'General',
    bestFor: 'Reads images on a small Mac — the lightest local vision option, plus fluent writing',
    notGreatFor: 'Complex reasoning or coding (it is small)',
    tag: 'Vision · Low-RAM',
    vision: true,
    mmprojUrl: 'https://huggingface.co/bartowski/google_gemma-3-4b-it-GGUF/resolve/main/mmproj-google_gemma-3-4b-it-f16.gguf',
    mmprojFilename: 'mmproj-google_gemma-3-4b-it-f16.gguf',
  },
];

// ─── 16 GB tier ───────────────────────────────────────────────────────────────

const TIER_16: CatalogModel[] = [
  {
    id: 'qwen25-14b',
    name: 'Qwen 2.5 14B',
    ggufFilename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    sizeMb: 9206,
    ramGb: 16,
    contextK: 32,
    role: 'General',
    bestFor: 'Complex reasoning, long documents, nuanced responses',
    notGreatFor: 'Quick simple Q&A (slight overhead)',
    tag: 'Best for 16GB',
  },
  {
    id: 'phi4',
    name: 'Phi 4',
    ggufFilename: 'phi-4-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/phi-4-GGUF/resolve/main/phi-4-Q4_K_M.gguf',
    sizeMb: 9318,
    ramGb: 16,
    contextK: 16,
    role: 'General',
    bestFor: 'Reasoning, STEM, instruction-following — punches above its weight',
    notGreatFor: 'Very long contexts (16K limit)',
    tag: 'Compact powerhouse',
  },
  {
    id: 'qwen25coder-14b',
    name: 'Qwen 2.5 Coder 14B',
    ggufFilename: 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
    sizeMb: 9206,
    ramGb: 16,
    contextK: 32,
    role: 'Coder',
    bestFor: 'Complex code, architecture, full file generation',
    notGreatFor: 'Simple conversational tasks',
  },
  {
    id: 'deepseek-r1-14b',
    name: 'DeepSeek R1 14B',
    ggufFilename: 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf',
    sizeMb: 8939,
    ramGb: 16,
    contextK: 32,
    role: 'Reasoning',
    bestFor: 'Deep reasoning, math, code with step-by-step explanations',
    notGreatFor: 'Casual chat, fast one-liners',
  },
  {
    id: 'gemma3-12b',
    name: 'Gemma 3 12B',
    ggufFilename: 'google_gemma-3-12b-it-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF/resolve/main/google_gemma-3-12b-it-Q4_K_M.gguf',
    sizeMb: 7301,
    ramGb: 16,
    contextK: 128,
    role: 'General',
    bestFor: 'Fluent writing, instruction-following, long context (128K), reads images',
    notGreatFor: 'Complex code generation',
    tag: 'Google · Vision',
    primary: true,
    vision: true,
    mmprojUrl: 'https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF/resolve/main/mmproj-google_gemma-3-12b-it-f16.gguf',
    mmprojFilename: 'mmproj-google_gemma-3-12b-it-f16.gguf',
  },
];

// ─── 32 GB tier ───────────────────────────────────────────────────────────────

const TIER_32: CatalogModel[] = [
  {
    id: 'qwen25-32b',
    name: 'Qwen 2.5 32B',
    ggufFilename: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-32B-Instruct-GGUF/resolve/main/Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    sizeMb: 20317,
    ramGb: 32,
    contextK: 32,
    role: 'General',
    bestFor: 'Near-GPT-4 quality, long context, deep reasoning — fully private, no API costs',
    notGreatFor: 'Macs with less than 32GB RAM',
    tag: 'Best for 32GB',
  },
  {
    id: 'qwen25coder-32b',
    name: 'Qwen 2.5 Coder 32B',
    ggufFilename: 'Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf',
    sizeMb: 20317,
    ramGb: 32,
    contextK: 32,
    role: 'Coder',
    bestFor: 'Coding king — runs fast, beats larger models at scripts, repos, and complex refactors',
    notGreatFor: 'Creative writing or open-ended philosophical chat',
    tag: 'Coding king',
  },
  {
    id: 'gemma3-27b',
    name: 'Gemma 3 27B',
    ggufFilename: 'google_gemma-3-27b-it-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/google_gemma-3-27b-it-GGUF/resolve/main/google_gemma-3-27b-it-Q4_K_M.gguf',
    sizeMb: 16550,
    ramGb: 32,
    contextK: 128,
    role: 'General',
    bestFor: 'Writing, analysis, very long context (128K), instruction-following, reads images',
    notGreatFor: 'Heavy coding tasks',
    tag: 'Google · Vision',
    primary: true,
    vision: true,
    mmprojUrl: 'https://huggingface.co/bartowski/google_gemma-3-27b-it-GGUF/resolve/main/mmproj-google_gemma-3-27b-it-f16.gguf',
    mmprojFilename: 'mmproj-google_gemma-3-27b-it-f16.gguf',
  },
];

// ─── 48 GB+ tier ──────────────────────────────────────────────────────────────

const TIER_48: CatalogModel[] = [
  {
    id: 'qwen25-72b',
    name: 'Qwen 2.5 72B',
    ggufFilename: 'Qwen2.5-72B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-72B-Instruct-GGUF/resolve/main/Qwen2.5-72B-Instruct-Q4_K_M.gguf',
    sizeMb: 44073,
    ramGb: 48,
    contextK: 32,
    role: 'General',
    bestFor: 'GPT-4 class quality, complex tasks, direct download (no login)',
    notGreatFor: 'Macs with less than 48GB RAM',
    tag: 'Best for 48GB+',
  },
  {
    id: 'llama33-70b',
    name: 'Llama 3.3 70B',
    ggufFilename: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-Q4_K_M.gguf',
    sizeMb: 42520,
    ramGb: 48,
    contextK: 128,
    role: 'General',
    bestFor: 'Creative writing, roleplay, nuanced conversation — beautiful prose, no thinking overhead',
    notGreatFor: 'Ultra-complex logic or debugging nasty code blocks',
    tag: 'Meta · All-rounder',
    primary: true,
  },
];

export const MODEL_CATALOG: CatalogModel[] = [
  ...TIER_8,
  ...TIER_16,
  ...TIER_32,
  ...TIER_48,
];

// ─── Unified recommendation (chip + RAM aware) ──────────────────────────────────
// Single source of truth for the onboarding model step. The bundled llama-server is
// arm64-only, so local inference requires Apple Silicon; Intel / low-RAM Macs are
// steered to a free cloud model instead.

export const MIN_LOCAL_GB = 8;

export type SetupRecommendation =
  | { kind: 'cloud'; reason: string }
  | { kind: 'local'; recommended: CatalogModel; tierLabel: string };

// ─── Memory model ───────────────────────────────────────────────────────────────
// Whether a quantized model actually RUNS on a Mac is a memory question, not a
// file-size one. On Apple Silicon the GPU can only wire ~75% of unified RAM for
// itself (the rest is the OS's), and weights + KV cache must fit inside that. The
// KV cache grows with context length, so we also pick the largest context that
// fits — and can halve it with 8-bit KV quantization. Conservative by design: it
// leaves headroom so a recommended model never aborts mid-load.
// Grounded in current llama.cpp / Apple-Silicon guidance (docs/onboarding-feedback.md).

const WIRED_FRACTION = 0.75;   // share of unified RAM Metal can wire for the GPU
const SAFETY = 0.9;            // leave ~10% of that budget free for OS/app spikes
const COMPUTE_BUFFER_GB = 1.0; // llama.cpp compute/graph buffers
const CONTEXT_LADDER = [32, 16, 8, 4]; // K tokens — try the largest first
const MIN_RECOMMEND_CONTEXT_K = 16;    // a recommended model must run at ≥16K

// KV cache is driven by layer count (the real factor). We estimate layers from
// model size and assume a 1024-wide KV dim — conservative for the small models
// that actually use fewer KV heads.
function estLayers(sizeMb: number): number {
  const gb = sizeMb / 1024;
  if (gb < 6) return 32;   // ~7-8B
  if (gb < 12) return 48;  // ~14B
  if (gb < 28) return 64;  // ~32B
  return 80;               // ~70B+
}
const KV_BYTES_PER_TOKEN_PER_LAYER = 1024 /*kv dim*/ * 2 /*K+V*/ * 2 /*f16 bytes*/;
function kvCacheGb(sizeMb: number, contextK: number, kv8bit: boolean): number {
  const tokens = contextK * 1024;
  const f16 = estLayers(sizeMb) * KV_BYTES_PER_TOKEN_PER_LAYER * tokens;
  return (kv8bit ? f16 / 2 : f16) / 1e9;
}
export function usableVramGb(ramGb: number): number {
  return ramGb * WIRED_FRACTION * SAFETY;
}

export interface MacFit {
  fits: boolean;
  contextK: number; // largest context that fits (0 = doesn't fit at all)
  kv8bit: boolean;  // whether 8-bit KV quantization is needed to fit
  label: string;    // short human description for THIS Mac
}

// The largest context (and whether 8-bit KV is needed) at which `model` fits on a
// Mac with `ramGb` of unified memory. Prefers full-precision KV at the longest
// context, and only drops to 8-bit / shorter context to make a model fit at all.
export function fitOnMac(model: { sizeMb: number }, ramGb: number): MacFit {
  const budget = usableVramGb(ramGb);
  const base = model.sizeMb / 1024 + COMPUTE_BUFFER_GB;
  for (const contextK of CONTEXT_LADDER) {
    for (const kv8bit of [false, true]) {
      if (base + kvCacheGb(model.sizeMb, contextK, kv8bit) <= budget) {
        const reduced = contextK < 32 ? ` (reduced)` : ``;
        const cache = kv8bit ? `, 8-bit cache` : ``;
        return { fits: true, contextK, kv8bit, label: `Runs at ${contextK}K context${reduced}${cache}` };
      }
    }
  }
  return { fits: false, contextK: 0, kv8bit: false, label: 'Too large for this Mac' };
}

export function recommendSetup(
  { totalMb, isAppleSilicon }: { totalMb: number; isAppleSilicon: boolean },
): SetupRecommendation {
  const gb = totalMb / 1024;

  if (!isAppleSilicon) {
    return {
      kind: 'cloud',
      reason: 'Local models run on Apple Silicon — on this Mac a cloud model is the best path.',
    };
  }
  if (gb < MIN_LOCAL_GB) {
    return {
      kind: 'cloud',
      reason: `Your Mac has ${Math.round(gb)}GB RAM — not quite enough for a capable local model. A cloud model is faster and needs no download.`,
    };
  }

  const ramGb = Math.floor(gb);
  // Largest model that runs at the engine's full 32K context with full-precision KV
  // (what the runtime does today) inside a conservative budget. Models that would
  // need reduced context or 8-bit KV to fit are NOT auto-recommended — they show up
  // in "see all" with an honest per-Mac label instead. (MIN_RECOMMEND_CONTEXT_K and
  // the 8-bit path stay wired into fitOnMac for that labelling + a future opt-in.)
  void MIN_RECOMMEND_CONTEXT_K;
  const runnable = MODEL_CATALOG
    .filter(m => !m.gated)
    .map(m => ({ m, fit: fitOnMac(m, ramGb) }))
    .filter(({ fit }) => fit.fits && fit.contextK >= 32 && !fit.kv8bit)
    .sort((a, b) => b.m.sizeMb - a.m.sizeMb);

  if (runnable.length === 0) {
    return {
      kind: 'cloud',
      reason: `Your ${ramGb}GB Mac can't comfortably run a local model at a useful context — a cloud model is the better fit.`,
    };
  }

  // Among the largest size class, prefer a General-purpose model deterministically.
  const top = runnable[0];
  const sameClass = runnable.filter(({ m }) => Math.abs(m.sizeMb - top.m.sizeMb) < 2000);
  const chosen =
    sameClass.find(({ m }) => m.role === 'General') ??
    sameClass.sort((a, b) => a.m.id.localeCompare(b.m.id))[0];

  return {
    kind: 'local',
    recommended: chosen.m,
    tierLabel: chosen.fit.label,
  };
}
