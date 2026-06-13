// Page-content capture for the embedded browser-panel webview.
//
// Agents need the readable text of pages the user has open. The webview can't hand a value back
// directly — `browser_eval` is fire-and-forget (WKWebView's `eval()` returns nothing) — so we inject
// a tiny grabber script that posts `document.documentElement.outerHTML` + `document.title` back over
// the SAME return channel the agentic browse loop uses: the `browser_agent_report` command, which
// Rust re-emits to the main window as the `browser-agent:observation` event. We match on a per-call
// `requestId` embedded in the script so a stale report from an earlier navigation can't fool us.
//
// Once we have the raw HTML, we hand it to the existing Rust `extract_page_text` command (which
// strips script/style/nav/etc. and caps at 50k chars) to get clean readable text.
//
// Everything here is best-effort and STRICTLY non-fatal: an eval failure, a timeout, blocked/empty
// HTML, or an extractor error all resolve to empty text. This must never throw and never break the
// browser tab.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Label of the embedded browser webview (matches BrowserTabContent / browserAgent / lib.rs). */
const BROWSER_LABEL = 'browser-panel';

/** Event the Rust `browser_agent_report` command re-emits to the main window. */
const OBSERVATION_EVENT = 'browser-agent:observation';

/** How long to wait for the page's HTML to come back before giving up (non-fatal). */
const CAPTURE_TIMEOUT_MS = 9000;

/** Shape of the report the injected grabber posts back via `browser_agent_report`. */
interface CaptureReport {
  requestId: string;
  html?: string;
  title?: string;
  error?: string;
}

const makeRequestId = () => `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Build the grabber script. It posts the page's outerHTML + title back through
 * `browser_agent_report` tagged with `requestId`. Defensive: it runs inside an untrusted page, so
 * everything is wrapped in try/catch and feature-checked, and it reports an error string rather than
 * throwing if anything goes wrong.
 */
function buildGrabberScript(requestId: string): string {
  const reqLiteral = JSON.stringify(requestId);
  return `(function(){
  var REQ = ${reqLiteral};
  var T = window.__TAURI_INTERNALS__;
  function report(p){ try { if (T) T.invoke('browser_agent_report', { payload: p }); } catch(_){} }
  try {
    if (!T) return;
    var html = (document.documentElement ? document.documentElement.outerHTML : '') || '';
    var title = document.title || '';
    report({ requestId: REQ, html: html, title: title });
  } catch(e){
    report({ requestId: REQ, html: '', title: '', error: String(e) });
  }
})();`;
}

/**
 * Capture the readable text of the page currently loaded in the browser-panel webview.
 *
 * Injects a grabber that returns the page HTML over the observation channel (matched by a per-call
 * `requestId`), then runs the Rust `extract_page_text` extractor on it. Always resolves to a string:
 * the empty string on any failure (eval error, timeout, blocked/empty HTML, or extractor error).
 * Never throws.
 *
 * @param url The URL of the page being captured (passed to the extractor for page-context metadata).
 */
export async function capturePageText(url: string): Promise<string> {
  const requestId = makeRequestId();

  let resolveReport!: (r: CaptureReport | null) => void;
  const pending = new Promise<CaptureReport | null>(r => { resolveReport = r; });
  let settled = false;
  const settle = (r: CaptureReport | null) => {
    if (settled) return;
    settled = true;
    resolveReport(r);
  };

  let unlisten: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    // Subscribe BEFORE injecting so we can't miss a fast report.
    unlisten = await listen<CaptureReport>(OBSERVATION_EVENT, ({ payload }) => {
      // Ignore foreign reports (the agentic browse loop's observations, or stale captures).
      if (payload && payload.requestId === requestId) settle(payload);
    });

    timer = setTimeout(() => settle(null), CAPTURE_TIMEOUT_MS);

    try {
      await invoke('browser_eval', { label: BROWSER_LABEL, script: buildGrabberScript(requestId) });
    } catch (e) {
      // Eval itself failed — give up immediately rather than waiting out the timeout.
      console.warn('[pageCapture] browser_eval failed:', e);
      settle(null);
    }

    const report = await pending;
    const html = report?.html ?? '';
    if (!html) return ''; // timeout, blocked, or empty page — non-fatal.

    const title = report?.title ?? '';
    try {
      const text = await invoke<string>('extract_page_text', { html, url, title });
      return text ?? '';
    } catch (e) {
      console.warn('[pageCapture] extract_page_text failed:', e);
      return '';
    }
  } catch (e) {
    // Belt-and-suspenders: anything unexpected (e.g. listen() rejecting) resolves to empty text.
    console.warn('[pageCapture] capturePageText failed:', e);
    return '';
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (unlisten) {
      try { unlisten(); } catch (_) { /* ignore */ }
    }
  }
}
