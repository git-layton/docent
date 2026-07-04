import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

/**
 * The perception glow. Lives alone in the transparent, click-through, always-on-top "glow" window.
 * Rust emits `glow:pulse` the moment a screen frame has been grabbed (camera-shutter style, AFTER
 * the capture — so the ring is never in its own screenshot); we ignite an ember-violet border
 * around the screen edge that breathes once and cools to nothing.
 *
 * This component only PAINTS. Window lifecycle (positioning, show, failsafe hide) is owned by
 * `pulse_glow` in screenshot.rs — a stalled or dead webview here can never strand the overlay.
 *
 * Colors are the theme-INVARIANT `--af-glow-*` tokens (index.css): a "your screen is being read"
 * indicator must be recognizable in every theme, like the OS's fixed-color recording dots.
 *
 * Honors prefers-reduced-motion: a static ring that fades, no breathing (WCAG 2.3.3 / vestibular).
 */
export default function GlowOverlay() {
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen('glow:pulse', () => setPulse(p => p + 1))
      .then(f => { if (cancelled) f(); else unlisten = f; })
      .catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  return (
    <>
      <style>{`
        html, body, #root { background: transparent !important; margin: 0; height: 100%; overflow: hidden; }
        /* The ring + bloom + ember shadows are painted ONCE at full intensity; only opacity
           animates, so the whole pulse composites on the GPU — no per-frame fullscreen repaints
           while the app is busy with OCR and the model call. */
        .af-glow {
          position: fixed; inset: 0; pointer-events: none; border-radius: 11px;
          box-shadow: inset 0 0 0 3px var(--af-glow-ring),
                      inset 0 0 52px 7px var(--af-glow-bloom),
                      inset 0 0 150px var(--af-glow-ember);
          opacity: 0;
          animation: afGlowIgnite 3.6s cubic-bezier(.4, 0, .2, 1) forwards;
        }
        /* Ignite fast, breathe once, cool to nothing. */
        @keyframes afGlowIgnite {
          0% { opacity: 0; } 9% { opacity: 1; } 46% { opacity: .63; } 72% { opacity: .86; } 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .af-glow { animation: afGlowFade 3.6s linear forwards; }
          @keyframes afGlowFade { 0%, 82% { opacity: .58; } 100% { opacity: 0; } }
        }
      `}</style>
      {pulse > 0 && <div key={pulse} className="af-glow" />}
    </>
  );
}
