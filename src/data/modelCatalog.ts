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
  gated?: boolean;     // requires HuggingFace login — show link instead of download
  gatedUrl?: string;
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
    bestFor: 'Fluent writing, instruction-following, long context (128K)',
    notGreatFor: 'Complex code generation',
    tag: 'Google',
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
    bestFor: 'Writing, analysis, very long context (128K), instruction-following',
    notGreatFor: 'Heavy coding tasks',
    tag: 'Google',
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
  | { kind: 'local'; recommended: CatalogModel; coder?: CatalogModel; tierLabel: string };

export function recommendSetup(
  { totalMb, isAppleSilicon }: { totalMb: number; isAppleSilicon: boolean },
): SetupRecommendation {
  const gb = totalMb / 1024;

  if (!isAppleSilicon) {
    return {
      kind: 'cloud',
      reason: 'Local models run on Apple Silicon — on this Mac a free cloud model is the best path.',
    };
  }
  if (gb < MIN_LOCAL_GB) {
    return {
      kind: 'cloud',
      reason: `Your Mac has ${Math.round(gb)}GB RAM — not quite enough for a capable local model. A free cloud model is faster and needs no download.`,
    };
  }

  // Highest compatible tier wins, preferring a tagged "top pick" — mirrors ModelStorePanel.
  const ramGb = Math.floor(gb);
  const compatible = MODEL_CATALOG.filter(m => m.ramGb <= ramGb);
  const maxTier = compatible.reduce((mx, m) => Math.max(mx, m.ramGb), 0);
  const topTier = compatible.filter(m => m.ramGb === maxTier);
  const recommended =
    topTier.find(m => m.tag && m.role === 'General') ??
    topTier.find(m => m.tag) ??
    topTier.find(m => m.role === 'General') ??
    topTier[0];
  const coder = compatible
    .filter(m => m.role === 'Coder')
    .sort((a, b) => b.ramGb - a.ramGb)[0];

  return {
    kind: 'local',
    recommended,
    coder: coder && coder.id !== recommended.id ? coder : undefined,
    tierLabel: `${maxTier}GB tier`,
  };
}
