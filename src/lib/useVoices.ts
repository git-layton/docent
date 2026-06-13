import { useEffect, useState } from 'react';
import { loadVoices, getLoadedVoices } from './voice';

/** Reactively track the installed system voices (they load asynchronously). */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(getLoadedVoices());
  useEffect(() => {
    let alive = true;
    loadVoices().then(v => { if (alive) setVoices(v); });
    const onChange = () => { if (alive) setVoices(getLoadedVoices()); };
    window.speechSynthesis?.addEventListener?.('voiceschanged', onChange);
    return () => {
      alive = false;
      window.speechSynthesis?.removeEventListener?.('voiceschanged', onChange);
    };
  }, []);
  return voices;
}
