import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Bot, X, Lock, Zap, Star } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { useProactiveCommentary } from '../services/proactiveCommentary';
import { useBrowserStore } from '../store/useBrowserStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { generatePageDigest } from '../services/pageDigest';

const HOME_URL = 'https://duckduckgo.com';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[^\s]+\.[^\s]+/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

const BROWSER_LABEL = 'browser-panel';

export interface BrowserPanelProps {
  proactiveEnabled?: boolean;
}

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

export function BrowserPanel({ proactiveEnabled: _proactiveEnabled = false }: BrowserPanelProps) {
  const initialTabRef = useRef(makeTab());
  const [tabs, setTabs] = useState<BrowserTabState[]>([initialTabRef.current]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTabRef.current.id);

  // Keep activeTabId in sync with tabs on first render
  const [url, setUrl] = useState(HOME_URL);
  const [inputUrl, setInputUrl] = useState(HOME_URL);
  const [isLoading, setIsLoading] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const [pageContent, setPageContent] = useState('');
  const [isSavingToKB, setIsSavingToKB] = useState(false);
  const [kbSaved, setKbSaved] = useState(false);

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
      console.error('[BrowserPanel] save to KB failed:', e);
    } finally {
      setIsSavingToKB(false);
    }
  };

  return (
    <div className="relative flex flex-col h-full w-full bg-panel">
      {/* Tab bar */}
      <div className="h-9 flex items-end gap-0 px-2 bg-inset border-b border-edge shrink-0 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 h-7 rounded-t-lg text-[10px] font-medium shrink-0 max-w-[160px] transition-colors group',
              tab.id === activeTabId
                ? 'bg-panel text-ink border border-b-0 border-edge'
                : 'text-ink-2 hover:bg-wash hover:text-ink',
            )}
          >
            <Globe className="w-2.5 h-2.5 shrink-0 opacity-60" />
            <span className="truncate flex-1">{tab.title || new URL(tab.url).hostname}</span>
            {tabs.length > 1 && (
              <span
                onClick={e => closeTab(tab.id, e)}
                className="ml-1 p-0.5 rounded hover:bg-wash opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </span>
            )}
          </button>
        ))}
        <button
          onClick={openNewTab}
          className="ml-1 p-1 rounded text-ink-3 hover:text-ink hover:bg-wash transition-colors shrink-0 self-center"
          title="New tab"
        >
          <span className="text-sm leading-none">+</span>
        </button>
      </div>

      {/* Nav bar — rendered ABOVE the native webview overlay */}
      <div className="h-11 flex items-center gap-1.5 px-3 border-b border-edge shrink-0 z-10 bg-panel">
        <button
          onClick={handleBack}
          className="p-1.5 rounded-lg transition-colors text-ink-3 hover:bg-wash hover:text-ink"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={handleForward}
          className="p-1.5 rounded-lg transition-colors text-ink-3 hover:bg-wash hover:text-ink"
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={handleReload}
          className={clsx(
            'p-1.5 rounded-lg transition-colors text-ink-3 hover:bg-wash hover:text-ink',
            isLoading && 'animate-spin',
          )}
          title="Reload"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        <div className="relative flex-1 min-w-0">
          {url.startsWith('https://') && (
            <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-success pointer-events-none" />
          )}
          <input
            type="text"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={e => e.target.select()}
            placeholder="Search or enter URL..."
            className={clsx(
              'w-full h-8 pr-3 rounded-lg text-xs font-medium outline-none',
              url.startsWith('https://') ? 'pl-7' : 'pl-3',
              'bg-inset',
              'text-ink',
              'placeholder:text-ink-3',
              'focus:ring-1 ring-accent/30',
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
              ? 'text-warning'
              : 'text-ink-3 hover:bg-wash hover:text-warning',
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
              ? 'bg-accent-soft/50 text-accent'
              : 'text-ink-3 hover:bg-wash hover:text-ink-2',
          )}
          title={proactiveEnabled ? 'AI commentary on' : 'Enable AI commentary'}
        >
          <Zap className="w-4 h-4" />
        </button>

        <button
          onClick={handleSaveToKB}
          disabled={isSavingToKB}
          className={clsx(
            'flex items-center gap-1.5 px-3 h-8 rounded-lg transition-colors shrink-0 text-[10px] font-black uppercase tracking-widest',
            kbSaved
              ? 'bg-success-soft text-success'
              : 'bg-accent hover:bg-accent-strong text-on-accent',
            isSavingToKB && 'opacity-60 cursor-not-allowed',
          )}
          title="Save page to Knowledge Base"
        >
          {isSavingToKB ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
          {kbSaved ? 'Saved!' : 'Save to KB'}
        </button>
      </div>

      {/* Favorites bar */}
      {favorites.length > 0 && (
        <div className="h-8 flex items-center gap-0.5 px-2 border-b border-edge shrink-0 overflow-x-auto no-scrollbar">
          {favorites.map(fav => (
            <button
              key={fav.id}
              onClick={() => navigate(fav.url)}
              onContextMenu={e => { e.preventDefault(); useBrowserStore.getState().removeFavorite(fav.url); }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-ink-2 hover:bg-wash hover:text-ink transition-colors whitespace-nowrap shrink-0"
              title={`${fav.url}\nRight-click to remove`}
            >
              <Globe className="w-2.5 h-2.5 shrink-0 opacity-60" />
              {fav.title}
            </button>
          ))}
        </div>
      )}

      {/* Native webview renders over this div — keep it empty */}
      <div ref={contentRef} className="flex-1 w-full" />

      {comment && <ProactiveChip comment={comment} onDismiss={dismiss} />}
    </div>
  );
}

export default BrowserPanel;
