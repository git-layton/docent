// Vision "eyes" for the embedded browser panel.
//
// Text extraction (pageCapture.ts / browserAnnotator.ts) reads the DOM. Some pages defeat that: canvas
// apps, PDF/image viewers, map/graphics dashboards, and heavily-obfuscated SPAs render pixels, not
// readable text nodes. For those, the reliable read is to LOOK at what's painted. These helpers snapshot
// the browser panel's own WKWebView (Rust `browser_snapshot` / `browser_snapshot_text` in screenshot.rs)
// and turn it into either on-device-OCR text (works with ANY model, no cloud) or a PNG for a vision model.
//
// Everything here is best-effort and STRICTLY non-fatal — no snapshot, non-macOS, or an OCR error all
// resolve to empty/null. Callers treat the result as an optional enrichment, never a hard dependency.

import { invoke } from '@tauri-apps/api/core';

/** Label of the embedded browser webview (matches BrowserTabContent / browserAgent / lib.rs). */
const BROWSER_LABEL = 'browser-panel';

const hasTauri = () =>
  typeof window !== 'undefined' &&
  !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

/**
 * Read the RENDERED text of the browser panel via a webview snapshot + on-device Apple Vision OCR.
 *
 * This is the pixel-level read: it sees exactly what the user sees, so it works where DOM extraction
 * returns little (canvas/image/PDF-heavy pages). Resolves to '' on any failure (non-macOS, no snapshot,
 * OCR error) — never throws.
 */
export async function readBrowserVisualText(): Promise<string> {
  if (!hasTauri()) return '';
  try {
    const res = await invoke<{ text?: string }>('browser_snapshot_text', { label: BROWSER_LABEL });
    return (res?.text ?? '').trim();
  } catch (e) {
    console.warn('[browserVision] browser_snapshot_text failed:', e);
    return '';
  }
}

/**
 * Capture the browser panel as a PNG data URL, for handing to a vision model (the agent's LOOK action).
 * Resolves to null on any failure — never throws.
 */
export async function captureBrowserPng(): Promise<string | null> {
  if (!hasTauri()) return null;
  try {
    const b64 = await invoke<string>('browser_snapshot', { label: BROWSER_LABEL });
    if (!b64) return null;
    return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  } catch (e) {
    console.warn('[browserVision] browser_snapshot failed:', e);
    return null;
  }
}
