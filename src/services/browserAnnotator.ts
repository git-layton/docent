// Annotator + action scripts for the agentic browse loop.
//
// These produce JavaScript *strings* that get injected into the embedded browser-panel webview via
// the `browser_eval` Tauri command. `browser_eval` is fire-and-forget (it can't return a value), so
// the annotator reports what it sees back through the `browser_agent_report` command — see
// `browserAgent.ts` for the orchestration and `lib.rs` for the Rust return channel.
//
// Everything here runs inside an untrusted page, so the scripts are defensive (try/catch, feature
// checks) and the orchestrator treats anything that comes back strictly as data, never instructions.

/** Event the Rust `browser_agent_report` command re-emits to the main window. */
export const OBSERVATION_EVENT = 'browser-agent:observation';

/** One interactive element the agent may act on, as surfaced by the annotator. */
export interface AgentElement {
  /** Stable index for this observation; also written to the DOM as `data-agf-idx`. */
  i: number;
  /** Lowercased tag name (`a`, `button`, `input`, …). */
  tag: string;
  /** Lowercased `type` attribute, where present. */
  type: string;
  /** Accessible-ish label (aria-label/title/alt, else value/placeholder/text), truncated. */
  label: string;
  /** True for free-text inputs/textareas the agent may type into. */
  text: boolean;
  /** True for elements that submit a form — gated behind user confirmation. */
  submit: boolean;
  /** `href` for links, for source attribution. */
  href: string;
}

/** A single observation of the page, reported back after navigation or an action. */
export interface Observation {
  requestId: string;
  url: string;
  title: string;
  text: string;
  elements: AgentElement[];
  error?: string;
}

// Cap how much we pull off any one page so a single observation can't blow the model's context.
const MAX_ELEMENTS = 120;
const MAX_TEXT_CHARS = 6000;

/**
 * Script that extracts visible page text + enumerates interactive elements, tags each with a
 * `data-agf-idx` index (so later click/type actions can find it), and reports back via
 * `browser_agent_report`. `requestId` lets the orchestrator discard stale observations.
 */
export function buildAnnotatorScript(requestId: string): string {
  // requestId is orchestrator-generated and alphanumeric, but stringify anyway to be safe.
  const reqLiteral = JSON.stringify(requestId);
  return `(function(){
  var REQ = ${reqLiteral};
  var T = window.__TAURI_INTERNALS__;
  function report(p){ try { if (T) T.invoke('browser_agent_report', { payload: p }); } catch(_){} }
  try {
    if (!T) return;
    var old = document.querySelectorAll('[data-agf-idx]');
    for (var k=0;k<old.length;k++) old[k].removeAttribute('data-agf-idx');
    function visible(el){
      var r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      var s = window.getComputedStyle(el);
      if (!s || s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) return false;
      return true;
    }
    function label(el){
      var t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '').trim();
      if (!t) t = (el.value || el.placeholder || el.innerText || el.textContent || '').trim();
      return t.replace(/\\s+/g,' ').slice(0,120);
    }
    var sel = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [onclick]';
    var nodes = document.querySelectorAll(sel);
    var elements = [];
    var idx = 0;
    for (var i=0;i<nodes.length && idx<${MAX_ELEMENTS};i++){
      var el = nodes[i];
      if (!visible(el)) continue;
      var tag = el.tagName.toLowerCase();
      var type = (el.getAttribute('type')||'').toLowerCase();
      if (tag==='input' && type==='password') continue; // never expose credential fields
      var isText = (tag==='textarea') || (tag==='input' && ['text','search','email','url','tel','number',''].indexOf(type)>=0);
      var isSubmit = type==='submit' || (tag==='button' && (type===''||type==='submit') && !!el.closest('form'));
      el.setAttribute('data-agf-idx', String(idx));
      elements.push({ i: idx, tag: tag, type: type, label: label(el), text: isText, submit: isSubmit, href: el.getAttribute('href')||'' });
      idx++;
    }
    var text = (document.body ? document.body.innerText : '') || '';
    text = text.replace(/[ \\t]+\\n/g,'\\n').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,${MAX_TEXT_CHARS});
    report({ requestId: REQ, url: location.href, title: document.title || '', text: text, elements: elements });
  } catch(e){
    report({ requestId: REQ, url: (location && location.href) || '', title: '', text: '', elements: [], error: String(e) });
  }
})();`;
}

/** Click the element tagged with the given index. */
export function buildClickScript(index: number): string {
  return `(function(){ try { var el=document.querySelector('[data-agf-idx="${index}"]'); if(el){ el.scrollIntoView({block:'center'}); el.click(); } } catch(_){} })();`;
}

/**
 * Type `value` into the text element tagged with the given index, firing input/change so frameworks
 * notice. Does NOT submit — submission is a separate, confirmation-gated click.
 */
export function buildTypeScript(index: number, value: string): string {
  const v = JSON.stringify(value);
  return `(function(){ try { var el=document.querySelector('[data-agf-idx="${index}"]'); if(el){ el.focus(); var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value'); if(el.tagName==='TEXTAREA') d=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value'); try { d && d.set ? d.set.call(el, ${v}) : (el.value = ${v}); } catch(_){ el.value = ${v}; } el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } } catch(_){} })();`;
}

/** Scroll down by ~85% of the viewport to reveal more content. */
export function buildScrollScript(): string {
  return `(function(){ try { window.scrollBy(0, Math.round(window.innerHeight*0.85)); } catch(_){} })();`;
}
