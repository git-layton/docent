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
    ggufFilename: '',
    downloadUrl: '',
    sizeMb: 8264,
    ramGb: 16,
    contextK: 128,
    role: 'General',
    bestFor: 'Fluent writing, instruction-following, long context (128K)',
    notGreatFor: 'Complex code generation',
    tag: 'Google',
    gated: true,
    gatedUrl: 'https://huggingface.co/google/gemma-3-12b-it',
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
    bestFor: 'Near-GPT-4 quality, long context, deep reasoning',
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
    bestFor: 'Production-quality code, complex refactors, full-stack',
    notGreatFor: 'Macs with less than 32GB RAM',
  },
  {
    id: 'gemma3-27b',
    name: 'Gemma 3 27B',
    ggufFilename: '',
    downloadUrl: '',
    sizeMb: 17653,
    ramGb: 32,
    contextK: 128,
    role: 'General',
    bestFor: 'Writing, analysis, very long context (128K), instruction-following',
    notGreatFor: 'Heavy coding tasks',
    tag: 'Google',
    gated: true,
    gatedUrl: 'https://huggingface.co/google/gemma-3-27b-it',
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
    ggufFilename: '',
    downloadUrl: '',
    sizeMb: 43541,
    ramGb: 48,
    contextK: 128,
    role: 'General',
    bestFor: 'Best open-source quality, 128K context, complex reasoning',
    notGreatFor: 'Macs with less than 48GB RAM',
    tag: 'Meta',
    gated: true,
    gatedUrl: 'https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct',
  },
];

export const MODEL_CATALOG: CatalogModel[] = [
  ...TIER_8,
  ...TIER_16,
  ...TIER_32,
  ...TIER_48,
];
