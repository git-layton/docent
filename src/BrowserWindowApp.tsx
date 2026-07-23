import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Bot, X, Lock, Zap, Star, Key, Plus, BookMarked } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { emit, listen } from '@tauri-apps/api/event';
import { useProactiveCommentary } from './services/proactiveCommentary';
import { useBrowserStore } from './store/useBrowserStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useMemoryStore } from './store/useMemoryStore';
import { generatePageDigest } from './services/pageDigest';
import { BrowserContextMenu } from './components/BrowserContextMenu';
import { BrowserPasswordBar } from './components/BrowserPasswordBar';

/**
 * @deprecated BrowserWindowApp is no longer used as a standalone window.
 * The browser is now embedded as an OmniTab via BrowserTabContent.
 * This file is kept for reference during the migration period.
 */

const HOME_URL = 'https://start.duckduckgo.com';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[^\s]+\.[^\s]+/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`;
  return `https://start.duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

const BROWSER_LABEL = 'browser-panel';

function tryHostname(rawUrl: string): string {
  try { return new URL(rawUrl).hostname; } catch { return rawUrl; }
}

function TabFavicon({ url }: { url: string }) {
  const [err, setErr] = useState(false);
  if (err || !url || url === HOME_URL) return <Globe className="w-3 h-3 shrink-0 opacity-40" />;
  try {
    const origin = new URL(url).origin;
    return (
      <img
        src={`${origin}/favicon.ico`}
        width={12}
        height={12}
        onError={() => setErr(true)}
        className="w-3 h-3 shrink-0 object-contain"
        alt=""
      />
    );
  } catch {
    return <Globe className="w-3 h-3 shrink-0 opacity-40" />;
  }
}

const AD_BLOCKED_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adnxs.com', 'advertising.com', 'criteo.net', 'criteo.com',
  'taboola.com', 'outbrain.com', 'scorecardresearch.com',
  'quantserve.com', 'hotjar.com', 'ads.twitter.com',
  'pixel.facebook.com', 'connect.facebook.net/en_US/fbevents.js',
  'googletagmanager.com', 'google-analytics.com',
];

const AD_BLOCK_SCRIPT = `(function(){
  if(window.__agfAdBlock)return;
  window.__agfAdBlock=true;
  var blk=${JSON.stringify(AD_BLOCKED_DOMAINS)};
  var oFetch=window.fetch;
  window.fetch=function(u){
    if(typeof u==='string'&&blk.some(function(d){return u.indexOf(d)>=0;}))
      return Promise.resolve(new Response('',{status:200}));
    return oFetch.apply(this,arguments);
  };
  var oOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    if(typeof u==='string'&&blk.some(function(d){return u.indexOf(d)>=0;})){
      this._agfBlocked=true;return;
    }
    return oOpen.apply(this,arguments);
  };
  var oSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send=function(){
    if(this._agfBlocked)return;
    return oSend.apply(this,arguments);
  };
  var sel=['[id*="google_ads"]','[class*="adsbygoogle"]','[id*="taboola-"]','[class*="outbrain"]','iframe[src*="doubleclick"]','ins.adsbygoogle'];
  function rm(){sel.forEach(function(s){document.querySelectorAll(s).forEach(function(el){el.remove();})});}
  rm();
  new MutationObserver(rm).observe(document.body||document.documentElement,{childList:true,subtree:true});
})();`;

const PIP_SCRIPT = `(function(){
  if(window.__agfPip)return;
  window.__agfPip=true;
  document.addEventListener('mouseover',function(e){
    var v=e.target.closest('video');
    if(!v||v.__agfBtn)return;
    v.__agfBtn=true;
    var w=v.parentElement;
    if(!w)return;
    if(w.style.position!=='relative'&&w.style.position!=='absolute')w.style.position='relative';
    var b=document.createElement('button');
    b.textContent='⧉';
    b.title='Picture in Picture';
    b.style.cssText='position:absolute;top:8px;right:8px;z-index:9999;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:15px;line-height:1;';
    b.onclick=function(ev){ev.stopPropagation();if(v.requestPictureInPicture)v.requestPictureInPicture().catch(function(){});};
    w.appendChild(b);
  },true);
})();`;

interface ProactiveChipProps {
  comment: string;
  onDismiss: () => void;
}

function ProactiveChip({ comment, onDismiss }: ProactiveChipProps) {
  return (
    <div
      className={clsx(
        'absolute bottom-4 right-4 z-30',
        'flex items-start gap-2.5 max-w-xs',
        'bg-panel',
        'border border-edge',
        'rounded-xl shadow-lg px-3.5 py-3',
        'animate-in slide-in-from-bottom-3 fade-in duration-300',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-md bg-accent flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-on-accent" />
      </div>
      <p className="flex-1 text-xs text-ink-2 leading-relaxed">{comment}</p>
      <button
        onClick={onDismiss}
        className="shrink-0 mt-0.5 p-0.5 rounded-md text-ink-3 hover:text-ink-2 hover:bg-wash transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface BrowserTabState {
  id: string;
  url: string;
  title: string;
}

function makeTab(url = HOME_URL, title = ''): BrowserTabState {
  return { id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, url, title: title || new URL(url).hostname };
}

export function BrowserWindowApp() {
  console.warn('[BrowserWindowApp] Deprecated: browser is now a tab via BrowserTabContent (OmniTab)');
  const initialTabRef = useRef(makeTab());
  const [tabs, setTabs] = useState<BrowserTabState[]>([initialTabRef.current]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTabRef.current.id);

  const [url, setUrl] = useState(HOME_URL);
  const [inputUrl, setInputUrl] = useState(HOME_URL);
  const [isLoading, setIsLoading] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [pageContent, setPageContent] = useState('');
  const [isSavingToKB, setIsSavingToKB] = useState(false);
  const [kbSaved, setKbSaved] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [zoom, setZoom] = useState(1.0);
  const [downloadToast, setDownloadToast] = useState<{ filename: string; success: boolean } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: Array<{ label: string; action: () => void; danger?: boolean }> } | null>(null);
  const [passwordBarOpen, setPasswordBarOpen] = useState(false);
  const [pwHost, setPwHost] = useState('');
  const [pwMode, setPwMode] = useState<'autofill' | 'save-prompt' | null>(null);
  const [pwSaveUsername, setPwSaveUsername] = useState('');
  const [pwSavePassword, setPwSavePassword] = useState('');

  const updateZoom = useCallback((factor: number) => {
    const clamped = Math.max(0.25, Math.min(5.0, Math.round(factor * 100) / 100));
    setZoom(clamped);
    invoke('browser_set_zoom', { label: BROWSER_LABEL, factor: clamped }).catch(() => {});
  }, []);

  const contentRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<Webview | null>(null);
  const mountedRef = useRef(true);
  const urlRef = useRef(url);
  const visitIdRef = useRef<string | null>(null);
  const activeTabIdRef = useRef(activeTabId);

  urlRef.current = url;
  activeTabIdRef.current = activeTabId;

  const proactiveEnabled = useBrowserStore(s => s.proactiveEnabled);
  const favorites = useBrowserStore(s => s.favorites);
  const isFavorited = favorites.some(f => f.url === url);
  const { comment, dismiss } = useProactiveCommentary(url, pageTitle, pageContent, proactiveEnabled);

  // Hydrate store on mount, restore saved tabs
  useEffect(() => {
    useBrowserStore.getState().hydrate().then(() => {
      const { savedTabs, savedActiveTabId } = useBrowserStore.getState();
      if (savedTabs.length > 0) {
        setTabs(savedTabs);
        const targetId = savedActiveTabId ?? savedTabs[0].id;
        setActiveTabId(targetId);
        const activeTab = savedTabs.find(t => t.id === targetId) ?? savedTabs[0];
        setUrl(activeTab.url);
        setInputUrl(activeTab.url);
        setPageTitle(activeTab.title);
      }
    }).catch(() => {});
  }, []);

  // Sync active tab's URL/title when URL or pageTitle changes
  useEffect(() => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabIdRef.current
        ? { ...t, url, title: pageTitle || (url ? new URL(url).hostname : '') }
        : t
    ));
  }, [url, pageTitle]);

  // Create/destroy the native child webview on mount/unmount
  useEffect(() => {
    mountedRef.current = true;
    let wv: Webview | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function init() {
      // Wait for a paint so the layout is settled and contentRef has real dimensions
      await new Promise(r => requestAnimationFrame(r));
      if (!mountedRef.current || !contentRef.current) return;

      // Close any stale webview with this label (HMR / mode-switch cleanup)
      try {
        const stale = await Webview.getByLabel(BROWSER_LABEL);
        if (stale) {
          await stale.close();
          await new Promise(r => setTimeout(r, 80));
        }
      } catch (_) {}

      if (!mountedRef.current || !contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return; // layout not ready

      const win = await getCurrentWindow();
      wv = new Webview(win, BROWSER_LABEL, {
        url: HOME_URL,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      webviewRef.current = wv;

      // Poll URL every 800ms to sync nav bar with user clicks inside the webview
      pollInterval = setInterval(async () => {
        if (!mountedRef.current) return;
        try {
          const currentUrl = await invoke<string>('browser_get_url', { label: BROWSER_LABEL });
          if (!mountedRef.current) return;
          if (currentUrl && currentUrl !== urlRef.current) {
            setUrl(currentUrl);
            setInputUrl(currentUrl);
            setIsLoading(false);
          }
        } catch (_) { /* webview may not exist yet */ }
      }, 800);
    }

    init().catch(console.error);

    return () => {
      mountedRef.current = false;
      if (pollInterval !== null) clearInterval(pollInterval);
      webviewRef.current = null;
      // Close async after cleanup — don't await
      Webview.getByLabel(BROWSER_LABEL).then(wv => wv?.close()).catch(() => {});
    };
  }, []);

  // Keep webview bounds in sync with the container div
  useEffect(() => {
    if (!contentRef.current) return;

    const syncBounds = () => {
      const wv = webviewRef.current;
      if (!wv || !contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      wv.setPosition(new LogicalPosition(Math.round(rect.left), Math.round(rect.top))).catch(() => {});
      wv.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height))).catch(() => {});
    };

    const observer = new ResizeObserver(syncBounds);
    observer.observe(contentRef.current);
    window.addEventListener('resize', syncBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, []);

  // Capture page content and update the store on each URL change
  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    async function capture() {
      const visitId = `visit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      visitIdRef.current = visitId;
      setKbSaved(false);

      let title = '';
      const text = '';
      let isPrivate = false;

      try {
        isPrivate = await invoke<boolean>('check_page_is_private', { html: '', url });
      } catch (_) {}

      // Try to derive title from the URL as a fallback
      try { title = new URL(url).hostname; } catch (_) { title = url; }

      if (cancelled) return;

      useBrowserStore.getState().setActiveTab({ url, title, content: text, lastCapturedAt: Date.now() });
      setPageTitle(title);
      setPageContent(text);

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      useBrowserStore.getState().addVisitLogEntry({
        id: visitId,
        url,
        title,
        timestamp: Date.now(),
        wordCount,
        wasDigested: false,
        isPrivate,
      });
    }

    capture();
    return () => { cancelled = true; };
  }, [url]);

  // Emit page context to main window whenever page data changes
  useEffect(() => {
    if (!url) return;
    emit('browser:page-changed', { url, title: pageTitle, content: pageContent }).catch(() => {});
  }, [url, pageTitle, pageContent]);

  // Persist tab state when tabs change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      useBrowserStore.getState().setSavedTabs(tabs, activeTabId).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [tabs, activeTabId]);

  // Inject pop-up handler on every navigation — re-injects because each page has a fresh JS context
  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => {
      invoke('browser_eval', {
        label: BROWSER_LABEL,
        script: `(function(){
        if(window.__popupHandled)return;
        window.__popupHandled=true;
        window.open=function(url,target,features){
          if(url&&typeof url==='string'&&url.startsWith('http')){
            if(features&&features.length>0){
              window.location.href=url;
            } else {
              window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke('browser_open_tab',{url:url});
            }
          }
          return null;
        };
      })();`
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [url]);

  // Inject download link interceptor on every navigation
  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => {
      invoke('browser_eval', {
        label: BROWSER_LABEL,
        script: `(function(){
        if(window.__dlHandled)return;
        window.__dlHandled=true;
        document.addEventListener('click',function(e){
          var a=e.target.closest('a[download]');
          if(!a||!a.href)return;
          e.preventDefault();
          var fn=a.getAttribute('download')||a.href.split('/').pop()||'download';
          window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke('browser_download_url',{url:a.href,filename:fn});
        },true);
      })();`
      }).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [url]);

  // Inject ad/tracker blocker — skip Google/auth domains to avoid breaking login flows
  useEffect(() => {
    if (!url || url === HOME_URL) return;
    try {
      const h = new URL(url).hostname;
      if (/(?:^|\.)google\.com$|^accounts\.google\.com$|^gmail\.com$|^youtube\.com$/.test(h)) return;
    } catch (_) {}
    const t = setTimeout(() => {
      invoke('browser_eval', { label: BROWSER_LABEL, script: AD_BLOCK_SCRIPT }).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [url]);

  // Inject PiP button on video elements
  useEffect(() => {
    if (!url || url === HOME_URL) return;
    const t = setTimeout(() => {
      invoke('browser_eval', { label: BROWSER_LABEL, script: PIP_SCRIPT }).catch(() => {});
    }, 1100);
    return () => clearTimeout(t);
  }, [url]);

  // Inject password form detector — fires Tauri events on password field focus and form submit
  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => {
      invoke('browser_eval', {
        label: BROWSER_LABEL,
        script: `(function(){
        if(window.__agfPwDetect)return;
        window.__agfPwDetect=true;
        var T=window.__TAURI_INTERNALS__;
        document.addEventListener('focus',function(e){
          if(e.target.type==='password'&&T){
            T.invoke('browser_password_event',{eventType:'focus',host:location.hostname,username:null,password:null});
          }
        },true);
        document.addEventListener('submit',function(e){
          var f=e.target;
          var pw=f.querySelector('input[type="password"]');
          if(!pw||!pw.value||!T)return;
          var u=f.querySelector('input[type="email"]')||f.querySelector('input[type="text"]')||f.querySelector('input[name*="user"]')||f.querySelector('input[name*="email"]');
          T.invoke('browser_password_event',{eventType:'submit',host:location.hostname,username:u?u.value:null,password:pw.value});
        },true);
      })();`
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [url]);

  // Listen for popup-as-new-tab requests from WKWebView content
  useEffect(() => {
    const p = listen<{ url: string }>('browser:open-tab', e => {
      const tabUrl = e.payload?.url;
      if (!tabUrl) return;
      const t = makeTab(tabUrl, '');
      setTabs(prev => [...prev, t]);
      setActiveTabId(t.id);
      setUrl(tabUrl);
      setInputUrl(tabUrl);
      setIsLoading(true);
      invoke('browser_navigate', { label: BROWSER_LABEL, url: tabUrl }).catch(() => setIsLoading(false));
    });
    return () => { p.then(f => f()); };
  }, []);

  // Listen for password form events from WKWebView content
  useEffect(() => {
    const p = listen<{ type: string; host: string; username?: string; password?: string }>(
      'browser:password-event',
      async e => {
        const { type, host, username, password } = e.payload ?? {};
        if (type === 'focus') {
          const result = await invoke<{ ok: boolean }>('keychain_get', { host }).catch(() => ({ ok: false }));
          if (result.ok) {
            setPwHost(host);
            setPwMode('autofill');
          }
        } else if (type === 'submit' && password) {
          setPwHost(host);
          setPwSaveUsername(username ?? '');
          setPwSavePassword(password);
          setPwMode('save-prompt');
        }
      },
    );
    return () => { p.then(f => f()); };
  }, []);

  const navigate = useCallback((target?: string) => {
    const dest = normalizeUrl(target ?? inputUrl);
    setIsLoading(true);
    setUrl(dest);
    setInputUrl(dest);
    invoke('browser_navigate', { label: BROWSER_LABEL, url: dest }).catch(() => setIsLoading(false));
  }, [inputUrl]);

  const openNewTab = useCallback(() => {
    const t = makeTab();
    setTabs(prev => [...prev, t]);
    setActiveTabId(t.id);
    setUrl(HOME_URL);
    setInputUrl(HOME_URL);
    setPageTitle('');
    setIsLoading(true);
    invoke('browser_navigate', { label: BROWSER_LABEL, url: HOME_URL }).catch(() => setIsLoading(false));
  }, []);

  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(prev => {
      if (prev.length === 1) return prev; // keep at least one tab
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      if (id === activeTabIdRef.current) {
        const newActive = next[Math.max(0, idx - 1)];
        setActiveTabId(newActive.id);
        setUrl(newActive.url);
        setInputUrl(newActive.url);
        invoke('browser_navigate', { label: BROWSER_LABEL, url: newActive.url }).catch(() => {});
      }
      return next;
    });
  }, []);

  const switchTab = useCallback((id: string) => {
    if (id === activeTabIdRef.current) return;
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    setActiveTabId(id);
    setUrl(tab.url);
    setInputUrl(tab.url);
    setPageTitle(tab.title);
    setIsLoading(true);
    invoke('browser_navigate', { label: BROWSER_LABEL, url: tab.url }).catch(() => setIsLoading(false));
  }, [tabs]);

  const showTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New Tab', action: openNewTab },
        ...(tabs.length > 1 ? [{ label: 'Close Tab', action: () => closeTab(tabId, e), danger: true }] : []),
        ...(tabs.length > 1 ? [{ label: 'Close Other Tabs', action: () => {
          const keep = tabs.find(t => t.id === tabId);
          if (!keep) return;
          setTabs([keep]);
          setActiveTabId(keep.id);
          setUrl(keep.url);
          setInputUrl(keep.url);
          invoke('browser_navigate', { label: BROWSER_LABEL, url: keep.url }).catch(() => {});
        }, danger: true }] : []),
      ],
    });
  }, [tabs, openNewTab, closeTab]);

  const showUrlContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Copy URL', action: () => navigator.clipboard.writeText(url).catch(() => {}) },
        { label: 'Paste and Go', action: async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text.trim()) {
              setInputUrl(text.trim());
              const dest = text.trim().startsWith('http') ? text.trim() : `https://start.duckduckgo.com/?q=${encodeURIComponent(text.trim())}`;
              setIsLoading(true);
              setUrl(dest);
              setInputUrl(dest);
              invoke('browser_navigate', { label: BROWSER_LABEL, url: dest }).catch(() => {});
            }
          } catch (_) {}
        }},
      ],
    });
  }, [url]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigate();
  };

  const handleBack = () => {
    setIsLoading(true);
    invoke('browser_go_back', { label: BROWSER_LABEL }).catch(() => {});
    setTimeout(() => { if (mountedRef.current) setIsLoading(false); }, 3000);
  };

  const handleForward = () => {
    setIsLoading(true);
    invoke('browser_go_forward', { label: BROWSER_LABEL }).catch(() => {});
    setTimeout(() => { if (mountedRef.current) setIsLoading(false); }, 3000);
  };

  const handleReload = () => {
    setIsLoading(true);
    invoke('browser_reload', { label: BROWSER_LABEL }).catch(() => {});
    setTimeout(() => { if (mountedRef.current) setIsLoading(false); }, 2000);
  };

  const handleAutofill = useCallback(async () => {
    const result = await invoke<{ ok: boolean; username?: string; password?: string }>(
      'keychain_get', { host: pwHost }
    ).catch(() => ({ ok: false, username: undefined, password: undefined }));
    if (!result.ok || !result.password) return;
    const script = `(function(){
      function fill(el,val){
        if(!el)return;
        var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
        if(d&&d.set)d.set.call(el,val);else el.value=val;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
      }
      var pw=document.querySelector('input[type="password"]');
      var u=pw&&pw.form?(pw.form.querySelector('input[type="email"]')||pw.form.querySelector('input[type="text"]')):document.querySelector('input[type="email"]');
      fill(pw,${JSON.stringify(result.password)});
      fill(u,${JSON.stringify(result.username ?? '')});
    })();`;
    invoke('browser_eval', { label: BROWSER_LABEL, script }).catch(() => {});
    setPwMode(null);
  }, [pwHost]);

  const handleSaveCredentials = useCallback(async () => {
    await invoke('keychain_save', { host: pwHost, username: pwSaveUsername, password: pwSavePassword }).catch(() => {});
    setPwMode(null);
  }, [pwHost, pwSaveUsername, pwSavePassword]);

  // Browser keyboard shortcuts (active when React chrome has focus)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      switch (e.key) {
        case 'l':
          e.preventDefault();
          (document.querySelector('input[type="text"]') as HTMLInputElement | null)?.focus();
          break;
        case 't':
          e.preventDefault();
          openNewTab();
          break;
        case 'w':
          e.preventDefault();
          if (tabs.length > 1) {
            setTabs(prev => {
              if (prev.length === 1) return prev;
              const idx = prev.findIndex(t => t.id === activeTabId);
              const next = prev.filter(t => t.id !== activeTabId);
              const newActive = next[Math.max(0, idx - 1)];
              setActiveTabId(newActive.id);
              setUrl(newActive.url);
              setInputUrl(newActive.url);
              invoke('browser_navigate', { label: BROWSER_LABEL, url: newActive.url }).catch(() => {});
              return next;
            });
          }
          break;
        case 'r':
          e.preventDefault();
          handleReload();
          break;
        case 'd':
          e.preventDefault();
          if (isFavorited) {
            useBrowserStore.getState().removeFavorite(url);
          } else {
            useBrowserStore.getState().addFavorite(url, pageTitle || url);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey as EventListener);
    return () => window.removeEventListener('keydown', onKey as EventListener);
  }, [tabs, activeTabId, openNewTab, handleReload, url, pageTitle, isFavorited]);

  // Cmd+F / Ctrl+F to toggle find bar
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setFindOpen(v => !v);
      }
      if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
        setFindQuery('');
      }
    };
    window.addEventListener('keydown', onKey as EventListener);
    return () => window.removeEventListener('keydown', onKey as EventListener);
  }, [findOpen]);

  // Zoom keyboard shortcuts: Cmd+= / Cmd++ to zoom in, Cmd+- to zoom out, Cmd+0 to reset
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === '+' || e.key === '=' || e.key === 'Equal') {
        e.preventDefault();
        setZoom(prev => {
          const next = Math.round((prev + 0.1) * 100) / 100;
          const clamped = Math.min(5.0, next);
          invoke('browser_set_zoom', { label: BROWSER_LABEL, factor: clamped }).catch(() => {});
          return clamped;
        });
      } else if (e.key === '-' || e.key === 'Minus') {
        e.preventDefault();
        setZoom(prev => {
          const next = Math.round((prev - 0.1) * 100) / 100;
          const clamped = Math.max(0.25, next);
          invoke('browser_set_zoom', { label: BROWSER_LABEL, factor: clamped }).catch(() => {});
          return clamped;
        });
      } else if (e.key === '0') {
        e.preventDefault();
        updateZoom(1.0);
      }
    };
    window.addEventListener('keydown', onKey as EventListener);
    return () => window.removeEventListener('keydown', onKey as EventListener);
  }, [updateZoom]);

  const handleSaveToKB = async () => {
    if (isSavingToKB) return;
    setIsSavingToKB(true);
    try {
      const models = useSettingsStore.getState().models;
      const selectedModelId = useSettingsStore.getState().selectedModelId;
      const modelConfig = models.find(m => m.id === selectedModelId) ?? models[0];
      const agentForgePath = useMemoryStore.getState().agentForgePath;
      const storeEntry = useBrowserStore.getState().visitLog.find(e => e.id === visitIdRef.current);

      await generatePageDigest(
        {
          url,
          title: pageTitle,
          cleanText: pageContent,
          wordCount: pageContent.split(/\s+/).filter(Boolean).length,
          capturedAt: Date.now(),
          isPrivate: storeEntry?.isPrivate ?? false,
        },
        modelConfig,
        agentForgePath,
      );

      if (visitIdRef.current) {
        await useBrowserStore.getState().markVisitDigested(visitIdRef.current);
      }
      setKbSaved(true);
    } catch (e) {
      console.error('[BrowserWindowApp] save to KB failed:', e);
    } finally {
      setIsSavingToKB(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-panel overflow-hidden select-none">
      <style>{`
        @keyframes browser-progress {
          0%   { width: 0% }
          15%  { width: 35% }
          50%  { width: 65% }
          80%  { width: 82% }
          100% { width: 92% }
        }
        .browser-progress-bar { animation: browser-progress 10s ease-out forwards; }
      `}</style>

      {/* Tab bar */}
      <div className="h-9 flex items-center gap-0.5 px-1.5 bg-inset shrink-0 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            onContextMenu={e => showTabContextMenu(e, tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-medium shrink-0 max-w-[180px] min-w-[80px] transition-all group',
              tab.id === activeTabId
                ? 'bg-panel text-ink shadow-sm'
                : 'text-ink-2 hover:bg-wash hover:text-ink',
            )}
          >
            <TabFavicon url={tab.url} />
            <span className="truncate flex-1 min-w-0 text-left">{tab.title || tryHostname(tab.url)}</span>
            <span
              onClick={e => closeTab(tab.id, e)}
              className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-md hover:bg-wash opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0"
              title="Close tab"
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </button>
        ))}
        <button
          onClick={openNewTab}
          className="w-7 h-7 flex items-center justify-center ml-0.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors shrink-0"
          title="New tab (Cmd+T)"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Loading progress bar */}
      {isLoading && (
        <div className="h-[2px] bg-inset shrink-0 overflow-hidden">
          <div className="h-full bg-accent browser-progress-bar" />
        </div>
      )}

      {/* Nav bar */}
      <div className="h-10 flex items-center gap-1 px-2 border-b border-edge shrink-0 z-10 bg-panel">
        {/* Navigation buttons */}
        <div className="flex items-center gap-0.5 mr-0.5">
          <button
            onClick={handleBack}
            className="p-1.5 rounded-lg transition-colors text-ink-3 hover:bg-wash hover:text-ink"
            title="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleForward}
            className="p-1.5 rounded-lg transition-colors text-ink-3 hover:bg-wash hover:text-ink"
            title="Forward"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReload}
            className="p-1.5 rounded-lg transition-colors text-ink-3 hover:bg-wash hover:text-ink"
            title="Reload (Cmd+R)"
          >
            <RotateCw className={clsx('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          </button>
        </div>

        {/* Address bar */}
        <div className="relative flex-1 min-w-0">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            {url.startsWith('https://')
              ? <Lock className="w-3 h-3 text-success" />
              : <Globe className="w-3 h-3 text-ink-3" />
            }
          </div>
          <input
            type="text"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={e => e.target.select()}
            onContextMenu={showUrlContextMenu}
            placeholder="Search or enter address"
            className="w-full h-7 rounded-full bg-inset pl-8 pr-3 text-[11px] font-medium outline-none focus:ring-1 ring-accent/40 text-ink placeholder:text-ink-3 transition-shadow"
          />
        </div>

        {/* Right controls */}
        {zoom !== 1.0 && (
          <button
            onClick={() => { setZoom(1.0); invoke('browser_set_zoom', { label: BROWSER_LABEL, factor: 1.0 }).catch(() => {}); }}
            className="text-[10px] font-semibold text-ink-2 hover:text-ink px-1.5 py-0.5 rounded-md bg-inset hover:bg-wash shrink-0 transition-colors"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
        <button
          onClick={() => {
            if (isFavorited) {
              useBrowserStore.getState().removeFavorite(url);
            } else {
              useBrowserStore.getState().addFavorite(url, pageTitle || tryHostname(url));
            }
          }}
          className={clsx(
            'p-1.5 rounded-lg transition-colors shrink-0',
            isFavorited
              ? 'text-warning'
              : 'text-ink-3 hover:bg-wash hover:text-warning',
          )}
          title={isFavorited ? 'Remove from favorites' : 'Add to favorites (Cmd+D)'}
        >
          <Star className={clsx('w-4 h-4', isFavorited && 'fill-current')} />
        </button>
        <button
          onClick={() => useBrowserStore.getState().setProactiveEnabled(!proactiveEnabled)}
          className={clsx(
            'p-1.5 rounded-lg transition-colors shrink-0',
            proactiveEnabled
              ? 'bg-accent-soft/50 text-accent'
              : 'text-ink-3 hover:bg-wash hover:text-ink-2',
          )}
          title={proactiveEnabled ? 'AI commentary on' : 'AI commentary off'}
        >
          <Zap className="w-4 h-4" />
        </button>
        <button
          onClick={() => setPasswordBarOpen(v => !v)}
          className={clsx(
            'p-1.5 rounded-lg transition-colors shrink-0',
            passwordBarOpen
              ? 'bg-accent-soft/50 text-accent'
              : 'text-ink-3 hover:bg-wash hover:text-ink-2',
          )}
          title="Passwords"
        >
          <Key className="w-4 h-4" />
        </button>
        <button
          onClick={handleSaveToKB}
          disabled={isSavingToKB}
          className={clsx(
            'p-1.5 rounded-lg transition-colors shrink-0',
            kbSaved
              ? 'text-success'
              : 'text-ink-3 hover:bg-wash hover:text-accent',
            isSavingToKB && 'opacity-50 cursor-not-allowed',
          )}
          title={kbSaved ? 'Saved to Knowledge Base' : 'Save to Knowledge Base'}
        >
          {isSavingToKB
            ? <RotateCw className="w-4 h-4 animate-spin" />
            : <BookMarked className={clsx('w-4 h-4', kbSaved && 'fill-current')} />
          }
        </button>
      </div>

      {/* Password bar — auto modes (autofill / save-prompt) or manual via key button */}
      {(pwMode || passwordBarOpen) && (
        <BrowserPasswordBar
          mode={pwMode ?? 'manual'}
          host={pwHost || (() => { try { return new URL(url).hostname; } catch { return url; } })()}
          pendingUsername={pwSaveUsername}
          pendingPassword={pwSavePassword}
          onAutofill={handleAutofill}
          onSaveConfirm={handleSaveCredentials}
          onClose={() => { setPwMode(null); setPasswordBarOpen(false); }}
        />
      )}

      {/* Favorites bar */}
      {favorites.length > 0 && (
        <div className="h-8 flex items-center gap-0.5 px-3 bg-panel-2 border-b border-edge shrink-0 overflow-x-auto no-scrollbar">
          {favorites.map(fav => (
            <button
              key={fav.id}
              onClick={() => navigate(fav.url)}
              onContextMenu={e => { e.preventDefault(); useBrowserStore.getState().removeFavorite(fav.url); }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-ink-2 hover:bg-wash hover:text-ink transition-colors whitespace-nowrap shrink-0"
              title={`${fav.url}\nRight-click to remove`}
            >
              <TabFavicon url={fav.url} />
              {fav.title}
            </button>
          ))}
        </div>
      )}

      {/* Find bar */}
      {findOpen && (
        <div className="h-9 flex items-center gap-2 px-3 border-b border-edge shrink-0 bg-panel z-10">
          <input
            autoFocus
            type="text"
            value={findQuery}
            onChange={e => setFindQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') invoke('browser_find', { label: BROWSER_LABEL, query: findQuery, forward: !e.shiftKey }).catch(() => {});
              if (e.key === 'Escape') { setFindOpen(false); setFindQuery(''); }
            }}
            placeholder="Find in page…"
            className="flex-1 text-xs bg-inset rounded-full px-3 h-6 outline-none focus:ring-1 ring-accent/30 text-ink placeholder:text-ink-3"
          />
          <button onClick={() => invoke('browser_find', { label: BROWSER_LABEL, query: findQuery, forward: false }).catch(() => {})} className="text-[10px] text-ink-2 hover:text-ink px-1.5 py-0.5 rounded hover:bg-wash" title="Previous">↑</button>
          <button onClick={() => invoke('browser_find', { label: BROWSER_LABEL, query: findQuery, forward: true }).catch(() => {})} className="text-[10px] text-ink-2 hover:text-ink px-1.5 py-0.5 rounded hover:bg-wash" title="Next">↓</button>
          <button onClick={() => { setFindOpen(false); setFindQuery(''); }} className="p-1 rounded text-ink-3 hover:text-ink-2 hover:bg-wash">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content — full width, no AI sidebar */}
      <div className="flex-1 overflow-hidden">
        <div ref={contentRef} className="w-full h-full" />
      </div>

      {comment && <ProactiveChip comment={comment} onDismiss={dismiss} />}
      {downloadToast && (
        <div className={clsx(
          'absolute bottom-4 left-4 z-30',
          'flex items-center gap-2.5',
          'bg-panel',
          'border border-edge',
          'rounded-xl shadow-lg px-3.5 py-2.5',
          'animate-in slide-in-from-bottom-3 fade-in duration-300',
          'text-xs',
        )}>
          {downloadToast.success ? (
            <>
              <span className="text-success font-bold">↓</span>
              <span className="text-ink-2">Downloaded: <strong>{downloadToast.filename}</strong></span>
            </>
          ) : (
            <>
              <span className="text-danger font-bold">✕</span>
              <span className="text-ink-2">Download failed: {downloadToast.filename}</span>
            </>
          )}
          <button onClick={() => setDownloadToast(null)} className="ml-1 p-0.5 rounded text-ink-3 hover:text-ink-2">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {contextMenu && (
        <BrowserContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export default BrowserWindowApp;
