import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Cloud } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';

export function LockedSetupScreen() {
  const [pct, setPct] = useState<number>(0);
  const [downloadedMb, setDownloadedMb] = useState<number>(0);
  const [totalMb, setTotalMb] = useState<number>(0);
  const [status, setStatus] = useState<string>('Initializing download...');

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    // Fallback if the event doesn't fire immediately
    const timeout = setTimeout(() => {
      if (pct === 0) setStatus('Downloading local AI model...');
    }, 2000);

    listen('download-progress', (event: any) => {
      const payload = event.payload;
      setPct(payload.pct);
      setDownloadedMb(payload.downloaded_mb);
      setTotalMb(payload.total_mb);
      setStatus('Downloading local AI model...');
      
      if (payload.pct >= 100) {
        setStatus('Installing model...');
      }
    }).then(u => { unlisten = u; });

    // Poll for the model to appear in the downloaded list
    // because when download finishes, we need to add it to the settings store.
    // Wait, the ModelStorePanel does the actual 'download_model' invoke and adds it to the store.
    // If ModelStorePanel was unmounted (because Onboarding closed), the invoke Promise in ModelStorePanel was orphaned!
    // The backend still downloads it, but NO ONE will add it to the store when it finishes!
    // So we need to poll `list_gguf_models` to see if a model was downloaded, and if so, auto-add it.
    const interval = setInterval(async () => {
      try {
        const downloaded = await invoke<{ filename: string; size_mb: number }[]>('list_gguf_models');
        if (downloaded.length > 0) {
          // Find the first downloaded model and auto-add it if we have 0 models
          const ss = useSettingsStore.getState();
          if (ss.models.length === 0) {
            const first = downloaded[0];
            const newModel = {
              id: `m-${Date.now()}`,
              name: first.filename.replace('.gguf', ''),
              provider: 'native',
              modelId: first.filename,
              endpoint: 'local',
              apiKey: '',
              contextLimit: 8192,
              canImage: false,
              isLocal: true,
            };
            ss.setModels([newModel]);
            ss.setSelectedModelId(newModel.id);
            ss.persist();
          }
        }
      } catch (e) {}
    }, 3000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <div className="absolute inset-0 z-[50] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-md p-8 rounded-[2rem] bg-panel-2 border border-edge shadow-2xl flex flex-col items-center text-center gap-6 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mb-2">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
        
        <div className="space-y-2">
          <h2 className="text-2xl font-black tracking-tight text-ink">Getting things set up...</h2>
          <p className="text-sm text-ink-2 max-w-xs mx-auto leading-relaxed">
            Your local AI model is downloading in the background. The app will unlock automatically when it's ready.
          </p>
        </div>

        {totalMb > 0 ? (
          <div className="w-full space-y-2">
            <div className="flex justify-between text-xs font-bold text-ink-3">
              <span>{status}</span>
              <span>{Math.round(pct)}%</span>
            </div>
            <div className="w-full h-2 bg-inset rounded-full overflow-hidden">
              <div 
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-mini text-ink-3">
              {downloadedMb.toFixed(1)} GB / {totalMb.toFixed(1)} GB
            </p>
          </div>
        ) : (
          <div className="text-sm font-bold text-ink-3 animate-pulse">
            {status}
          </div>
        )}

        <div className="w-full h-px bg-edge my-2" />

        <div className="w-full space-y-3">
          <p className="text-xs text-ink-2">Don't want to wait? You can connect a cloud model (like OpenAI or Gemini) to start immediately.</p>
          <div className="flex gap-2">
            <button 
              onClick={() => useSettingsStore.getState().setShowModelWizard(true)}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-xl border-2 border-edge text-sm font-black text-ink-2 hover:border-accent hover:text-accent transition-all"
            >
              <Cloud className="w-4 h-4" />
              Cloud Model
            </button>
            <button 
              onClick={() => {
                useSettingsStore.getState().setShowOnboarding(true);
                useSettingsStore.getState().setOnboardingInitialStep(1);
              }}
              className="flex-1 py-3 px-3 rounded-xl bg-wash text-sm font-black text-ink hover:bg-inset transition-all"
            >
              Retry Setup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
