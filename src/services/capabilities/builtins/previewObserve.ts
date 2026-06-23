// Preview-observe — "Codey, can you see this?" (the verify loop). Lets Codey READ the running app at
// the live Preview URL so he can self-correct after a change. Folds the observation into his context
// exactly like browse/files do, via a [SYSTEM NOTE] toolData block. See docs/agentforge-code-design.md pt 10.
//
// v1 READ (model-agnostic, shipped): Codey curls the framed Preview URL through the already-shipped
// `run_command` (Developer-Mode-gated, cwd = the space workspace home, DENIED to remote pages) and
// pipes the served HTML through the existing Rust `extract_page_text` extractor for clean readable
// text. He sees: the HTTP status line, the server-rendered markup/JSON, and — because run_command
// captures stderr — any connection error. This is the highest-signal fix input (build/runtime errors,
// route reachability, SSR markup) with ZERO new Rust.
//
// HONEST LIMITATION: curl gets the SERVER-rendered response only — no client-rendered DOM and no
// browser console. For an SPA dev server (Vite/CRA) the served HTML is often a near-empty
// `<div id="root">` shell, so Codey sees route reachability + build errors but not the live rendered
// UI. The richer client-rendered DOM read is the DEFERRED native-webview path (docs pt 8).
//
// v1 LOOK (vision, LIVE on macOS): a screenshot → the vision sink (describeImage). The Rust
// `webview_screenshot` command (screenshot.rs) snapshots the MAIN WKWebView — which paints the
// cross-origin localhost preview iframe a JS canvas can't touch — and crops to the iframe rect. The
// PNG flows into describeImage (Gemma 3 / cloud route). lookAtPreview() gates on a vision provider; if
// there's none, or no screenshot (non-macOS, dev server not painted, capture error), it FALLS BACK to
// the READ with a clear note. So LOOK degrades gracefully to READ rather than failing.

import { invoke } from '@tauri-apps/api/core';
import { useSpaceStore } from '../../../store/useSpaceStore';
import { useUIStore } from '../../../store/useUIStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { spaceHome } from '../../fileAccess/spaces';
import { resolveVisionRoute, modelSupportsVision, describeImage } from '../../llm';
import type { Capability, CapabilityContext, CapabilityResult } from '../types';

const hasTauri = () =>
  typeof window !== 'undefined' && !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

/** Shape of the `run_command` result (lib.rs:1712). */
interface CommandResult { ok: boolean; code?: number | null; stdout?: string; stderr?: string; error?: string }

/** Resolve the URL Codey should observe — the one the human framed in the Preview panel. */
function resolvePreviewUrl(): string | null {
  const url = useUIStore.getState().codePreviewUrl?.trim();
  return url ? url : null;
}

/** Shell-quote a URL for safe interpolation into a `curl` command line. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * LOOK (vision) — captures the preview and routes it through the vision sink.
 *
 * Returns a description string when a vision provider exists AND a screenshot is obtainable, else null
 * (the caller then falls back to the READ). Gates on a configured/auto Vision Provider OR a chat model
 * that natively sees.
 */
async function lookAtPreview(ctx: CapabilityContext, _url: string): Promise<string | null> {
  const { appSettings, integrations, models } = useSettingsStore.getState();
  const route = resolveVisionRoute(appSettings, integrations, models);
  const chatModelSees = modelSupportsVision(ctx.model);
  if (!route && !chatModelSees) return null; // no vision path → caller falls back to READ.

  // Capture a PNG of the running app via the Rust webview_screenshot command (macOS). Null on any
  // failure → caller falls back to the READ.
  const pngBytes: string | null = await capturePreviewScreenshot(_url);
  if (!pngBytes) return null; // no image → caller falls back to READ.

  // Vision SINK is fully reused — no parallel path. describeImage returns OCR + caption + layout text.
  if (route) {
    const dataUrl = pngBytes.startsWith('data:') ? pngBytes : `data:image/png;base64,${pngBytes}`;
    return describeImage(dataUrl, 'image/png', route, ctx.signal);
  }
  // If only the chat model sees (no separate provider), the screenshot would ride along as a normal
  // image attachment on the turn — out of scope for this read-only capability. Fall back to READ.
  return null;
}

/**
 * Obtain a base64 PNG screenshot of the running preview via the Rust `webview_screenshot` command.
 *
 * The command snapshots the MAIN window's WKWebView — which paints the cross-origin localhost preview
 * iframe that a JS canvas can't read — and crops to the iframe's on-screen rect (CSS points, set by the
 * Preview panel when the human hits LOOK). An unmeasurable/zero rect now ERRORS (no full-window
 * fallback) and LOOK degrades to READ. macOS-only and DENIED to
 * the remote browser-panel webview (allow-app-local, never allow-browser-remote). Returns null on any
 * failure (non-macOS, no dev server painted, capture error) so the caller cleanly falls back to the READ.
 */
async function capturePreviewScreenshot(_url: string): Promise<string | null> {
  try {
    const rect = useUIStore.getState().codePreviewRect;
    const png = await invoke<string>('webview_screenshot', {
      x: rect?.x ?? 0,
      y: rect?.y ?? 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    });
    return png && png.length > 0 ? png : null;
  } catch (e) {
    console.warn('[previewObserve] webview_screenshot failed, falling back to READ:', e);
    return null;
  }
}

export const previewObserveCapability: Capability = {
  id: 'preview-observe',
  title: 'Observe preview',
  description: "Read the running app at the live Preview URL so Codey can see his changes and self-correct.",
  effect: 'read',
  // Surface-'*' like browse/files — availability is really gated by whether a Preview URL is set + Dev
  // Mode is on (handled inside execute with a useful message), not by an open tab kind.
  surfaces: '*',
  routes: ['preview'],
  async execute(ctx: CapabilityContext): Promise<CapabilityResult> {
    const url = resolvePreviewUrl();

    if (!hasTauri()) {
      return {
        toolData: '\n\n[SYSTEM NOTE: PREVIEW OBSERVATION UNAVAILABLE]\nThe running app lives on the desktop; preview observation only works in the desktop app.\n[END PREVIEW]',
        sources: [],
        status: { type: 'replace', content: '👁 Preview · desktop only' },
      };
    }
    if (!url) {
      return {
        toolData: '\n\n[SYSTEM NOTE: NO PREVIEW URL]\nNo Preview URL is set. Open the Preview panel in Code, enter the dev-server URL, and hit Go, then ask me to look again.\n[END PREVIEW]',
        sources: [],
        status: { type: 'replace', content: '👁 Preview · no URL set' },
      };
    }

    // run_command is Developer-Mode-gated — tell the user how to enable it rather than failing opaquely.
    const developerMode = useSettingsStore.getState().appSettings.developerMode ?? false;
    if (!developerMode) {
      useUIStore.getState().showToast('Turn on Developer Mode (Code → gear) so I can observe the preview.');
      return {
        toolData: `\n\n[SYSTEM NOTE: PREVIEW OBSERVATION BLOCKED]\nObserving the preview at ${url} needs Developer Mode (it runs a shell command, curl). It is off, so I could not read the running app. Ask the user to enable Developer Mode in Code's settings gear, then try again.\n[END PREVIEW]`,
        sources: [],
        status: { type: 'replace', content: '👁 Preview · enable Developer Mode' },
      };
    }

    // Best-effort LOOK first (vision) — falls back to READ when there's no provider or no screenshot.
    let visionText: string | null = null;
    try {
      ctx.setStatus('👁 Looking at the preview…');
      visionText = await lookAtPreview(ctx, url);
    } catch (e: any) {
      console.warn('[previewObserve] LOOK failed, falling back to READ:', e);
    }

    // READ — curl the framed URL (status + served HTML), then extract clean text. cwd = the active
    // space's workspace home so it runs in the project context (and matches the Terminal/dev server).
    ctx.setStatus('👁 Reading the running app…');
    const home = spaceHome(useSpaceStore.getState().activeSpaceId);
    let toolData = '';
    let summary = '👁 Observed preview';
    try {
      // `-i` includes response headers (status line + content-type); `-sS` is quiet but shows errors;
      // `--max-time 12` bounds a hung server; `-L` follows redirects to the real page.
      const cmd = `curl -sS -i -L --max-time 12 ${shellQuote(url)}`;
      const res = await invoke<CommandResult>('run_command', { command: cmd, cwd: home });

      if (!res || (!res.ok && !res.stdout)) {
        const why = res?.stderr?.trim() || res?.error || 'connection failed (is the dev server running?)';
        toolData = `\n\n[SYSTEM NOTE: PREVIEW OBSERVATION — COULD NOT REACH ${url}]\ncurl could not reach the preview: ${why}\nThis usually means the dev server isn't running. Ask the user to start it (e.g. in the Terminal panel) and confirm the URL, then I'll look again.\n[END PREVIEW]`;
        summary = '👁 Preview · server not reachable';
      } else {
        const raw = res.stdout ?? '';
        // Split the curl `-i` output into the HTTP headers and the body.
        const splitAt = raw.search(/\r?\n\r?\n/);
        const headers = splitAt >= 0 ? raw.slice(0, splitAt).trim() : '';
        const body = splitAt >= 0 ? raw.slice(splitAt).replace(/^\r?\n\r?\n/, '') : raw;
        const statusLine = headers.split(/\r?\n/)[0] ?? '';

        // Pipe the served HTML through the existing extractor for clean readable text (best-effort).
        let readable = '';
        try {
          readable = await invoke<string>('extract_page_text', { html: body, url, title: '' });
        } catch { /* non-fatal — fall back to raw body below */ }
        const bodyForModel = (readable && readable.trim().length > 0
          ? readable
          : body
        ).slice(0, 8000);

        const stderrNote = res.stderr?.trim() ? `\nServer/curl stderr:\n${res.stderr.trim().slice(0, 2000)}` : '';
        const visionBlock = visionText
          ? `\nVisual look (vision model):\n${visionText.slice(0, 3000)}\n`
          : '';
        toolData =
          `\n\n[SYSTEM NOTE: PREVIEW OBSERVATION — ${url}]\n` +
          `I fetched the running app at ${url}. This is the SERVER response (HTTP status + served markup); ` +
          `for a client-rendered SPA the served HTML may be a near-empty shell, in which case the highest-signal ` +
          `inputs are the HTTP status and any build/runtime errors below.\n` +
          `HTTP: ${statusLine || '(no status line)'}\n` +
          (headers ? `Response headers:\n${headers.slice(0, 1200)}\n` : '') +
          visionBlock +
          `Served content (extracted):\n${bodyForModel}` +
          stderrNote +
          `\n[END PREVIEW]`;
        const ok = /\b2\d\d\b/.test(statusLine);
        summary = visionText
          ? '👁 Observed preview (read + look)'
          : ok ? '👁 Observed preview' : '👁 Preview · non-2xx response';
      }
    } catch (e: any) {
      console.error('[previewObserve] READ failed:', e);
      toolData = `\n\n[SYSTEM NOTE: PREVIEW OBSERVATION FAILED]\nI couldn't observe the preview at ${url}: ${e?.message ?? e}\n[END PREVIEW]`;
      summary = '👁 Preview · error';
    }

    return { toolData, sources: [], status: { type: 'replace', content: summary } };
  },
};
