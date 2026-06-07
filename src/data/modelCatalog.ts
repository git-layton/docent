export interface CatalogModel {
  id: string;
  name: string;
  ggufFilename: string;
  downloadUrl: string;
  sizeMb: number;
  ramGb: number;
  contextK: number;
  role: 'General' | 'Coder';
  bestFor: string;
  notGreatFor: string;
  tag?: string;
  gated?: boolean;
  gatedUrl?: string;
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'qwen25-7b',
    name: 'Qwen 2.5 7B',
    ggufFilename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    sizeMb: 4810,
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
    sizeMb: 4810,
    ramGb: 8,
    contextK: 32,
    role: 'Coder',
    bestFor: 'Code generation, debugging, quick scripts',
    notGreatFor: 'Long natural-language conversations',
  },
  {
    id: 'qwen25-14b',
    name: 'Qwen 2.5 14B',
    ggufFilename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    sizeMb: 8990,
    ramGb: 16,
    contextK: 32,
    role: 'General',
    bestFor: 'Complex reasoning, long documents, nuanced responses',
    notGreatFor: 'Quick simple Q&A (slight overhead)',
    tag: 'Best for 16GB',
  },
  {
    id: 'qwen25coder-14b',
    name: 'Qwen 2.5 Coder 14B',
    ggufFilename: 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf',
    sizeMb: 8990,
    ramGb: 16,
    contextK: 32,
    role: 'Coder',
    bestFor: 'Complex code, architecture, full file generation',
    notGreatFor: 'Simple conversational tasks',
  },
  {
    id: 'qwen25-32b',
    name: 'Qwen 2.5 32B',
    ggufFilename: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-32B-Instruct-GGUF/resolve/main/Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    sizeMb: 19940,
    ramGb: 32,
    contextK: 32,
    role: 'General',
    bestFor: 'Near-GPT-4 quality, long context, deep reasoning',
    notGreatFor: 'Macs with less than 32GB RAM',
    tag: 'Best for 32GB+',
  },
  {
    id: 'qwen25coder-32b',
    name: 'Qwen 2.5 Coder 32B',
    ggufFilename: 'Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf',
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf',
    sizeMb: 19940,
    ramGb: 32,
    contextK: 32,
    role: 'Coder',
    bestFor: 'Production-quality code, complex refactors, full-stack',
    notGreatFor: 'Macs with less than 32GB RAM',
  },
];
