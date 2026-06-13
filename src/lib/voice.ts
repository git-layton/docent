// Web Speech API helpers — voice loading, default selection, text cleanup, and speaking.
//
// macOS exposes its installed system voices through `speechSynthesis`, including the
// high-quality "Enhanced"/"Premium" neural voices the user downloads in
// System Settings → Accessibility → Spoken Content → Manage Voices. The app never
// picked a voice before, so it fell back to the basic robotic default. These helpers
// let us pick a nicer voice — globally and per-agent — and read text cleanly.

export interface VoicePrefs {
  /** SpeechSynthesisVoice.voiceURI. Empty/undefined = inherit / auto-pick. */
  voiceURI?: string;
  /** 0.5–2, default 1. */
  rate?: number;
  /** 0–2, default 1. */
  pitch?: number;
}

let cache: SpeechSynthesisVoice[] = [];
let pending: Promise<SpeechSynthesisVoice[]> | null = null;

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

/**
 * All installed voices. `getVoices()` returns empty until the engine finishes loading
 * and fires `voiceschanged`, so resolve on that event (with a timeout fallback for
 * engines that populate the list without ever firing it).
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) {
    cache = now;
    return Promise.resolve(now);
  }
  if (pending) return pending;
  pending = new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cache = s.getVoices();
      s.removeEventListener('voiceschanged', finish);
      resolve(cache);
    };
    s.addEventListener('voiceschanged', finish);
    setTimeout(finish, 1500);
  });
  return pending;
}

/** Cached voices — may be empty before {@link loadVoices} resolves. */
export function getLoadedVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (s) {
    const v = s.getVoices();
    if (v.length) cache = v;
  }
  return cache;
}

// macOS ships a set of low-quality "novelty" voices (Albert, Zarvox, Bubbles…) that
// sound robotic or comedic. We score these down so auto-selection avoids them.
const NOVELTY = [
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news',
  'jester', 'organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'deranged',
  'hysterical', 'pipe organ', 'junior', 'ralph', 'fred', 'kathy', 'princess', 'grandma',
  'grandpa', 'reed', 'rocko', 'sandy', 'shelley', 'flo', 'eddy', 'grandfather',
];

function isNovelty(v: SpeechSynthesisVoice): boolean {
  const n = v.name.toLowerCase();
  return NOVELTY.some(x => n.includes(x));
}

/** Higher = better fit. Prefers the UI language and Enhanced/Premium/Neural voices. */
export function rankVoice(v: SpeechSynthesisVoice, uiLang: string): number {
  const name = v.name.toLowerCase();
  const lang = (v.lang || '').toLowerCase().replace('_', '-');
  const ui = uiLang.toLowerCase().replace('_', '-');
  let score = 0;
  if (lang === ui) score += 40;
  else if (lang.split('-')[0] === ui.split('-')[0]) score += 30;
  else if (lang.startsWith('en')) score += 10;
  if (name.includes('premium')) score += 25;
  else if (name.includes('enhanced')) score += 22;
  else if (name.includes('neural')) score += 20;
  if (isNovelty(v)) score -= 100;
  return score;
}

/** Best default voice for this machine — the nicest match for the UI language. */
export function suggestDefaultVoiceURI(voices: SpeechSynthesisVoice[] = getLoadedVoices()): string | undefined {
  if (!voices.length) return undefined;
  const ui = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  const best = [...voices].sort((a, b) => rankVoice(b, ui) - rankVoice(a, ui))[0];
  return best?.voiceURI;
}

/** Strip markdown, code, and <think> blocks so the synthesizer reads natural prose. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // markdown images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')    // markdown links → label
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')         // headings
    .replace(/[*_~`#>|]/g, '')                  // residual markdown symbols
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Merge per-agent voice prefs over the app-wide defaults, filling in sane fallbacks.
 * When neither the agent nor the app has chosen a voice, auto-pick the nicest installed
 * one — so reading aloud sounds good out of the box with zero configuration.
 */
export function resolveVoicePrefs(agent: any, appDefaults: VoicePrefs = {}): VoicePrefs {
  return {
    voiceURI: agent?.ttsVoiceURI || appDefaults.voiceURI || suggestDefaultVoiceURI(),
    rate: agent?.ttsRate ?? appDefaults.rate ?? 1,
    pitch: agent?.ttsPitch ?? appDefaults.pitch ?? 1,
  };
}

interface SpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

/** Speak `text` with the given voice prefs, cancelling anything already speaking. */
export function speak(text: string, prefs: VoicePrefs = {}, handlers: SpeakHandlers = {}): void {
  const s = synth();
  if (!s) {
    handlers.onError?.();
    return;
  }
  s.cancel();
  const clean = cleanForSpeech(text);
  if (!clean) {
    handlers.onEnd?.();
    return;
  }
  const go = () => {
    const u = new SpeechSynthesisUtterance(clean);
    if (prefs.voiceURI) {
      const v = getLoadedVoices().find(x => x.voiceURI === prefs.voiceURI);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
    }
    if (typeof prefs.rate === 'number') u.rate = prefs.rate;
    if (typeof prefs.pitch === 'number') u.pitch = prefs.pitch;
    u.onstart = () => handlers.onStart?.();
    u.onend = () => handlers.onEnd?.();
    u.onerror = () => handlers.onError?.();
    s.speak(u);
  };
  // If a specific voice is requested but the list hasn't loaded yet, wait for it —
  // otherwise the engine would fall back to the robotic default.
  if (prefs.voiceURI && !getLoadedVoices().length) {
    loadVoices().then(go);
  } else {
    go();
  }
}

export function cancelSpeech(): void {
  synth()?.cancel();
}

// Warm the voice cache as soon as this module loads so the first "Read aloud" is instant.
if (synth()) void loadVoices();
