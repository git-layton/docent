import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, Bot, X, Lock, Zap } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { useProactiveCommentary } from '../services/proactiveCommentary';
import { useBrowserStore } from '../store/useBrowserStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { generatePageDigest } from '../services/pageDigest';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'https://google.com';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[^\s]+\.[^\s]+/.test(trimmed) && !trimmed.includes(' ')) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
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

export function BrowserPanel({ proactiveEnabled: _proactiveEnabled = false }: BrowserPanelProps) {
  const [url, setUrl] = useState('https://google.com');
  const [inputUrl, setInputUrl] = useState('https://google.com');
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

  urlRef.current = url;

  const proactiveEnabled = useBrowserStore(s => s.proactiveEnabled);
  const { comment, dismiss } = useProactiveCommentary(url, pageTitle, pageContent, proactiveEnabled);

  // Create/destroy the native child webview on mount/unmount
  useEffect(() => {
    mountedRef.current = true;
    let wv: Webview | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function init() {
      if (!contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      const win = await getCurrentWindow();

      wv = new Webview(win, BROWSER_LABEL, {
        url: 'https://google.com',
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
      wv?.close().catch(() => {});
      webviewRef.current = null;
    };
  }, []);

  // Keep webview bounds in sync with the container div
  useEffect(() => {
    if (!contentRef.current) return;

    const syncBounds = () => {
      const wv = webviewRef.current;
      if (!wv || !contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      wv.setPosition(new PhysicalPosition(Math.round(rect.left), Math.round(rect.top))).catch(() => {});
      wv.setSize(new PhysicalSize(Math.round(rect.width), Math.round(rect.height))).catch(() => {});
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

  const navigate = useCallback((target?: string) => {
    const dest = normalizeUrl(target ?? inputUrl);
    setIsLoading(true);
    setUrl(dest);
    setInputUrl(dest);
    invoke('browser_navigate', { label: BROWSER_LABEL, url: dest }).catch(() => setIsLoading(false));
  }, [inputUrl]);

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
    <div className="relative flex flex-col h-full w-full bg-white dark:bg-neutral-900">
      {/* Nav bar — rendered ABOVE the native webview overlay */}
      <div className="h-12 flex items-center gap-1.5 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0 z-10 bg-white dark:bg-neutral-900">
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

      {/* Native webview renders over this div — keep it empty */}
      <div ref={contentRef} className="flex-1 w-full" />

      {comment && <ProactiveChip comment={comment} onDismiss={dismiss} />}
    </div>
  );
}

export default BrowserPanel;
