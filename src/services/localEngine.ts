// ─── Local engine: make the picker tell the truth ─────────────────────────────
//
// Every local model is registered at the SAME endpoint (127.0.0.1:8080/v1) because one
// llama-server serves one model at a time. Selecting a model was `set({ selectedModelId })` and
// nothing else — no call to `start_local_model` anywhere outside the Model Store, Settings and
// first-run setup. So the picker changed a label while the server kept serving whatever was last
// launched.
//
// Observed 2026-08-12, live: the UI read "Qwen3 32B" while /v1/models reported
// gemma-4-12b-it-Q4_K_M.gguf. Every reply attributed to Qwen came from Gemma. Worse than a wrong
// badge — capability flags are read from the SELECTED config, so Qwen's `canImage: false` hid
// image attachments while the server actually loaded had Gemma's mmproj projector and could see.
// And any two local models compared side by side were the same model answering twice.
//
// The invariant: DOCENT MUST NEVER CLAIM TO BE USING A MODEL IT IS NOT. This module enforces it
// by making selection actually swap the engine, and by re-checking at send time so no path can
// bypass it.
//
// The pure half (which file backs a config, does the running server match) is separated from the
// IO so it can be tested without Tauri or a server.

export interface LocalModelConfig {
  id?: string;
  name?: string;
  modelId?: string;
  provider?: string;
  isLocal?: boolean;
  endpoint?: string;
  contextLimit?: number;
  mmprojPath?: string;
  kv8bit?: boolean;
}

/** `Qwen_Qwen3-32B-Q4_K_M.gguf` -> `Qwen_Qwen3-32B-Q4_K_M`. Also accepts a full path. */
export const stemOf = (fileOrPath: string): string => {
  const base = String(fileOrPath ?? '').split('/').pop() ?? '';
  return base.replace(/\.gguf$/i, '');
};

/** Does this config drive the bundled llama-server? Cloud models must never be touched. */
export const isLocalModel = (model: LocalModelConfig | null | undefined): boolean =>
  !!model && (model.isLocal === true || model.provider === 'native');

/**
 * The .gguf filename backing this config, or null when it isn't installed.
 *
 * Configs store `modelId` (the filename stem) but NOT a path — so the file has to be resolved
 * against what is on disk every time. A missing file is a legitimate outcome (model deleted,
 * library moved between Macs) and must not throw: the caller keeps serving whatever is up rather
 * than tearing down a working engine for a model that cannot be launched.
 */
export function fileForModel(
  model: LocalModelConfig | null | undefined,
  files: { filename: string }[] | null | undefined,
): string | null {
  const wanted = stemOf(model?.modelId ?? '');
  if (!wanted) return null;
  const hit = (files ?? []).find(f => stemOf(f?.filename ?? '') === wanted);
  return hit?.filename ?? null;
}

/**
 * Is the running server already serving this model?
 *
 * `servingId` is what /v1/models reports, which for llama-server is the absolute .gguf path.
 * Compared on the stem so a moved models directory doesn't force a needless reload.
 */
export function servingMatches(
  model: LocalModelConfig | null | undefined,
  servingId: string | null | undefined,
): boolean {
  const wanted = stemOf(model?.modelId ?? '');
  const actual = stemOf(servingId ?? '');
  return !!wanted && !!actual && wanted === actual;
}

/** `http://127.0.0.1:8080/v1` -> 8080. Defaults to 8080 rather than throwing. */
export const portOf = (endpoint: string | undefined): number => {
  const m = /:(\d+)/.exec(String(endpoint ?? ''));
  const port = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(port) ? port : 8080;
};

export type SwitchResult =
  | { switched: false; reason: 'not-local' | 'already-serving' | 'file-missing' | 'unavailable' }
  | { switched: true; endpoint: string };

// One switch at a time per endpoint. Two sends firing at once (chat + a routine, say) would
// otherwise both decide a swap is needed and race two llama-servers onto the same port.
const inFlight = new Map<string, Promise<SwitchResult>>();

/**
 * Ensure the running engine is the model the user picked, launching it if not.
 *
 * Returns rather than throws: a failure to switch must never block sending. The caller reports
 * what happened; the worst case is the previous model answers, which is the status quo, not a
 * regression — but callers should surface it so the badge is not silently wrong again.
 */
export async function ensureLocalModelServing(
  model: LocalModelConfig | null | undefined,
  deps: {
    invoke: (cmd: string, args?: any) => Promise<any>;
    fetchServing: (endpoint: string) => Promise<string | null>;
  },
): Promise<SwitchResult> {
  if (!isLocalModel(model) || !model) return { switched: false, reason: 'not-local' };

  const endpoint = model.endpoint ?? 'http://127.0.0.1:8080/v1';
  const existing = inFlight.get(endpoint);
  if (existing) return existing;

  const run = (async (): Promise<SwitchResult> => {
    try {
      const serving = await deps.fetchServing(endpoint).catch(() => null);
      if (servingMatches(model, serving)) return { switched: false, reason: 'already-serving' };

      const [dir, files] = await Promise.all([
        deps.invoke('get_models_dir') as Promise<string>,
        deps.invoke('list_gguf_models') as Promise<{ filename: string }[]>,
      ]);
      const filename = fileForModel(model, files);
      if (!dir || !filename) return { switched: false, reason: 'file-missing' };

      const launched = await deps.invoke('start_local_model', {
        modelPath: `${dir}/${filename}`,
        port: portOf(endpoint),
        mmprojPath: model.mmprojPath ?? null,
        // The config's contextLimit IS the launch size — they were written together. Passing it
        // back keeps charBudget's assumption and the server's -c in agreement; drifting them
        // apart is what makes a prompt that "fits" get rejected by the engine.
        ctxTokens: model.contextLimit ?? null,
        kv8bit: model.kv8bit ?? false,
      });
      return { switched: true, endpoint: String(launched || endpoint) };
    } catch {
      return { switched: false, reason: 'unavailable' };
    } finally {
      inFlight.delete(endpoint);
    }
  })();

  inFlight.set(endpoint, run);
  return run;
}

/** Ask a running llama-server which model it has loaded. Null when it isn't up. */
export async function fetchServingModel(endpoint: string): Promise<string | null> {
  const base = String(endpoint ?? '').replace(/\/+$/, '');
  const res = await fetch(`${base}/models`);
  if (!res.ok) return null;
  const body = await res.json();
  const id = body?.data?.[0]?.id;
  return typeof id === 'string' ? id : null;
}
