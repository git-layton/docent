export type RecommendedProvider = 'lmstudio';

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

export function getLocalModelRecommendation(totalMb?: number | null): LocalModelRecommendation {
  const ramLabel = formatRamForRecommendation(totalMb);
  const gb = totalMb ? totalMb / 1024 : 0;

  if (!totalMb || totalMb <= 0) {
    return {
      tierId: 'unknown',
      ramLabel,
      headline: 'Pick a reliable starter path',
      strategy: 'Use LM Studio for private local chat, or connect a cloud model for the strongest reasoning.',
      caveat: 'Hardware detection is only available in the desktop app, so this is a conservative LM Studio default.',
      options: [
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
        lmStudio('local-3b-instruct', 'LM Studio 3B Instruct', 8192, 'Best first local model for low-memory machines.'),
        lmStudio('local-4b-instruct', 'LM Studio 4B Instruct', 8192, 'Good small reasoning model for private drafts and short tasks.'),
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
        lmStudio('local-8b-instruct', 'LM Studio 8B Instruct', 8192, 'Strong default for local chat on 16GB-class machines.'),
        lmStudio('local-7b-instruct', 'LM Studio 7B Instruct', 8192, 'Good local reasoning and structured output without huge RAM demands.'),
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
        lmStudio('local-14b-instruct', 'LM Studio 14B Instruct', 16384, 'Best privacy-first upgrade for 24GB-class machines.'),
        lmStudio('local-8b-instruct', 'LM Studio 8B Fast', 16384, 'Faster fallback when responsiveness matters more than depth.'),
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
      lmStudio('local-32b-instruct', 'LM Studio 32B Instruct', 32768, 'Strong local reasoning for high-memory machines.'),
      lmStudio('local-14b-instruct', 'LM Studio 14B Reliable', 32768, 'Fast fallback when responsiveness matters more than depth.'),
    ],
  };
}
