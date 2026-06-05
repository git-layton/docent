export type RecommendedProvider = 'ollama' | 'lmstudio' | 'native';

export type RecommendedLocalModel = {
  provider: RecommendedProvider;
  label: string;
  name: string;
  modelId: string;
  endpoint: string;
  contextLimit: number;
  fit: string;
  setupHint: string;
};

export type LocalModelRecommendation = {
  tierId: 'unknown' | 'light' | 'balanced' | 'strong' | 'workstation';
  ramLabel: string;
  headline: string;
  strategy: string;
  caveat: string;
  options: RecommendedLocalModel[];
};

export const formatRamForRecommendation = (totalMb?: number | null) => {
  if (!totalMb || totalMb <= 0) return 'hardware not detected yet';
  const gb = totalMb / 1024;
  return gb >= 10 ? `${Math.round(gb)}GB RAM` : `${gb.toFixed(1)}GB RAM`;
};

const ollama = (modelId: string, name: string, contextLimit: number, fit: string): RecommendedLocalModel => ({
  provider: 'ollama',
  label: 'Use Ollama',
  name,
  modelId,
  endpoint: 'http://127.0.0.1:11434/v1',
  contextLimit,
  fit,
  setupHint: `ollama pull ${modelId}`,
});

const lmStudio = (modelId: string, name: string, contextLimit: number, fit: string): RecommendedLocalModel => ({
  provider: 'lmstudio',
  label: 'Use LM Studio',
  name,
  modelId,
  endpoint: 'http://127.0.0.1:1234/v1',
  contextLimit,
  fit,
  setupHint: 'Load a matching instruct GGUF model in LM Studio, then start the local server.',
});

const nativeManual = (contextLimit: number, fit: string): RecommendedLocalModel => ({
  provider: 'native',
  label: 'Use Local Engine',
  name: 'Agent Forge Local Engine',
  modelId: 'local-gguf',
  endpoint: 'http://127.0.0.1:8080/v1',
  contextLimit,
  fit,
  setupHint: 'Advanced: run the bundled llama-server with a compatible GGUF model.',
});

export function getLocalModelRecommendation(totalMb?: number | null): LocalModelRecommendation {
  const ramLabel = formatRamForRecommendation(totalMb);
  const gb = totalMb ? totalMb / 1024 : 0;

  if (!totalMb || totalMb <= 0) {
    return {
      tierId: 'unknown',
      ramLabel,
      headline: 'Pick a reliable starter path',
      strategy: 'Use Ollama or LM Studio for private local chat, or connect a cloud model for the strongest reasoning.',
      caveat: 'Hardware detection is only available in the desktop app, so these are conservative defaults.',
      options: [
        ollama('llama3.2:3b', 'Private Starter Model', 8192, 'Good for quick local notes, summaries, and lightweight planning.'),
        lmStudio('local-7b-instruct', 'LM Studio 7B Instruct', 8192, 'Good when you already have a 7B instruct GGUF loaded.'),
      ],
    };
  }

  if (gb < 12) {
    return {
      tierId: 'light',
      ramLabel,
      headline: 'Use local as a private helper, cloud for hard reasoning',
      strategy: 'Small local models should handle capture cleanup, summaries, and simple memory work. Use a cloud model when reliability matters.',
      caveat: 'Avoid 7B+ models unless the machine has plenty of free memory.',
      options: [
        ollama('llama3.2:3b', 'Ollama Llama 3.2 3B', 8192, 'Best first local model for low-memory machines.'),
        ollama('qwen2.5:3b', 'Ollama Qwen 2.5 3B', 8192, 'Good small reasoning model for private drafts and short tasks.'),
      ],
    };
  }

  if (gb < 24) {
    return {
      tierId: 'balanced',
      ramLabel,
      headline: 'A 7B or 8B local model is the sweet spot',
      strategy: 'Use local models for private family/work memory and routine assistance. Keep a cloud model available for complex planning.',
      caveat: 'Large context windows and multiple apps can still push memory pressure up.',
      options: [
        ollama('llama3.1:8b', 'Ollama Llama 3.1 8B', 8192, 'Strong default for local chat on 16GB-class machines.'),
        ollama('qwen2.5:7b', 'Ollama Qwen 2.5 7B', 8192, 'Good local reasoning and structured output without huge RAM demands.'),
        lmStudio('local-7b-instruct', 'LM Studio 7B Instruct', 8192, 'Good when you prefer managing quantized GGUF models yourself.'),
      ],
    };
  }

  if (gb < 48) {
    return {
      tierId: 'strong',
      ramLabel,
      headline: 'A 14B local model is realistic here',
      strategy: 'Use a 14B local model for privacy-focused daily assistance, memory work, and knowledge-base answers. Use cloud for the smartest critical reasoning.',
      caveat: '32B models may run, but they can be slow or unstable depending on free memory and quantization.',
      options: [
        ollama('qwen2.5:14b', 'Ollama Qwen 2.5 14B', 16384, 'Best privacy-first upgrade for 24GB-class machines.'),
        ollama('llama3.1:8b', 'Ollama Llama 3.1 8B Fast', 16384, 'Faster fallback when responsiveness matters more than depth.'),
        lmStudio('local-14b-instruct', 'LM Studio 14B Instruct', 16384, 'Good for a Q4/Q5 14B GGUF if you want more control.'),
      ],
    };
  }

  return {
    tierId: 'workstation',
    ramLabel,
    headline: 'You can run serious local models',
    strategy: 'Use 32B-class local models for strong private reasoning, with cloud models reserved for the most demanding tasks.',
    caveat: '70B-class models may be possible on large unified-memory Macs, but expect slower responses and careful memory management.',
    options: [
      ollama('qwen2.5:32b', 'Ollama Qwen 2.5 32B', 32768, 'Strong local reasoning for high-memory machines.'),
      ollama('llama3.3:70b', 'Ollama Llama 3.3 70B', 32768, 'Experimental high-depth local option for very large memory systems.'),
      nativeManual(32768, 'Advanced path for running a local GGUF through the bundled Agent Forge engine.'),
    ],
  };
}
