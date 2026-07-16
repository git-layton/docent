// Page-content capture for the embedded browser-panel webview.
//
// Agents need the readable text of pages the user has open. The webview can't hand a value back
// directly — `browser_eval` is fire-and-forget (WKWebView's `eval()` returns nothing) — so we inject
// a tiny grabber script that posts the page's readable text back over the SAME return channel the
// agentic browse loop uses: the `browser_agent_report` command, which Rust re-emits to the main
// window as the `browser-agent:observation` event. We match on a per-call `requestId` embedded in the
// script so a stale report from an earlier navigation can't fool us.
//
// WHY rendered innerText, not outerHTML: earlier this grabbed `document.documentElement.outerHTML`
// and ran it through the Rust `extract_page_text` scraper. That works for static article pages but is
// poor for JS apps (Gmail, webmail, dashboards): the raw source is full of hidden templates, offscreen
// menus, aria hints and keyboard-shortcut text, and the scraper concatenates every text node not under
// a noise tag — producing a large, out-of-order, low-signal blob. `innerText` returns what is actually
// RENDERED and VISIBLE, in visual order — exactly what the user sees — so it is the right signal for
// "what page is the user looking at". We also walk SAME-ORIGIN iframes (webmail renders message bodies
// and reading panes inside them), which a top-frame innerText read would otherwise miss. If innerText
// comes back empty (rare — some sites paint into shadow DOM or cross-origin frames), we fall back to a
// bounded outerHTML run through the Rust extractor so we still return something.
//
// Because JS apps render asynchronously, a single read right after navigation often catches a still-
// loading shell. So we RETRY with backoff until we get a substantial amount of text (or the attempt
// budget runs out), returning the best read we saw.
//
// Everything here is best-effort and STRICTLY non-fatal: an eval failure, a timeout, blocked/empty
// content, or an extractor error all resolve to empty text. This must never throw and never break the
// browser tab.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Label of the embedded browser webview (matches BrowserTabContent / browserAgent / lib.rs). */
const BROWSER_LABEL = 'browser-panel';

/** Event the Rust `browser_agent_report` command re-emits to the main window. */
const OBSERVATION_EVENT = 'browser-agent:observation';

/** How long to wait for one read to come back before giving up on that attempt (non-fatal). */
const READ_TIMEOUT_MS = 6000;

/** Cap the returned text so a single capture can't blow a small model's context. Matches the Rust cap. */
const MAX_TEXT_CHARS = 48_000;

/**
 * Below this many characters we assume the page (an SPA) hasn't finished rendering and retry. Gmail's
 * loading shell is well under this; a rendered inbox is far above it.
 */
const SUBSTANTIAL_TEXT_CHARS = 200;

/** Read attempts and the pause before each retry — total worst-case ≈ 6s of extra settling. */
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [0, 1200, 2000];

/** Shape of the report the injected grabber posts back via `browser_agent_report`. */
interface CaptureReport {
  requestId: string;
  /** Rendered, cleaned readable text (innerText of the top document + same-origin iframes). */
  text?: string;
  /** Bounded outerHTML — only sent when `text` came back empty, for the Rust-extractor fallback. */
  html?: string;
  title?: string;
  error?: string;
}

const makeRequestId = () => `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Build the grabber script. It collects the page's RENDERED text (innerText of the body plus any
 * same-origin iframe bodies), cleans whitespace, and posts it back through `browser_agent_report`
 * tagged with `requestId`. If innerText is empty it also returns a bounded outerHTML so the caller can
 * fall back to the Rust extractor. Defensive: it runs inside an untrusted page, so everything is
 * wrapped in try/catch and feature-checked, and it reports an error string rather than throwing.
 */
function buildReadableGrabber(requestId: string, maxChars: number): string {
  const reqLiteral = JSON.stringify(requestId);
  return `(function(){
  var REQ = ${reqLiteral};
  var MAX = ${maxChars};
  var T = window.__TAURI_INTERNALS__;
  function report(p){ try { if (T) T.invoke('browser_agent_report', { payload: p }); } catch(_){} }
  function clean(s){
    return (s || '')
      .replace(/[ \\t\\u00a0]+/g, ' ')
      .replace(/ *\\n */g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();
  }
  function bodyText(doc){
    try {
      var b = doc && doc.body;
      if (!b) return '';
      // innerText reflects rendered/visible text; textContent is the fallback for detached-ish bodies.
      return b.innerText || b.textContent || '';
    } catch(_) { return ''; }
  }
  try {
    if (!T) return;
    var parts = [bodyText(document)];
    // Same-origin iframes: webmail message bodies, reading panes, embedded readers. Cross-origin
    // frames throw on contentDocument access — swallow and skip them.
    try {
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length && i < 12; i++) {
        var d = null;
        try { d = frames[i].contentDocument; } catch(_) { d = null; }
        if (d) { var t = bodyText(d); if (t && t.trim().length > 40) parts.push(t); }
      }
    } catch(_){}
    var text = clean(parts.join('\\n\\n')).slice(0, MAX);
    if (text && text.length > 0) {
      report({ requestId: REQ, text: text, title: document.title || '' });
    } else {
      // No rendered text (shadow DOM / cross-origin frame paint). Hand back bounded source so the
      // caller can run the Rust extractor as a fallback.
      var html = '';
      try { html = (document.documentElement ? document.documentElement.outerHTML : '') || ''; } catch(_){}
      report({ requestId: REQ, text: '', html: html.slice(0, 2000000), title: document.title || '' });
    }
  } catch(e){
    report({ requestId: REQ, text: '', title: '', error: String(e) });
  }
})();`;
}

/**
 * Perform one read: inject the grabber, wait for its report (or time out), and turn it into readable
 * text. Falls back to the Rust `extract_page_text` extractor if the grabber returned bounded HTML
 * instead of rendered text. Always resolves; never throws.
 */
async function readOnce(url: string): Promise<string> {
  const requestId = makeRequestId();

  let resolveReport!: (r: CaptureReport | null) => void;
  const pending = new Promise<CaptureReport | null>(r => { resolveReport = r; });
  let settled = false;
  const settle = (r: CaptureReport | null) => { if (!settled) { settled = true; resolveReport(r); } };

  let unlisten: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    // Subscribe BEFORE injecting so we can't miss a fast report.
    unlisten = await listen<CaptureReport>(OBSERVATION_EVENT, ({ payload }) => {
      if (payload && payload.requestId === requestId) settle(payload);
    });

    timer = setTimeout(() => settle(null), READ_TIMEOUT_MS);

    try {
      await invoke('browser_eval', { label: BROWSER_LABEL, script: buildReadableGrabber(requestId, MAX_TEXT_CHARS) });
    } catch (e) {
      console.warn('[pageCapture] browser_eval failed:', e);
      settle(null);
    }

    const report = await pending;
    if (!report) return ''; // timeout — non-fatal.

    const text = (report.text ?? '').trim();
    if (text) return text.slice(0, MAX_TEXT_CHARS);

    // Fallback: grabber found no rendered text but handed back source — run the Rust extractor.
    const html = report.html ?? '';
    if (!html) return '';
    try {
      const extracted = await invoke<string>('extract_page_text', { html, url, title: report.title ?? '' });
      return (extracted ?? '').slice(0, MAX_TEXT_CHARS);
    } catch (e) {
      console.warn('[pageCapture] extract_page_text fallback failed:', e);
      return '';
    }
  } catch (e) {
    console.warn('[pageCapture] readOnce failed:', e);
    return '';
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (unlisten) { try { unlisten(); } catch (_) { /* ignore */ } }
  }
}

/**
 * Capture the readable text of the page currently loaded in the browser-panel webview.
 *
 * Reads rendered innerText (top document + same-origin iframes), retrying with backoff so a JS app
 * that is still rendering when we first look (Gmail, dashboards) gets a second chance rather than being
 * captured as an empty shell. Always resolves to a string — the best read we got, or the empty string
 * on any failure. Never throws.
 *
 * @param url The URL of the page being captured (used only for the extractor fallback's page metadata).
 */
export async function capturePageText(url: string): Promise<string> {
  let best = '';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (RETRY_BACKOFF_MS[attempt]) await sleep(RETRY_BACKOFF_MS[attempt]);
    const text = await readOnce(url);
    if (text.length > best.length) best = text;
    // Good enough — a rendered page well past the loading-shell threshold. Stop retrying.
    if (best.length >= SUBSTANTIAL_TEXT_CHARS) break;
  }
  return best;
}
