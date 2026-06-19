// ─────────────────────────────────────────────────────────────────────────────
// Tiny scoped logger.
//
// Funnels app diagnostics to two places:
//   1. the browser console (always), prefixed with `[scope]`, and
//   2. the in-app debug console (the UI store's `logs` array), best-effort.
//
// Why the lazy store access? `useUIStore` imports `../services/database`, which
// pulls in a chunk of app wiring. If this leaf logger imported the store at
// module-eval time we'd risk an import cycle (store → service → … → logger →
// store) and a half-initialized module. So we resolve the store sink lazily and
// defensively: a static `import()` that's awaited off the hot path, and a
// synchronous best-effort push when the module is already resident. Logging
// never throws and never blocks the caller — a logger that can crash the thing
// it's logging is worse than no logger.
//
// The optional `sink` parameter lets callers (and tests) inject a destination
// without touching global state.
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';

/** A destination for a single formatted log line. */
export type LogSink = (level: LogLevel, msg: string) => void;

// Cached reference to the store's `addLog` once resolved, so we don't re-import
// on every call. `undefined` = not yet attempted, `null` = unavailable.
let storeSink: LogSink | null | undefined;

/**
 * Resolve the in-app log store's `addLog` without creating a static import
 * cycle. Kicks off a one-time dynamic import; until it resolves, store logging
 * is simply skipped (console still fires). Fully best-effort.
 */
function resolveStoreSink(): LogSink | null {
  if (storeSink !== undefined) return storeSink;
  // Mark as "attempted, not yet available" so we only import once.
  storeSink = null;
  void import('../store/useUIStore')
    .then((mod) => {
      storeSink = (level, msg) => {
        try {
          mod.useUIStore.getState().addLog(level, msg);
        } catch {
          /* store not ready / disposed — ignore */
        }
      };
    })
    .catch(() => {
      /* store unavailable (e.g. non-app context) — console-only */
    });
  return storeSink;
}

/** Format an arbitrary thrown value into a single readable string. */
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.stack || `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function emit(level: LogLevel, scope: string, msg: string, sink?: LogSink): void {
  const line = `[${scope}] ${msg}`;

  // 1. Console — always, on the matching method.
  try {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  } catch {
    /* console missing — ignore */
  }

  // 2. Sink — explicit one if given, else the lazily-resolved store.
  const dest = sink ?? resolveStoreSink();
  if (dest) {
    try {
      dest(level, line);
    } catch {
      /* a logging sink must never crash the caller */
    }
  }
}

/**
 * Log a handled error. `extra` is appended as a compact key/value tail so call
 * sites can attach context (ids, paths) without string-building.
 */
export function logError(
  scope: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  emit('error', scope, stringifyError(err) + formatExtra(extra));
}

/** Log a warning. `msg` may be a string or any thrown/value to stringify. */
export function logWarn(
  scope: string,
  msg: unknown,
  extra?: Record<string, unknown>,
): void {
  emit('warn', scope, toMessage(msg) + formatExtra(extra));
}

/** Log an informational line. */
export function logInfo(
  scope: string,
  msg: unknown,
  extra?: Record<string, unknown>,
): void {
  emit('info', scope, toMessage(msg) + formatExtra(extra));
}

function toMessage(msg: unknown): string {
  return typeof msg === 'string' ? msg : stringifyError(msg);
}

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra) return '';
  const keys = Object.keys(extra);
  if (keys.length === 0) return '';
  const pairs = keys.map((k) => {
    const v = extra[k];
    const rendered =
      typeof v === 'string' ? v : (() => {
        try {
          return JSON.stringify(v);
        } catch {
          return String(v);
        }
      })();
    return `${k}=${rendered}`;
  });
  return ` (${pairs.join(', ')})`;
}
