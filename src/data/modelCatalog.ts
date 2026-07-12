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
    id: 'qwen3-8b',
    name: 'Qwen3 8B',
    ggufFilename: 'Qwen_Qwen3-8B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF/resolve/main/Qwen_Qwen3-8B-Q4_K_M.gguf',
    sizeMb: 5120,
    ramGb: 8,
    contextK: 32,
    role: 'General',
    bestFor: 'A great all-round assistant on a smaller Mac — chat, writing, light coding, with current-gen reasoning',
    notGreatFor: 'Deep multi-file coding or the hardest reasoning',
    tag: 'Current-gen',
    primary: true,
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen3 4B',
    ggufFilename: 'Qwen_Qwen3-4B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf',
    sizeMb: 2560,
    ramGb: 8,
    contextK: 32,
    role: 'General',
    bestFor: 'Fast and capable on any Apple Silicon Mac — punches well above its size',
    notGreatFor: 'Heavy reasoning or large codebases',
    tag: 'Fast · Low-RAM',
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
    bestFor: 'The lightest local model that reads images, plus fluent writing',
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
    id: 'qwen3-14b',
    name: 'Qwen3 14B',
    ggufFilename: 'Qwen_Qwen3-14B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3-14B-GGUF/resolve/main/Qwen_Qwen3-14B-Q4_K_M.gguf',
    sizeMb: 9216,
    ramGb: 16,
    contextK: 32,
    role: 'General',
    bestFor: 'Noticeably sharper reasoning and writing than the 8B — a great everyday model with current-gen quality',
    notGreatFor: 'Slower on lighter Macs; the 30B MoE is smarter still if you have the memory',
    tag: 'Current-gen',
  },
  {
    // The 16GB-tier headline pick: Gemma 4 12B is the first mid-size model with NATIVE vision
    // (+ audio, once we grow audio-attachment plumbing) that fits a 16GB Mac with room to spare —
    // and this app's whole identity is multimodal perception. Requires the bundled llama.cpp
    // ≥ Gemma-4 support (ours: b9821, 2026-07). Supersedes the old Gemma 3 12B entry.
    id: 'gemma4-12b',
    name: 'Gemma 4 12B',
    ggufFilename: 'gemma-4-12b-it-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf',
    sizeMb: 7122,
    ramGb: 16,
    contextK: 128,
    role: 'General',
    bestFor: 'The best all-rounder on a 16GB Mac — current-gen chat and writing, and it natively SEES images (screenshots, charts, photos)',
    notGreatFor: 'The heaviest reasoning and coding — the 30B-class models still win if you have 32GB',
    tag: 'Google · Vision · New',
    vision: true,
    // unsloth ships a generic 'mmproj-F16.gguf' name — we save it under a unique one so
    // projector files from different models can't collide in the models dir.
    mmprojUrl: 'https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/mmproj-F16.gguf',
    mmprojFilename: 'mmproj-gemma-4-12b-it-F16.gguf',
    primary: true,
  },
];

// ─── 32 GB tier ───────────────────────────────────────────────────────────────

const TIER_32: CatalogModel[] = [
  {
    id: 'qwen3-30b-a3b',
    name: 'Qwen3 30B-A3B',
    ggufFilename: 'Qwen_Qwen3-30B-A3B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3-30B-A3B-GGUF/resolve/main/Qwen_Qwen3-30B-A3B-Q4_K_M.gguf',
    sizeMb: 19046,
    ramGb: 32,
    contextK: 32,
    role: 'General',
    bestFor: 'The best everyday local assistant — near-32B smarts but far faster (mixture-of-experts: only ~3B active per token)',
    notGreatFor: 'The very deepest reasoning, where the dense 32B edges ahead',
    tag: 'Fast · Smart',
    primary: true,
  },
  {
    id: 'qwen3-32b',
    name: 'Qwen3 32B',
    ggufFilename: 'Qwen_Qwen3-32B-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3-32B-GGUF/resolve/main/Qwen_Qwen3-32B-Q4_K_M.gguf',
    sizeMb: 20275,
    ramGb: 32,
    contextK: 32,
    role: 'Reasoning',
    bestFor: 'The smartest model that runs fully on your Mac — deepest reasoning and top quality, dense',
    notGreatFor: 'Slower than the 30B MoE for everyday back-and-forth',
    tag: 'Most capable',
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
    bestFor: 'Strong writing and analysis with image understanding and long context',
    notGreatFor: 'Heavy coding tasks',
    tag: 'Google · Vision',
    vision: true,
    mmprojUrl: 'https://huggingface.co/bartowski/google_gemma-3-27b-it-GGUF/resolve/main/mmproj-google_gemma-3-27b-it-f16.gguf',
    mmprojFilename: 'mmproj-google_gemma-3-27b-it-f16.gguf',
  },
  {
    id: 'mistral-small-32',
    name: 'Mistral Small 3.2 24B',
    ggufFilename: 'mistralai_Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF/resolve/main/mistralai_Mistral-Small-3.2-24B-Instruct-2506-Q4_K_M.gguf',
    sizeMb: 14643,
    ramGb: 24,
    contextK: 128,
    role: 'General',
    bestFor: 'Big-model quality at a smaller, faster footprint — well-rounded and quick to respond',
    notGreatFor: 'The absolute deepest reasoning of the 30B+ models',
    tag: 'Mistral',
  },
  {
    id: 'devstral-small',
    name: 'Devstral Small',
    ggufFilename: 'mistralai_Devstral-Small-2507-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/mistralai_Devstral-Small-2507-GGUF/resolve/main/mistralai_Devstral-Small-2507-Q4_K_M.gguf',
    sizeMb: 14643,
    ramGb: 24,
    contextK: 128,
    role: 'Coder',
    bestFor: 'The best small agentic coder — multi-file edits, debugging, and tool use',
    notGreatFor: 'Open-ended creative writing or casual chat',
    tag: 'Coder',
  },
];

// ─── 48 GB+ tier ──────────────────────────────────────────────────────────────

const TIER_48: CatalogModel[] = [
  {
    id: 'llama33-70b',
    name: 'Llama 3.3 70B',
    ggufFilename: 'Llama-3.3-70B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.3-70B-Instruct-GGUF/resolve/main/Llama-3.3-70B-Instruct-Q4_K_M.gguf',
    sizeMb: 42520,
    ramGb: 64,
    contextK: 128,
    role: 'General',
    bestFor: 'Maximum local quality and nuanced prose — for Macs with the memory to run it (~96GB+ at full context)',
    notGreatFor: 'Macs under ~96GB, where it only fits at a reduced context',
    tag: 'Max quality',
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
    sameClass.find(({ m }) => m.primary) ??
    sameClass.find(({ m }) => m.role === 'General') ??
    sameClass.sort((a, b) => a.m.id.localeCompare(b.m.id))[0];

  return {
    kind: 'local',
    recommended: chosen.m,
    tierLabel: chosen.fit.label,
  };
}
