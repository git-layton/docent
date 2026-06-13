import { useMemo, useState } from 'react';
import { Play, Square, Volume2 } from 'lucide-react';
import { rankVoice, speak, cancelSpeech } from '../../lib/voice';
import { useVoices } from '../../lib/useVoices';

interface VoicePickerProps {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
  onChange: (next: { voiceURI?: string; rate?: number; pitch?: number }) => void;
  /** Adds an "inherit" option at the top (for per-agent pickers that fall back to the app default). */
  allowInherit?: boolean;
  inheritLabel?: string;
  /** Voice used by the Test button when the current selection inherits (no explicit voiceURI). */
  fallbackVoiceURI?: string;
  /** Sample line spoken by the Test button. */
  sampleText?: string;
}

const DEFAULT_SAMPLE = "Hey — this is how I'll sound when I read things to you.";

export function VoicePicker({
  voiceURI,
  rate = 1,
  pitch = 1,
  onChange,
  allowInherit = false,
  inheritLabel = 'Use app default voice',
  fallbackVoiceURI,
  sampleText = DEFAULT_SAMPLE,
}: VoicePickerProps) {
  const voices = useVoices();
  const [testing, setTesting] = useState(false);

  // Group voices by language (UI language first), each group sorted nicest-first.
  const groups = useMemo(() => {
    const ui = (navigator.language || 'en-US').toLowerCase();
    const displayName = (code: string) => {
      try {
        return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code.split('-')[0]) || code;
      } catch {
        return code || 'Other';
      }
    };
    const byLang = new Map<string, SpeechSynthesisVoice[]>();
    for (const v of voices) {
      const key = displayName(v.lang || 'other');
      const arr = byLang.get(key) ?? [];
      arr.push(v);
      byLang.set(key, arr);
    }
    const entries = [...byLang.entries()].map(([label, list]) => ({
      label,
      voices: [...list].sort((a, b) => rankVoice(b, ui) - rankVoice(a, ui) || a.name.localeCompare(b.name)),
      best: Math.max(...list.map(v => rankVoice(v, ui))),
    }));
    // Languages closest to the UI language float to the top.
    entries.sort((a, b) => b.best - a.best || a.label.localeCompare(b.label));
    return entries;
  }, [voices]);

  const tag = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('premium')) return ' ✨';
    if (n.includes('enhanced')) return ' ★';
    return '';
  };

  const handleTest = () => {
    if (testing) {
      cancelSpeech();
      setTesting(false);
      return;
    }
    setTesting(true);
    speak(sampleText, { voiceURI: voiceURI || fallbackVoiceURI, rate, pitch }, {
      onEnd: () => setTesting(false),
      onError: () => setTesting(false),
    });
  };

  const noVoices = voices.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select
          value={voiceURI ?? ''}
          onChange={e => onChange({ voiceURI: e.target.value || undefined, rate, pitch })}
          disabled={noVoices}
          className="flex-1 bg-inset border-2 border-edge rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-accent text-ink disabled:opacity-50"
        >
          {allowInherit && <option value="">{inheritLabel}</option>}
          {!allowInherit && noVoices && <option value="">No voices available</option>}
          {!allowInherit && !noVoices && !voiceURI && <option value="">System default</option>}
          {groups.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.voices.map(v => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}{tag(v.name)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={handleTest}
          disabled={noVoices}
          className="flex items-center gap-1.5 px-4 rounded-xl border-2 border-edge text-xs font-black uppercase tracking-widest text-ink-2 hover:border-accent hover:text-accent transition-all disabled:opacity-50 shrink-0"
          title="Hear this voice"
        >
          {testing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {testing ? 'Stop' : 'Test'}
        </button>
      </div>

      <div className="flex gap-4">
        <label className="flex-1 flex items-center gap-2 text-tiny font-bold text-ink-3">
          <span className="w-10 shrink-0 uppercase tracking-widest">Speed</span>
          <input
            type="range" min={0.5} max={1.5} step={0.05} value={rate}
            onChange={e => onChange({ voiceURI, rate: parseFloat(e.target.value), pitch })}
            className="flex-1 accent-accent"
          />
          <span className="w-8 text-right tabular-nums text-ink-2">{rate.toFixed(2)}</span>
        </label>
        <label className="flex-1 flex items-center gap-2 text-tiny font-bold text-ink-3">
          <span className="w-10 shrink-0 uppercase tracking-widest">Pitch</span>
          <input
            type="range" min={0.5} max={1.5} step={0.05} value={pitch}
            onChange={e => onChange({ voiceURI, rate, pitch: parseFloat(e.target.value) })}
            className="flex-1 accent-accent"
          />
          <span className="w-8 text-right tabular-nums text-ink-2">{pitch.toFixed(2)}</span>
        </label>
      </div>

      {noVoices && (
        <p className="text-tiny text-ink-3 flex items-center gap-1.5">
          <Volume2 className="w-3.5 h-3.5 shrink-0" />
          No system voices detected yet. Download richer ones in System Settings → Accessibility → Spoken Content → Manage Voices.
        </p>
      )}
    </div>
  );
}
