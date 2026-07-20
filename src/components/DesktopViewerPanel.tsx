import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { Monitor, AlertTriangle, Settings, X, ChevronLeft, ChevronRight, LayoutTemplate, Eye, RotateCw } from 'lucide-react';
import { captureDesktopContextMesh, executeSemanticClick } from '../services/desktopVision';
import { useUIStore } from '../store/useUIStore';

interface WindowInfo {
  id: number;
  app: string;
  title: string;
}

export function DesktopViewerPanel() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [accessibilityAuthorized, setAccessibilityAuthorized] = useState<boolean | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [showWindowSelector, setShowWindowSelector] = useState(false);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);
  const [showMesh, setShowMesh] = useState(false);
  const [meshText, setMeshText] = useState('');
  const [semanticInput, setSemanticInput] = useState('');
  const [clicking, setClicking] = useState(false);
  const selectedWindowIdRef = useRef<number | null>(null);

  useEffect(() => {
    selectedWindowIdRef.current = selectedWindowId;
  }, [selectedWindowId]);

  useEffect(() => {
    let active = true;
    let timer: any;

    const init = async () => {
      const auth = await invoke<boolean>('screen_capture_authorized').catch(() => true);
      const accAuth = await invoke<boolean>('accessibility_authorized').catch(() => true);
      if (!active) return;
      setAuthorized(auth);
      setAccessibilityAuthorized(accAuth);

      if (auth) {
        // Fetch window list
        try {
          const list = await invoke<WindowInfo[]>('list_windows');
          if (active && list && list.length > 0) {
            setWindows(list);
            setSelectedWindowId(list[0].id);
          }
        } catch (err) {
          console.error("Failed to list windows", err);
        }

        let isFetching = false;
        
        const fetchFrame = async () => {
          if (isFetching || !active) return;
          isFetching = true;
          try {
            const currentId = selectedWindowIdRef.current;
            if (currentId !== null) {
              const dataUrl = await invoke<string>('capture_window', { windowId: currentId });
              if (active) setFrameSrc(dataUrl);
            }
          } catch (err) {
            // Silently ignore capture errors to keep polling alive
          } finally {
            isFetching = false;
          }
        };

        // Initial fetch
        await fetchFrame();
        // Poll every 500ms, but skip the cycle if the previous fetch is still running
        timer = setInterval(fetchFrame, 500);
      }
    };

    void init();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  const selectedWindow = windows.find(w => w.id === selectedWindowId) || windows[0];

  if (authorized === false || accessibilityAuthorized === false) {
    const isScreen = authorized === false;
    const isAcc = accessibilityAuthorized === false;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-panel">
        <div className="w-16 h-16 rounded-2xl bg-danger/10 text-danger flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-ink mb-2">Permissions Required</h2>
        <p className="text-sm text-ink-2 max-w-md mx-auto leading-relaxed mb-6">
          To view and control your desktop, Docent needs permissions.
          Please open <strong>System Settings &gt; Privacy &amp; Security</strong>,
          enable {isScreen ? 'Screen Recording' : ''}{isScreen && isAcc ? ' and ' : ''}{isAcc ? 'Accessibility' : ''} for Docent, and then restart the app.
        </p>
        <button
          onClick={() => {
            if (isScreen) open('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture').catch(() => {});
            if (isAcc) open('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility').catch(() => {});
          }}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-on-accent font-bold rounded-xl shadow-sm hover:opacity-90 active:scale-95 transition-all"
        >
          <Settings className="w-4 h-4" />
          Open System Settings
        </button>
      </div>
    );
  }

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!accessibilityAuthorized) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const img = e.currentTarget;
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    
    const imgRatio = naturalW / naturalH;
    const boxRatio = rect.width / rect.height;
    
    let renderW, renderH, offsetX, offsetY;
    if (imgRatio > boxRatio) {
      renderW = rect.width;
      renderH = rect.width / imgRatio;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    } else {
      renderW = rect.height * imgRatio;
      renderH = rect.height;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    }
    
    if (x >= offsetX && x <= offsetX + renderW && y >= offsetY && y <= offsetY + renderH) {
      const mappedX = ((x - offsetX) / renderW) * naturalW;
      const mappedY = ((y - offsetY) / renderH) * naturalH;
      
      try {
        await invoke('inject_click', { x: mappedX, y: mappedY });
      } catch (err) {
        console.error("Failed to inject click:", err);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-panel overflow-hidden relative">
      {/* Header */}
      <div className="h-12 shrink-0 border-b border-edge bg-panel flex items-center px-4 z-10">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-ink">Desktop Viewer</h2>
          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-accent/10 text-accent">
            Live
          </span>
        </div>
      </div>

      {/* Viewport */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden group">
        {frameSrc ? (
          <img
            src={frameSrc}
            alt="Live Desktop Feed"
            className="max-w-full max-h-full object-contain cursor-pointer transition-opacity duration-300"
            style={{ opacity: showWindowSelector ? 0.3 : 1 }}
            onClick={(e) => {
              if (showWindowSelector) {
                setShowWindowSelector(false);
              } else {
                handleImageClick(e);
              }
            }}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-ink-3">
            <Monitor className="w-8 h-8 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-widest">Connecting...</span>
          </div>
        )}

        {/* Floating Window Selector (Mock UI) */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center z-20 pointer-events-none">
          
          {/* Expanded Selector Popup */}
          {showWindowSelector && (
            <div className="pointer-events-auto mb-4 w-[400px] max-h-[400px] flex flex-col bg-panel border border-edge-2 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
              <div className="px-4 py-3 shrink-0 border-b border-edge flex items-center justify-between">
                <span className="text-xs font-bold tracking-widest uppercase text-ink-3">Open Windows</span>
                <button onClick={() => setShowWindowSelector(false)} className="text-ink-3 hover:text-ink">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto p-2 space-y-1">
                {windows.map((win) => (
                  <button
                    key={win.id}
                    onClick={() => { setSelectedWindowId(win.id); setShowWindowSelector(false); }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors ${selectedWindowId === win.id ? 'bg-accent/20 border border-accent/30' : 'hover:bg-wash border border-transparent'}`}
                  >
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-surface flex items-center justify-center border border-edge shadow-sm">
                      <LayoutTemplate className="w-4 h-4 text-ink-2" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-ink truncate">{win.app}</div>
                      <div className="text-xs text-ink-3 truncate">{win.title}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Persistent Pill Bar */}
          <div className="pointer-events-auto flex items-center p-1.5 bg-black/80 border border-white/10 rounded-full shadow-2xl transition-all hover:bg-black/80">
            <button 
              onClick={() => {
                if (windows.length === 0) return;
                const idx = windows.findIndex(w => w.id === selectedWindowId);
                const prev = windows[idx > 0 ? idx - 1 : windows.length - 1];
                setSelectedWindowId(prev.id);
              }}
              className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <button 
              onClick={() => setShowWindowSelector(!showWindowSelector)}
              className="px-4 py-1.5 flex flex-col items-center min-w-[160px] hover:bg-white/5 rounded-full transition-colors"
            >
              <span className="text-xs font-bold text-white truncate max-w-[140px]">
                {selectedWindow?.app}
              </span>
              <span className="text-[10px] text-white/50 truncate max-w-[140px]">
                {selectedWindow?.title}
              </span>
            </button>

            <button 
              onClick={() => {
                if (windows.length === 0) return;
                const idx = windows.findIndex(w => w.id === selectedWindowId);
                const next = windows[idx < windows.length - 1 ? idx + 1 : 0];
                setSelectedWindowId(next.id);
              }}
              className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* System Mesh Overlay Drawer Button */}
        <div className="absolute top-4 right-4 z-20 flex gap-2">
          <button
            onClick={async () => {
              const meshData = await captureDesktopContextMesh();
              setShowMesh(prev => !prev);
              setMeshText(meshData.markdownMesh);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/80 border border-white/10 text-white text-xs font-bold shadow-xl hover:bg-black transition-all"
          >
            <Eye className="w-3.5 h-3.5 text-accent" />
            {showMesh ? 'Hide Context Mesh' : 'System Context Mesh'}
          </button>
        </div>

        {/* System Context Mesh Drawer */}
        {showMesh && (
          <div className="absolute top-14 right-4 z-30 w-96 max-h-[500px] bg-panel-2 border border-edge rounded-2xl shadow-2xl overflow-hidden flex flex-col p-3 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between border-b border-edge pb-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-ink">Spatial Perception Mesh</span>
              <button onClick={() => setShowMesh(false)} className="text-ink-3 hover:text-ink"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-[10px] text-ink-2 bg-inset p-2.5 rounded-xl whitespace-pre-wrap leading-relaxed">
              {meshText || 'Capturing mesh…'}
            </div>
            {/* Quick Semantic Target Click Bar */}
            <form
              onSubmit={async e => {
                e.preventDefault();
                if (!semanticInput.trim()) return;
                setClicking(true);
                const res = await executeSemanticClick(semanticInput.trim());
                useUIStore.getState().showToast(res.message);
                setClicking(false);
                setSemanticInput('');
              }}
              className="mt-2.5 flex items-center gap-1.5"
            >
              <input
                type="text"
                value={semanticInput}
                onChange={e => setSemanticInput(e.target.value)}
                placeholder="Target label (e.g. Save, Code)…"
                className="flex-1 bg-inset border border-edge rounded-lg px-2.5 py-1 text-xs outline-none text-ink"
              />
              <button
                type="submit"
                disabled={clicking || !semanticInput.trim()}
                className="px-3 py-1 rounded-lg bg-accent text-on-accent text-xs font-bold disabled:opacity-40 transition-all shrink-0"
              >
                {clicking ? <RotateCw className="w-3 h-3 animate-spin" /> : 'Click'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
