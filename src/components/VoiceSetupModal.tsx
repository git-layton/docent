import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Volume2, X, Play, Square, Sparkles, Check, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  loadVoices,
  getLoadedVoices,
  rankVoice,
  suggestDefaultVoiceURI,
  speak,
  cancelSpeech,
} from '../lib/voice';

const SAMPLE = "Hey — this is how I'll sound when I read things to you.";

function qualityTag(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('premium')) return 'Premium';
  if (n.includes('enhanced')) return 'Enhanced';
  return null;
}

export function VoiceSetupModal({ onClose }: { onClose: () => void }) {
  const appSettings = useSettingsStore(s => s.appSettings);
  const { setAppSettings } = useSettingsStore.getState();

  // Self-contained voice list so the "Refresh" button can re-scan after a download.
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(getLoadedVoices());
  useEffect(() => {
    let alive = true;
    loadVoices().then(v => { if (alive) setVoices(v); });
    const onChange = () => { if (alive) setVoices(window.speechSynthesis?.getVoices?.() ?? []); };
    window.speechSynthesis?.addEventListener?.('voiceschanged', onChange);
    return () => {
      alive = false;
      window.speechSynthesis?.removeEventListener?.('voiceschanged', onChange);
    };
  }, []);

  const [playingURI, setPlayingURI] = useState<string | null>(null);
  const [openedSettings, setOpenedSettings] = useState(false);

  const selectedURI = appSettings.ttsVoiceURI;
  const rate = appSettings.ttsRate ?? 1;

  const ui = (navigator.language || 'en-US').toLowerCase();
  const sorted = useMemo(
    () => [...voices].sort((a, b) => rankVoice(b, ui) - rankVoice(a, ui) || a.name.localeCompare(b.name)),
    [voices, ui],
  );
  const recommendedURI = useMemo(() => suggestDefaultVoiceURI(voices), [voices]);
  const effectiveURI = selectedURI || recommendedURI;

  const langName = (code: string) => {
    try {
      return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code.split('-')[0]) || code;
    } catch {
      return code;
    }
  };

  const preview = (voiceURI?: string) => {
    if (playingURI === (voiceURI ?? 'sel')) {
      cancelSpeech();
      setPlayingURI(null);
      return;
    }
    setPlayingURI(voiceURI ?? 'sel');
    speak(SAMPLE, { voiceURI: voiceURI || effectiveURI, rate }, {
      onEnd: () => setPlayingURI(null),
      onError: () => setPlayingURI(null),
    });
  };

  const choose = (voiceURI: string) => {
    setAppSettings((prev: any) => ({ ...prev, ttsVoiceURI: voiceURI }));
  };

  const openVoiceSettings = async () => {
    setOpenedSettings(true);
    await invoke('open_spoken_content_settings').catch(() => {});
  };

  const refresh = () => setVoices(window.speechSynthesis?.getVoices?.() ?? []);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-panel-2 w-full max-w-lg rounded-[2rem] p-7 shadow-2xl border border-edge max-h-[88vh] overflow-y-auto custom-scrollbar text-ink flex flex-col">
        <div className="flex justify-between items-center mb-5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent rounded-xl"><Volume2 className="w-5 h-5 text-on-accent" /></div>
            <h3 className="text-lg font-black tracking-tighter uppercase">Set Up Voice</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-wash rounded-full"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm text-ink-2 font-medium mb-5">Pick the voice used when reading messages aloud. Tap <span className="font-bold">Play</span> to hear any voice.</p>

        {/* Recommended pick */}
        {recommendedURI && (
          <div className="mb-5 p-4 rounded-2xl border-2 border-accent/40 bg-accent-soft/30">
            <div className="flex items-center gap-1.5 mb-2 text-accent">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-tiny font-black uppercase tracking-widest">Recommended</span>
            </div>
            {(() => {
              const v = voices.find(x => x.voiceURI === recommendedURI);
              if (!v) return null;
              const isSel = effectiveURI === recommendedURI;
              return (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-black truncate">{v.name}</div>
                    <div className="text-tiny text-ink-3">{langName(v.lang)}{qualityTag(v.name) ? ` · ${qualityTag(v.name)}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => preview(recommendedURI)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-edge text-tiny font-black uppercase tracking-widest text-ink-2 hover:border-accent hover:text-accent transition-all">
                      {playingURI === recommendedURI ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {playingURI === recommendedURI ? 'Stop' : 'Play'}
                    </button>
                    <button onClick={() => choose(recommendedURI)} disabled={isSel} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-on-accent text-tiny font-black uppercase tracking-widest hover:bg-accent-strong transition-all disabled:opacity-60">
                      {isSel ? <><Check className="w-3.5 h-3.5" /> Using</> : 'Use this'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* All voices */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-tiny font-black uppercase tracking-widest text-ink-3">All voices ({voices.length})</span>
          <button onClick={refresh} className="flex items-center gap-1 text-tiny font-bold text-ink-3 hover:text-accent transition-all" title="Re-scan installed voices">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        <div className="space-y-1.5 max-h-[34vh] overflow-y-auto custom-scrollbar pr-1 mb-5">
          {sorted.length === 0 && (
            <p className="text-tiny text-ink-3 text-center py-6">No system voices detected. Use “Get more natural voices” below to add one.</p>
          )}
          {sorted.map(v => {
            const isSel = effectiveURI === v.voiceURI;
            const tag = qualityTag(v.name);
            return (
              <div key={v.voiceURI} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition-all ${isSel ? 'border-accent bg-accent-soft/30' : 'border-edge bg-inset hover:border-edge-2'}`}>
                <button onClick={() => choose(v.voiceURI)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                  <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${isSel ? 'border-accent bg-accent' : 'border-edge-2'}`}>
                    {isSel && <Check className="w-2.5 h-2.5 text-on-accent" />}
                  </span>
                  <span className="min-w-0">
                    <span className="text-xs font-bold text-ink truncate block">{v.name}{tag ? <span className="ml-1.5 text-micro font-black uppercase text-accent">{tag}</span> : ''}</span>
                    <span className="text-micro text-ink-3">{langName(v.lang)}</span>
                  </span>
                </button>
                <button onClick={() => preview(v.voiceURI)} className="p-2 rounded-lg text-ink-3 hover:text-accent hover:bg-wash transition-all shrink-0" title="Play sample">
                  {playingURI === v.voiceURI ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
              </div>
            );
          })}
        </div>

        {/* Speed */}
        <div className="mb-5">
          <label className="flex items-center gap-3 text-tiny font-bold text-ink-3">
            <span className="w-12 shrink-0 uppercase tracking-widest">Speed</span>
            <input
              type="range" min={0.5} max={1.5} step={0.05} value={rate}
              onChange={e => setAppSettings((prev: any) => ({ ...prev, ttsRate: parseFloat(e.target.value) }))}
              className="flex-1 accent-accent"
            />
            <span className="w-8 text-right tabular-nums text-ink-2">{rate.toFixed(2)}</span>
          </label>
        </div>

        {/* Get more natural voices */}
        <div className="p-4 rounded-2xl border border-edge bg-inset mb-5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span className="text-tiny font-black uppercase tracking-widest">Want more lifelike voices?</span>
          </div>
          <p className="text-tiny text-ink-3 mb-3 leading-relaxed">
            macOS has free, far more natural voices (like <span className="font-bold">Ava</span>, <span className="font-bold">Zoe</span>, or <span className="font-bold">Evan</span>). Download one, then come back and tap <span className="font-bold">Refresh</span>.
          </p>
          <ol className="text-tiny text-ink-2 space-y-1 mb-3 list-decimal list-inside marker:text-ink-3">
            <li>Open Voice Settings below</li>
            <li>Click <span className="font-bold">System Voice → Manage Voices</span></li>
            <li>Pick an <span className="font-bold">English</span> voice marked <span className="font-bold">Premium</span> or <span className="font-bold">Enhanced</span> and download it</li>
          </ol>
          <div className="flex items-center gap-2">
            <button onClick={openVoiceSettings} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-panel border-2 border-edge text-xs font-black uppercase tracking-widest text-ink-2 hover:border-accent hover:text-accent transition-all">
              <ArrowUpRight className="w-3.5 h-3.5" /> Open Voice Settings
            </button>
            {openedSettings && (
              <button onClick={refresh} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent text-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong transition-all">
                <RefreshCw className="w-3.5 h-3.5" /> I downloaded one — Refresh
              </button>
            )}
          </div>
        </div>

        <button onClick={onClose} className="w-full py-3.5 bg-accent text-on-accent font-black text-xs uppercase tracking-[0.2em] rounded-2xl shadow-xl active:scale-[0.98] hover:bg-accent-strong transition-all">Done</button>
      </div>
    </div>
  );
}
