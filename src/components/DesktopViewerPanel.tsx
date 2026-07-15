import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { Monitor, AlertTriangle, Settings } from 'lucide-react';

export function DesktopViewerPanel() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [accessibilityAuthorized, setAccessibilityAuthorized] = useState<boolean | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);

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
        const fetchFrame = async () => {
          try {
            const dataUrl = await invoke<string>('capture_screen');
            if (active) setFrameSrc(dataUrl);
          } catch (err) {
            // Silently ignore capture errors to keep polling alive
          }
        };

        // Initial fetch
        await fetchFrame();
        // Poll at 2 FPS (500ms) to maintain a live feed without overloading screencapture
        timer = setInterval(fetchFrame, 500);
      }
    };

    void init();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

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
          To view and control your desktop, Agent Forge needs permissions.
          Please open <strong>System Settings &gt; Privacy &amp; Security</strong>,
          enable {isScreen ? 'Screen Recording' : ''}{isScreen && isAcc ? ' and ' : ''}{isAcc ? 'Accessibility' : ''} for Agent Forge, and then restart the app.
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
      <div className="h-12 shrink-0 border-b border-edge bg-panel/50 backdrop-blur-xl flex items-center px-4 z-10">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-bold text-ink">Desktop Viewer</h2>
          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-accent/10 text-accent">
            Live
          </span>
        </div>
      </div>

      {/* Viewport */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {frameSrc ? (
          <img
            src={frameSrc}
            alt="Live Desktop Feed"
            className="max-w-full max-h-full object-contain cursor-pointer"
            onClick={handleImageClick}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-ink-3">
            <Monitor className="w-8 h-8 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-widest">Connecting...</span>
          </div>
        )}
      </div>
    </div>
  );
}
