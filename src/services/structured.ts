// ─── Structured LLM calls ─────────────────────────────────────────────────────
// The single path for "the app needs typed data back from a model" (dream plans, MEMS
// evaluations, entity extraction, …). Enforcement happens at THREE layers, strongest first:
//   1. Generation-time grammar: the provider's native structured-output mechanism constrains
//      token selection itself where supported (llama-server compiles json_schema to a GBNF
//      grammar; OpenAI json_schema; Anthropic forced tool-use; Gemini responseSchema).
//   2. Deterministic extraction: extractJson() fishes the JSON out of whatever came back.
//   3. Zod validation: schema.safeParse is the last line of defense — nothing unvalidated
//      ever reaches a caller.
// All of it is automatic and silent: providers that reject the structured-output request get
// one retry without it (the callers' prompts still describe the JSON shape in prose), and any
// failure returns null so every call site keeps its existing fail-soft behavior. No settings.

import { z } from 'zod';
import { fetchWithRetry, stripThinkingTags } from './llm';

export interface StructuredModelConfig {
  provider?: string;
  endpoint?: string;
  modelId?: string;
  apiKey?: string;
}

export interface StructuredRequest<T> {
  /** Zod schema the result must satisfy. Also compiled to JSON Schema for the provider. */
  schema: z.ZodType<T>;
  /** Short snake_case name for the schema (tool/schema name on the wire). */
  schemaName: string;
  system: string;
  user: string;
  modelConfig: StructuredModelConfig;
  signal?: AbortSignal;
  /** Output cap. Anthropic requires one; defaults generously for long plans. */
  maxTokens?: number;
  /** Optional stricter JSON Schema for the wire (grammar guidance) when `schema` is a lenient
   * salvage schema (e.g. contains transforms, which can't compile to JSON Schema). */
  wireSchema?: Record<string, unknown>;
}

/** Pull the first JSON object or array out of model text: strips code fences and any
 * prose/reasoning around it. Returns null (never throws) when nothing parseable is found. */
export function extractJson(text: string): unknown {
  let cleaned = stripThinkingTags(String(text ?? '')).trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();

  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  let start: number; let close: string;
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) { start = objStart; close = '}'; }
  else if (arrStart !== -1) { start = arrStart; close = ']'; }
  else return null;

  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** JSON Schema for the wire. Standard draft output minus the $schema marker (noise to providers).
 * io:'input' so schemas containing transforms (null→undefined normalizers, salvage arrays) still
 * compile — the wire describes what the model should EMIT, which is the input side. */
export function toWireSchema<T>(schema: z.ZodType<T>): Record<string, unknown> {
  const wire = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete wire.$schema;
  return wire;
}

// Gemini's responseSchema accepts only an OpenAPI-flavored subset — unknown keys are rejected,
// so keep strictly to the fields it documents.
const GEMINI_KEYS = new Set(['type', 'format', 'description', 'enum', 'properties', 'required', 'items', 'nullable']);
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (!GEMINI_KEYS.has(key)) continue;
    out[key] = key === 'properties'
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toGeminiSchema(v)]))
      : key === 'items' ? toGeminiSchema(value) : value;
  }
  return out;
}

/** Array where each element is validated INDIVIDUALLY — a junk element is dropped, never fatal
 * to its siblings. Use as the validation side of a batch schema (the wire side stays strict). */
export const salvageArray = <S extends z.ZodType>(item: S) =>
  z.array(z.unknown()).catch([]).transform(arr =>
    arr.flatMap(el => {
      const r = item.safeParse(el);
      return r.success ? [r.data as z.infer<S>] : [];
    }));

const validate = <T>(schema: z.ZodType<T>, schemaName: string, raw: unknown): T | null => {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(`[structured] ${schemaName}: response failed validation —`, result.error.issues.slice(0, 3));
  return null;
};

/** Non-streaming structured call. Returns the validated object, or null on ANY failure —
 * callers keep their existing fail-soft paths. */
export async function generateStructuredResponse<T>(req: StructuredRequest<T>): Promise<T | null> {
  const { schema, schemaName, system, user, modelConfig, signal } = req;
  const { provider, endpoint, modelId, apiKey } = modelConfig;
  const maxTokens = req.maxTokens ?? 8192;
  const wireSchema = req.wireSchema ?? toWireSchema(schema);

  try {
    const isGoogle = provider === 'google' || endpoint?.includes('google');

    if (isGoogle) {
      const url = endpoint && endpoint !== ''
        ? endpoint
        : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(wireSchema) },
      };
      const res = await fetchWithRetry(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 2, signal);
      const text = (res.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text).filter(Boolean).join('\n');
      return validate(schema, schemaName, extractJson(text));
    }

    if (provider === 'anthropic') {
      const url = endpoint || 'https://api.anthropic.com/v1/messages';
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      // Forced tool use IS Anthropic's structured output: the input_schema constrains the
      // tool_use block the model must emit.
      const body = {
        model: modelId,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        tools: [{ name: schemaName, description: `Emit the ${schemaName} result.`, input_schema: wireSchema }],
        tool_choice: { type: 'tool', name: schemaName },
      };
      const res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, 2, signal);
      const toolUse = (res.content ?? []).find((b: any) => b.type === 'tool_use');
      if (toolUse?.input !== undefined) return validate(schema, schemaName, toolUse.input);
      const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      return validate(schema, schemaName, extractJson(text));
    }

    // OpenAI-compatible — including the bundled llama-server, LM Studio, and Ollama, which all
    // accept response_format json_schema (llama-server enforces it as a sampler-level grammar).
    const base = (endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    const withFormat = {
      model: modelId, messages, stream: false, max_tokens: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, schema: wireSchema } },
    };

    let res: any;
    try {
      // retries=0: a response_format rejection is deterministic, so retrying it just delays the
      // fallback below (which carries its own retries). Local-engine revive still applies.
      res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(withFormat) }, 0, signal);
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      // Whatever went wrong — an older server rejecting response_format, or a transient blip —
      // the recovery is the same: retry as a plain request (with fetchWithRetry's own backoff);
      // the caller's prompt still demands JSON in prose and safeParse still guards the result.
      console.warn(`[structured] ${schemaName}: structured request failed (${String(err?.message ?? err)}) — falling back to prose JSON.`);
      res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify({ model: modelId, messages, stream: false, max_tokens: maxTokens }) }, 2, signal);
    }

    const text = res.choices?.[0]?.message?.content ?? '';
    return validate(schema, schemaName, extractJson(text));
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    console.warn(`[structured] ${schemaName}: call failed —`, err?.message ?? err);
    return null;
  }
}
