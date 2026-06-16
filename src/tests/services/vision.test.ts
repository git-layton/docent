import { describe, it, expect } from 'vitest';
import { modelSupportsVision, resolveVisionRoute, hasVisionProvider, supportsVision } from '../../services/llm';

describe('modelSupportsVision — native sight detection', () => {
  it('matches known vision model ids via the heuristic', () => {
    expect(modelSupportsVision({ modelId: 'gpt-4o' })).toBe(true);
    expect(modelSupportsVision({ modelId: 'claude-3-5-sonnet' })).toBe(true);
    expect(modelSupportsVision({ modelId: 'gemini-2.5-flash' })).toBe(true);
  });

  it('treats text-only ids as blind', () => {
    expect(modelSupportsVision({ modelId: 'qwen2.5-7b' })).toBe(false);
    expect(modelSupportsVision({ modelId: 'deepseek-r1-7b' })).toBe(false);
  });

  it('honors the stored canImage flag and local mmproj projector path', () => {
    // A local Gemma launched with --mmproj: its id does NOT match the heuristic, but it can see.
    expect(supportsVision('google_gemma-3-12b-it-Q4_K_M')).toBe(false);
    expect(modelSupportsVision({ modelId: 'google_gemma-3-12b-it-Q4_K_M', canImage: true })).toBe(true);
    expect(modelSupportsVision({ modelId: 'whatever', mmprojPath: '/models/mmproj.gguf' })).toBe(true);
  });

  it('is false for null/empty', () => {
    expect(modelSupportsVision(null)).toBe(false);
    expect(modelSupportsVision(undefined)).toBe(false);
    expect(modelSupportsVision({})).toBe(false);
  });
});

describe('resolveVisionRoute — which backend reads an image for a text-only model', () => {
  const withGoogle = { google: { apiKey: 'AIza-x' } };
  const withOpenAI = { openai: { apiKey: 'sk-x' } };

  it('returns null when explicitly disabled', () => {
    expect(resolveVisionRoute({ visionProvider: 'none' }, withGoogle, [])).toBeNull();
  });

  it('auto: picks an already-connected cloud key, defaulting the model', () => {
    const r = resolveVisionRoute({ visionProvider: 'auto' }, withGoogle, []);
    expect(r).toMatchObject({ provider: 'google', modelId: 'gemini-2.5-flash', apiKey: 'AIza-x' });
  });

  it('auto: returns null when no key exists (never invents credentials)', () => {
    expect(resolveVisionRoute({ visionProvider: 'auto' }, {}, [])).toBeNull();
  });

  it('auto: prefers Google over OpenAI when both are present', () => {
    const r = resolveVisionRoute({ visionProvider: 'auto' }, { ...withGoogle, ...withOpenAI }, []);
    expect(r?.provider).toBe('google');
  });

  it('auto: falls back to a chat model’s key when integrations are empty', () => {
    const models = [{ provider: 'openai', apiKey: 'sk-from-model' }];
    const r = resolveVisionRoute({ visionProvider: 'auto' }, {}, models);
    expect(r).toMatchObject({ provider: 'openai', apiKey: 'sk-from-model', modelId: 'gpt-4o-mini' });
  });

  it('explicit provider without a key resolves to null', () => {
    expect(resolveVisionRoute({ visionProvider: 'google' }, {}, [])).toBeNull();
  });

  it('explicit provider honors a custom visionModelId override', () => {
    const r = resolveVisionRoute({ visionProvider: 'openai', visionModelId: 'gpt-4o' }, withOpenAI, []);
    expect(r).toMatchObject({ provider: 'openai', modelId: 'gpt-4o' });
  });

  it('custom/local needs an endpoint; with one it routes there', () => {
    expect(resolveVisionRoute({ visionProvider: 'custom' }, {}, [])).toBeNull();
    const r = resolveVisionRoute({ visionProvider: 'custom', visionEndpoint: 'http://127.0.0.1:8080/v1' }, {}, []);
    expect(r).toMatchObject({ provider: 'custom', endpoint: 'http://127.0.0.1:8080/v1' });
  });
});

describe('hasVisionProvider — drives the composer image affordance', () => {
  it('true when a route resolves, false otherwise', () => {
    expect(hasVisionProvider({ visionProvider: 'auto' }, { google: { apiKey: 'k' } }, [])).toBe(true);
    expect(hasVisionProvider({ visionProvider: 'auto' }, {}, [])).toBe(false);
    expect(hasVisionProvider({ visionProvider: 'none' }, { google: { apiKey: 'k' } }, [])).toBe(false);
  });
});
