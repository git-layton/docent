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
  /** For `<select>` elements: the visible option labels (capped), so the agent can choose one. */
  options?: string[];
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
const MAX_ELEMENTS = 150;
const MAX_TEXT_CHARS = 12000;

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
    var sel = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [onclick]';
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
      var item = { i: idx, tag: tag, type: type, label: label(el), text: isText, submit: isSubmit, href: el.getAttribute('href')||'' };
      if (tag==='select') {
        try {
          var opts = [];
          for (var oi=0; oi<el.options.length && oi<40; oi++) opts.push((el.options[oi].text||'').trim().slice(0,60));
          item.options = opts;
        } catch(_){}
      }
      elements.push(item);
      idx++;
    }
    // Rendered text: top document plus any SAME-ORIGIN iframe bodies (webmail message panes / reading
    // views). Cross-origin frames throw on contentDocument access — swallow and skip.
    function clean(s){ return (s||'').replace(/[ \\t]+\\n/g,'\\n').replace(/\\n{3,}/g,'\\n\\n').trim(); }
    var textParts = [(document.body ? document.body.innerText : '') || ''];
    try {
      var frames = document.querySelectorAll('iframe');
      for (var fi=0; fi<frames.length && fi<8; fi++){
        var fd = null;
        try { fd = frames[fi].contentDocument; } catch(_) { fd = null; }
        if (fd && fd.body){ var ft = fd.body.innerText || ''; if (ft && ft.trim().length>40) textParts.push(ft); }
      }
    } catch(_){}
    var text = clean(textParts.join('\\n\\n')).slice(0,${MAX_TEXT_CHARS});
    report({ requestId: REQ, url: location.href, title: document.title || '', text: text, elements: elements });
  } catch(e){
    report({ requestId: REQ, url: (location && location.href) || '', title: '', text: '', elements: [], error: String(e) });
  }
})();`;
}

// Well-known ids for the control-frame overlay, so painting is idempotent and teardown is clean.
const CONTROL_FRAME_ID = '__docent-control-frame';
const CONTROL_STYLE_ID = '__docent-control-style';

/**
 * The "Docent took control" indicator: a steady ember-violet frame around the page edge plus a small
 * "Docent is browsing for you" pill, injected into the browsed page while the agent is driving it —
 * the acting counterpart to GlowOverlay's perception glow, sharing the same `--af-glow-*` palette so
 * "the app is doing something" reads the same everywhere.
 *
 * `on=true` paints (idempotent — a no-op if already present, so it can be re-asserted every turn to
 * survive navigations); `on=false` removes it. The overlay is `pointer-events:none` so it can never
 * intercept the agent's own clicks, and its label is CSS generated content (`::after`) so it stays
 * out of `document.body.innerText` and never pollutes the page text the model reads back. Honors
 * prefers-reduced-motion with a static frame. Defensive throughout — a hostile page can't break it.
 */
export function buildControlFrameScript(on: boolean): string {
  const fid = JSON.stringify(CONTROL_FRAME_ID);
  const sid = JSON.stringify(CONTROL_STYLE_ID);
  if (!on) {
    return `(function(){ try {
      var f=document.getElementById(${fid}); if(f&&f.parentNode) f.parentNode.removeChild(f);
      var s=document.getElementById(${sid}); if(s&&s.parentNode) s.parentNode.removeChild(s);
    } catch(_){} })();`;
  }
  return `(function(){ try {
    if (!document.body || document.getElementById(${fid})) return;
    var reduce=false; try { reduce=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch(_){}
    if (!document.getElementById(${sid})) {
      var st=document.createElement('style'); st.id=${sid};
      st.textContent='@keyframes __docentCtl{0%,100%{opacity:.5}50%{opacity:.9}}'
        +'#'+${fid}+' .__docent-pill::after{content:"Docent is browsing for you"}';
      (document.head||document.documentElement).appendChild(st);
    }
    var f=document.createElement('div'); f.id=${fid}; f.setAttribute('aria-hidden','true');
    f.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647;border-radius:10px;'
      +'box-shadow:inset 0 0 0 3px rgba(165,155,255,.95),inset 0 0 46px 6px rgba(122,110,230,.55),inset 0 0 140px rgba(224,120,90,.16);'
      +(reduce?'opacity:.72;':'animation:__docentCtl 3s ease-in-out infinite;');
    var pill=document.createElement('div'); pill.className='__docent-pill';
    pill.style.cssText='position:absolute;top:12px;left:50%;transform:translateX(-50%);pointer-events:none;'
      +'display:flex;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;'
      +'background:rgba(20,18,40,.86);color:#E7E3FF;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
      +'box-shadow:0 4px 16px rgba(0,0,0,.35),inset 0 0 0 1px rgba(165,155,255,.35);white-space:nowrap;letter-spacing:.2px;';
    var dot=document.createElement('span');
    dot.style.cssText='width:7px;height:7px;border-radius:50%;background:rgba(224,120,90,.95);box-shadow:0 0 8px rgba(224,120,90,.9);flex:0 0 auto;'
      +(reduce?'':'animation:__docentCtl 1.4s ease-in-out infinite;');
    pill.appendChild(dot);
    f.appendChild(pill);
    document.body.appendChild(f);
  } catch(_){} })();`;
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

/**
 * Choose an option in the `<select>` tagged with the given index. Matches `value` against option text
 * or value (case-insensitive, substring), fires input/change so frameworks notice. No-op if not a select.
 */
export function buildSelectScript(index: number, value: string): string {
  const v = JSON.stringify(value);
  return `(function(){ try {
    var el=document.querySelector('[data-agf-idx="${index}"]');
    if(!el||el.tagName!=='SELECT')return;
    var want=String(${v}).toLowerCase();
    var chosen=-1;
    for(var i=0;i<el.options.length;i++){
      var o=el.options[i];
      var t=(o.text||'').toLowerCase(), val=(o.value||'').toLowerCase();
      if(t===want||val===want){chosen=i;break;}
      if(chosen<0&&(t.indexOf(want)>=0||val.indexOf(want)>=0))chosen=i;
    }
    if(chosen>=0){ el.selectedIndex=chosen; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
  } catch(_){} })();`;
}

/**
 * Press a single key on the element tagged with the given index (or the document if it no longer
 * exists). Dispatches keydown/keypress/keyup with the right `key`/`keyCode` — Enter submits a focused
 * search box, Tab/Escape/Arrow navigate. Whitelisted keys only, so this can't be used to smuggle text.
 */
export function buildPressKeyScript(index: number, key: string): string {
  const KEY_CODES: Record<string, number> = {
    Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39,
    Backspace: 8, Delete: 46, Home: 36, End: 35, PageDown: 34, PageUp: 33, ' ': 32,
  };
  const code = KEY_CODES[key] ?? 0;
  const k = JSON.stringify(key);
  return `(function(){ try {
    var el=document.querySelector('[data-agf-idx="${index}"]')||document.activeElement||document.body;
    if(!el)return;
    try{ el.focus(); }catch(_){}
    var key=${k}, code=${code};
    ['keydown','keypress','keyup'].forEach(function(type){
      var ev;
      try{ ev=new KeyboardEvent(type,{key:key,code:key,keyCode:code,which:code,bubbles:true,cancelable:true}); }
      catch(_){ ev=document.createEvent('Event'); ev.initEvent(type,true,true); ev.key=key; ev.keyCode=code; ev.which=code; }
      el.dispatchEvent(ev);
    });
    // Enter on a lone input inside a form: submit it so search boxes without a visible button work.
    if(key==='Enter'&&el.form&&el.tagName==='INPUT'){ try{ if(el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }catch(_){} }
  } catch(_){} })();`;
}

/** Hover the element tagged with the given index — reveals hover menus / tooltips before a click. */
export function buildHoverScript(index: number): string {
  return `(function(){ try {
    var el=document.querySelector('[data-agf-idx="${index}"]');
    if(!el)return;
    el.scrollIntoView({block:'center'});
    var r=el.getBoundingClientRect();
    var opts={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
    ['pointerover','mouseover','pointerenter','mouseenter','mousemove'].forEach(function(type){
      try{ el.dispatchEvent(new MouseEvent(type,opts)); }catch(_){}
    });
  } catch(_){} })();`;
}

/**
 * Find the on-page passage that best matches `snippet` (the agent's answer/quote), wash it with a
 * visible highlight, and smooth-scroll it into view — so the user can SEE where the answer came
 * from (transparent browsing). Best-effort and null-safe: matches case-insensitively on a chunk of
 * the snippet, progressively shortening from the first ~8 words to tolerate paraphrase, and is a
 * silent no-op if nothing matches. `snippet` is JSON.stringify'd into the script to escape it.
 */
export function buildHighlightScript(snippet: string): string {
  const s = JSON.stringify(snippet || '');
  return `(function(){
  try {
    var snippet = ${s};
    if (!snippet) return;
    // Build progressively shorter candidate phrases from the first words of the snippet, so we can
    // still anchor on a paraphrased answer where only the opening clause matches verbatim.
    var words = snippet.replace(/\\s+/g,' ').trim().split(' ').filter(Boolean);
    if (!words.length) return;
    var candidates = [];
    var lens = [8, 6, 4, 3];
    for (var li=0; li<lens.length; li++){
      var n = Math.min(lens[li], words.length);
      var phrase = words.slice(0, n).join(' ').toLowerCase();
      if (phrase.length >= 8 && candidates.indexOf(phrase) < 0) candidates.push(phrase);
    }
    if (!candidates.length) return;
    // Walk text nodes and find the closest containing element whose text includes a candidate.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var target = null;
    var node;
    while ((node = walker.nextNode())) {
      var txt = (node.textContent || '').replace(/\\s+/g,' ').toLowerCase();
      if (!txt || txt.length < 8) continue;
      for (var ci=0; ci<candidates.length; ci++){
        if (txt.indexOf(candidates[ci]) >= 0) { target = node.parentElement; break; }
      }
      if (target) break;
    }
    if (!target) return;
    target.style.backgroundColor = 'rgba(250, 204, 21, .45)';
    target.style.outline = '2px solid rgba(250, 204, 21, .9)';
    target.style.borderRadius = '3px';
    target.style.scrollMarginTop = '80px';
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_){ target.scrollIntoView(); }
  } catch(_){}
})();`;
}
