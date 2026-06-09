import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Bot, X, Lock, Zap, Star, Key } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { emit } from '@tauri-apps/api/event';
import { useProactiveCommentary } from './services/proactiveCommentary';
import { useBrowserStore } from './store/useBrowserStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useMemoryStore } from './store/useMemoryStore';
import { generatePageDigest } from './services/pageDigest';
import { BrowserSidebar } from './BrowserSidebar';
import { BrowserContextMenu } from './components/BrowserContextMenu';
import { BrowserPasswordBar } from './components/BrowserPasswordBar';

const HOME_URL = 'https://duckduckgo.com';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[^\s]+\.[^\s]+/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

const BROWSER_LABEL = 'browser-panel';

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
        'bg-white dark:bg-neutral-900',
        'border border-neutral-200 dark:border-neutral-700',
        'rounded-xl shadow-lg px-3.5 py-3',
        'animate-in slide-in-from-bottom-3 fade-in duration-300',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-md bg-[#4A5D75] flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-white" />
      </div>
      <p className="flex-1 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">{comment}</p>
      <button
        onClick={onDismiss}
        className="shrink-0 mt-0.5 p-0.5 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
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
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
      let text = '';
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

  // Inject pop-up handler into WKWebView (once on mount, after webview initializes)
  useEffect(() => {
    const t = setTimeout(() => {
      invoke('browser_eval', {
        label: BROWSER_LABEL,
        script: `(function(){
        if(window.__popupHandled)return;
        window.__popupHandled=true;
        var orig=window.open;
        window.open=function(url,target,features){
          if(url&&typeof url==='string'&&url.startsWith('http')){
            window.location.href=url;
          }
          return null;
        };
      })();`
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  // Inject download link interceptor into WKWebView (best-effort, one-time on mount)
  useEffect(() => {
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
    }, 1400);
    return () => clearTimeout(t);
  }, []);

  // Inject ad/tracker blocker into each page after load
  useEffect(() => {
    if (!url || url === HOME_URL) return;
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
              const dest = text.trim().startsWith('http') ? text.trim() : `https://duckduckgo.com/?q=${encodeURIComponent(text.trim())}`;
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
    <div className="flex flex-col h-screen w-screen bg-white dark:bg-neutral-900 overflow-hidden select-none">
      {/* Tab bar */}
      <div className="h-9 flex items-end gap-0 px-2 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 shrink-0 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            onContextMenu={e => showTabContextMenu(e, tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 h-7 rounded-t-lg text-[10px] font-medium shrink-0 max-w-[160px] transition-colors group',
              tab.id === activeTabId
                ? 'bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border border-b-0 border-neutral-200 dark:border-neutral-700'
                : 'text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-300',
            )}
          >
            <Globe className="w-2.5 h-2.5 shrink-0 opacity-60" />
            <span className="truncate flex-1">{tab.title || new URL(tab.url).hostname}</span>
            {tabs.length > 1 && (
              <span
                onClick={e => closeTab(tab.id, e)}
                className="ml-1 p-0.5 rounded hover:bg-neutral-300 dark:hover:bg-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </span>
            )}
          </button>
        ))}
        <button
          onClick={openNewTab}
          className="ml-1 p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors shrink-0 self-center"
          title="New tab"
        >
          <span className="text-sm leading-none">+</span>
        </button>
      </div>

      {/* Nav bar — rendered ABOVE the native webview overlay */}
      <div className="h-11 flex items-center gap-1.5 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0 z-10 bg-white dark:bg-neutral-900">
        <button
          onClick={handleBack}
          className="p-1.5 rounded-lg transition-colors text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={handleForward}
          className="p-1.5 rounded-lg transition-colors text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={handleReload}
          className={clsx(
            'p-1.5 rounded-lg transition-colors text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200',
            isLoading && 'animate-spin',
          )}
          title="Reload"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        {zoom !== 1.0 && (
          <button
            onClick={() => { setZoom(1.0); invoke('browser_set_zoom', { label: BROWSER_LABEL, factor: 1.0 }).catch(() => {}); }}
            className="text-[10px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 shrink-0 transition-colors font-medium"
            title="Reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
        <div className="relative flex-1 min-w-0">
          {url.startsWith('https://') && (
            <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-emerald-500 pointer-events-none" />
          )}
          <input
            type="text"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={e => e.target.select()}
            onContextMenu={showUrlContextMenu}
            placeholder="Search or enter URL..."
            className={clsx(
              'w-full h-8 pr-3 rounded-lg text-xs font-medium outline-none',
              url.startsWith('https://') ? 'pl-7' : 'pl-3',
              'bg-neutral-100 dark:bg-neutral-800',
              'text-neutral-900 dark:text-neutral-100',
              'placeholder:text-neutral-400',
              'focus:ring-1 ring-[#6A829E]/30',
            )}
          />
        </div>

        <button
          onClick={() => {
            if (isFavorited) {
              useBrowserStore.getState().removeFavorite(url);
            } else {
              useBrowserStore.getState().addFavorite(url, pageTitle || new URL(url).hostname);
            }
          }}
          className={clsx(
            'p-1.5 rounded-lg transition-colors shrink-0',
            isFavorited
              ? 'text-amber-400 hover:text-amber-500'
              : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-amber-400',
          )}
          title={isFavorited ? 'Remove bookmark' : 'Bookmark this page'}
        >
          <Star className={clsx('w-4 h-4', isFavorited && 'fill-current')} />
        </button>

        <button
          onClick={() => useBrowserStore.getState().setProactiveEnabled(!proactiveEnabled)}
          className={clsx(
            'p-1.5 rounded-lg transition-colors shrink-0',
            proactiveEnabled
              ? 'bg-[#4A5D75]/10 text-[#4A5D75] dark:text-[#6A829E]'
              : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600',
          )}
          title={proactiveEnabled ? 'AI commentary on' : 'Enable AI commentary'}
        >
          <Zap className="w-4 h-4" />
        </button>

        <button
          onClick={() => setPasswordBarOpen(v => !v)}
          className={clsx(
            'p-1.5 rounded-lg transition-colors shrink-0',
            passwordBarOpen
              ? 'bg-[#4A5D75]/10 text-[#4A5D75] dark:text-[#6A829E]'
              : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600',
          )}
          title="Password manager"
        >
          <Key className="w-4 h-4" />
        </button>

        <button
          onClick={handleSaveToKB}
          disabled={isSavingToKB}
          className={clsx(
            'flex items-center gap-1.5 px-3 h-8 rounded-lg transition-colors shrink-0 text-[10px] font-black uppercase tracking-widest',
            kbSaved
              ? 'bg-emerald-500 text-white'
              : 'bg-[#4A5D75] hover:bg-[#3D4D61] text-white',
            isSavingToKB && 'opacity-60 cursor-not-allowed',
          )}
          title="Save page to Knowledge Base"
        >
          {isSavingToKB ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
          {kbSaved ? 'Saved!' : 'Save to KB'}
        </button>
      </div>

      {/* Password bar */}
      {passwordBarOpen && (
        <BrowserPasswordBar
          host={(() => { try { return new URL(url).hostname; } catch { return url; } })()}
          onClose={() => setPasswordBarOpen(false)}
        />
      )}

      {/* Favorites bar */}
      {favorites.length > 0 && (
        <div className="h-8 flex items-center gap-0.5 px-2 border-b border-neutral-200 dark:border-neutral-800 shrink-0 overflow-x-auto no-scrollbar">
          {favorites.map(fav => (
            <button
              key={fav.id}
              onClick={() => navigate(fav.url)}
              onContextMenu={e => { e.preventDefault(); useBrowserStore.getState().removeFavorite(fav.url); }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors whitespace-nowrap shrink-0"
              title={`${fav.url}\nRight-click to remove`}
            >
              <Globe className="w-2.5 h-2.5 shrink-0 opacity-60" />
              {fav.title}
            </button>
          ))}
        </div>
      )}

      {findOpen && (
        <div className="h-9 flex items-center gap-2 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0 bg-white dark:bg-neutral-900 z-10">
          <input
            autoFocus
            type="text"
            value={findQuery}
            onChange={e => setFindQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                invoke('browser_find', { label: BROWSER_LABEL, query: findQuery, forward: !e.shiftKey }).catch(() => {});
              }
              if (e.key === 'Escape') {
                setFindOpen(false);
                setFindQuery('');
              }
            }}
            placeholder="Find in page…"
            className="flex-1 text-xs bg-neutral-100 dark:bg-neutral-800 rounded-lg px-3 h-6 outline-none focus:ring-1 ring-[#6A829E]/30 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
          />
          <button
            onClick={() => invoke('browser_find', { label: BROWSER_LABEL, query: findQuery, forward: false }).catch(() => {})}
            className="text-[10px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 px-1.5 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Previous match"
          >↑</button>
          <button
            onClick={() => invoke('browser_find', { label: BROWSER_LABEL, query: findQuery, forward: true }).catch(() => {})}
            className="text-[10px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 px-1.5 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Next match"
          >↓</button>
          <button
            onClick={() => { setFindOpen(false); setFindQuery(''); }}
            className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Close find bar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-row flex-1 overflow-hidden">
        {/* WKWebView placeholder — must be flex-1 */}
        <div ref={contentRef} className="flex-1 h-full" />
        {/* Sidebar slot — Unit 3 will fill this */}
        <BrowserSidebar
          url={url}
          pageTitle={pageTitle}
          pageContent={pageContent}
        />
      </div>

      {comment && <ProactiveChip comment={comment} onDismiss={dismiss} />}
      {downloadToast && (
        <div className={clsx(
          'absolute bottom-4 left-4 z-30',
          'flex items-center gap-2.5',
          'bg-white dark:bg-neutral-900',
          'border border-neutral-200 dark:border-neutral-700',
          'rounded-xl shadow-lg px-3.5 py-2.5',
          'animate-in slide-in-from-bottom-3 fade-in duration-300',
          'text-xs',
        )}>
          {downloadToast.success ? (
            <>
              <span className="text-emerald-500 font-bold">↓</span>
              <span className="text-neutral-700 dark:text-neutral-300">
                Downloaded: <strong>{downloadToast.filename}</strong>
              </span>
            </>
          ) : (
            <>
              <span className="text-red-500 font-bold">✕</span>
              <span className="text-neutral-700 dark:text-neutral-300">
                Download failed: {downloadToast.filename}
              </span>
            </>
          )}
          <button
            onClick={() => setDownloadToast(null)}
            className="ml-1 p-0.5 rounded text-neutral-400 hover:text-neutral-600"
          >
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
