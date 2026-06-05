import assert from 'node:assert/strict';
import {
  formatRamForRecommendation,
  getLocalModelRecommendation,
} from '../src/services/modelRecommendations.ts';
import {
  explainGenerationError,
  extractModelIdsFromListResponse,
  isPlaceholderLocalModelId,
  validateLocalGenerationConfig,
} from '../src/services/llm.ts';

const cases = [
  {
    name: 'unknown hardware gets conservative starter options',
    run: () => {
      const rec = getLocalModelRecommendation(null);
      assert.equal(rec.tierId, 'unknown');
      assert.equal(rec.options[0].provider, 'lmstudio');
      assert.equal(rec.options[0].contextLimit, 8192);
    },
  },
  {
    name: '8GB machines stay on small models',
    run: () => {
      const rec = getLocalModelRecommendation(8 * 1024);
      assert.equal(rec.tierId, 'light');
      assert.ok(rec.options.every(option => option.provider === 'lmstudio'));
      assert.ok(rec.options.every(option => option.contextLimit <= 8192));
      assert.ok(rec.options.some(option => option.modelId.includes('3b')));
    },
  },
  {
    name: '16GB machines recommend 7B or 8B models',
    run: () => {
      const rec = getLocalModelRecommendation(16 * 1024);
      assert.equal(rec.tierId, 'balanced');
      assert.ok(rec.options.some(option => /7b|8b/i.test(option.modelId)));
    },
  },
  {
    name: '24GB machines recommend 14B as the privacy-first upgrade',
    run: () => {
      const rec = getLocalModelRecommendation(24 * 1024);
      assert.equal(rec.tierId, 'strong');
      assert.ok(rec.options.some(option => /14b/i.test(option.modelId)));
      assert.ok(rec.strategy.toLowerCase().includes('privacy'));
    },
  },
  {
    name: '64GB machines expose workstation-class options',
    run: () => {
      const rec = getLocalModelRecommendation(64 * 1024);
      assert.equal(rec.tierId, 'workstation');
      assert.ok(rec.options.some(option => /32b/i.test(option.modelId)));
    },
  },
  {
    name: 'RAM label is human readable',
    run: () => {
      assert.equal(formatRamForRecommendation(24576), '24GB RAM');
      assert.equal(formatRamForRecommendation(0), 'hardware not detected yet');
    },
  },
  {
    name: 'LM Studio placeholder model ids cannot be saved as runnable configs',
    run: () => {
      assert.equal(isPlaceholderLocalModelId('local-7b-instruct'), true);
      assert.match(
        validateLocalGenerationConfig({
          provider: 'lmstudio',
          endpoint: 'http://127.0.0.1:1234/v1',
          modelId: 'local-7b-instruct',
        }) ?? '',
        /exact loaded model ID/i
      );
    },
  },
  {
    name: 'LM Studio real model ids pass local generation config validation',
    run: () => {
      assert.equal(
        validateLocalGenerationConfig({
          provider: 'lmstudio',
          endpoint: 'http://127.0.0.1:1234/v1',
          modelId: 'qwen2.5-7b-instruct-1m',
        }),
        null
      );
    },
  },
  {
    name: 'old local providers are rejected with LM Studio guidance',
    run: () => {
      assert.match(
        validateLocalGenerationConfig({
          provider: 'ollama',
          endpoint: 'http://127.0.0.1:11434/v1',
          modelId: 'llama3.1:8b',
        }) ?? '',
        /LM Studio/i
      );
    },
  },
  {
    name: 'LM Studio network failures get actionable setup guidance',
    run: () => {
      const message = explainGenerationError(new Error('Load failed'), { provider: 'lmstudio' });
      assert.match(message, /not reachable/i);
      assert.match(message, /start the Local Server/i);
    },
  },
  {
    name: 'LM Studio model list responses expose exact selectable ids',
    run: () => {
      assert.deepEqual(
        extractModelIdsFromListResponse({
          data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'llama-3.1-8b' }],
        }),
        ['qwen2.5-7b-instruct', 'llama-3.1-8b']
      );
    },
  },
];

let failures = 0;
for (const test of cases) {
  try {
    test.run();
    console.log(`ok - ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${test.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  console.error(`${failures} model recommendation test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`${cases.length} model recommendation tests passed.`);
