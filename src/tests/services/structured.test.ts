import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { extractJson, toGeminiSchema, toWireSchema, generateStructuredResponse } from '../../services/structured';

const Plan = z.object({
  operations: z.array(z.object({ type: z.enum(['merge', 'prune']), description: z.string() })),
});

const okJson = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
});

const httpError = (status: number, message: string) => ({
  ok: false,
  status,
  json: async () => ({ error: { message } }),
});

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a bare array', () => {
    expect(extractJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('strips code fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose before and after the JSON', () => {
    expect(extractJson('Here is the plan:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  it('ignores reasoning inside <think> tags even when it contains braces', () => {
    expect(extractJson('<think>maybe {"a":9}? no.</think>{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for prose with no JSON', () => {
    expect(extractJson('I could not produce a plan.')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJson('{"a":1')).toBeNull();
  });
});

describe('toGeminiSchema', () => {
  it('keeps only Gemini-supported keys, recursively', () => {
    const wire = toWireSchema(Plan);
    const gemini = toGeminiSchema(wire) as Record<string, any>;
    expect(gemini.type).toBe('object');
    expect(gemini.additionalProperties).toBeUndefined();
    expect(gemini.$schema).toBeUndefined();
    const opItems = gemini.properties.operations.items;
    expect(opItems.properties.type.enum).toEqual(['merge', 'prune']);
    expect(opItems.additionalProperties).toBeUndefined();
    expect(opItems.required).toContain('description');
  });
});

describe('generateStructuredResponse (OpenAI-compatible)', () => {
  const modelConfig = { provider: 'lmstudio', endpoint: 'http://localhost:1234/v1', modelId: 'test-model', apiKey: '' };
  const valid = { operations: [{ type: 'merge', description: 'combine notes' }] };

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends response_format json_schema and returns the validated object', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ choices: [{ message: { content: JSON.stringify(valid) } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateStructuredResponse({ schema: Plan, schemaName: 'dream_plan', system: 'sys', user: 'usr', modelConfig });
    expect(out).toEqual(valid);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('dream_plan');
    expect(body.response_format.json_schema.schema.properties.operations).toBeDefined();
    expect(body.stream).toBe(false);
  });

  it('falls back without response_format when the server rejects it, silently', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpError(400, "Unknown parameter: 'response_format'"))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: '```json\n' + JSON.stringify(valid) + '\n```' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateStructuredResponse({ schema: Plan, schemaName: 'dream_plan', system: 'sys', user: 'usr', modelConfig });
    expect(out).toEqual(valid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retryBody.response_format).toBeUndefined();
  });

  it('returns null when the response fails schema validation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({
      choices: [{ message: { content: '{"operations":[{"type":"explode","description":"nope"}]}' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateStructuredResponse({ schema: Plan, schemaName: 'dream_plan', system: 'sys', user: 'usr', modelConfig });
    expect(out).toBeNull();
  });

  it('recovers from a transient server error via the plain-request fallback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpError(500, 'internal error'))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: JSON.stringify(valid) } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateStructuredResponse({ schema: Plan, schemaName: 'dream_plan', system: 'sys', user: 'usr', modelConfig });
    expect(out).toEqual(valid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null instead of throwing when the server is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateStructuredResponse({ schema: Plan, schemaName: 'dream_plan', system: 'sys', user: 'usr', modelConfig });
    expect(out).toBeNull();
  });
});

describe('generateStructuredResponse (Anthropic)', () => {
  const modelConfig = { provider: 'anthropic', modelId: 'claude-sonnet-5', apiKey: 'k' };
  const valid = { operations: [{ type: 'prune', description: 'stale file' }] };

  it('forces tool use and reads the tool_use input without re-parsing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ content: [{ type: 'tool_use', name: 'dream_plan', input: valid }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateStructuredResponse({ schema: Plan, schemaName: 'dream_plan', system: 'sys', user: 'usr', modelConfig });
    expect(out).toEqual(valid);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'dream_plan' });
    expect(body.tools[0].input_schema.properties.operations).toBeDefined();
  });
});

describe('generateStructuredResponse (Gemini)', () => {
  const modelConfig = { provider: 'google', modelId: 'gemini-2.5-flash', apiKey: 'k' };
  const valid = { operations: [] };

  it('sends responseSchema in generationConfig and parses the JSON text part', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateStructuredResponse({ schema: Plan, schemaName: 'dream_plan', system: 'sys', user: 'usr', modelConfig });
    expect(out).toEqual(valid);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.properties.operations).toBeDefined();
    expect(body.generationConfig.responseSchema.additionalProperties).toBeUndefined();
  });
});
