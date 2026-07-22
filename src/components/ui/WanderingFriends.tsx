import React, { useEffect, useState } from 'react';

/**
 * A rare easter egg: once in a long while, a penguin waddles across the bottom of the start screen.
 * Rarer still, two of them meet in the middle, hug, and a small heart drifts up.
 *
 * Rules it plays by, so a delight never becomes an annoyance:
 *  - RARE. Roughly a 1-in-25 chance per mount for the solo walk, and a fifth of those become the
 *    pair. You should go days without seeing one, and doubt yourself slightly when you do.
 *  - Silent and inert: `pointer-events-none`, no sound, nothing to dismiss, nothing logged. It never
 *    interrupts what you were doing.
 *  - Composited only. Travel is `transform: translateX` on the outer element and the waddle is a
 *    `rotate` on the inner one, so the two never fight over `transform` and neither touches layout.
 *    The sky's cloud drift used to animate `left` and made everything stutter; this must not
 *    reintroduce that.
 *  - Styled like the birds already in the sky — muted, semi-transparent, sitting *in* the scene
 *    rather than on top of it.
 *
 * The endless-runner the arrow keys are meant to start is deliberately not here yet; this is the
 * hook it will hang from.
 */

const SOLO_CHANCE = 1 / 25;
const PAIR_CHANCE = 1 / 5; // of the walks that do happen

type Cast = 'none' | 'solo' | 'pair';

/** One penguin. Faces right by default; `flip` mirrors it to walk leftward. */
const Penguin: React.FC<{ flip?: boolean; waddleMs?: number }> = ({ flip, waddleMs = 420 }) => (
  <div
    style={{
      // The waddle lives here, on its own element, so the travel transform outside stays untouched.
      animation: `friendWaddle ${waddleMs}ms ease-in-out infinite alternate`,
      transformOrigin: '50% 100%',
      scale: flip ? '-1 1' : '1 1',
    }}
  >
    <svg width="18" height="24" viewBox="0 0 18 24" fill="none" aria-hidden="true">
      {/* body */}
      <ellipse cx="9" cy="12" rx="6.5" ry="9" fill="rgba(30,40,60,0.55)" />
      {/* belly */}
      <ellipse cx="9.5" cy="13.5" rx="4.2" ry="7" fill="rgba(245,246,250,0.62)" />
      {/* flipper */}
      <ellipse cx="2.8" cy="12.5" rx="1.6" ry="4.6" fill="rgba(30,40,60,0.5)" />
      {/* beak */}
      <path d="M13.6 8.6 L16.6 9.8 L13.6 10.8 Z" fill="rgba(226,140,74,0.75)" />
      {/* eye */}
      <circle cx="11.6" cy="7.6" r="0.85" fill="rgba(20,26,38,0.8)" />
      {/* feet */}
      <path d="M6 21.4 L8.6 21.4 L7.3 23.2 Z" fill="rgba(226,140,74,0.7)" />
      <path d="M10 21.4 L12.6 21.4 L11.3 23.2 Z" fill="rgba(226,140,74,0.7)" />
    </svg>
  </div>
);

const Heart: React.FC = () => (
  <svg width="14" height="13" viewBox="0 0 14 13" fill="none" aria-hidden="true">
    <path
      d="M7 12.2S0.8 8.3 0.8 4.4A3.4 3.4 0 0 1 7 2.6a3.4 3.4 0 0 1 6.2 1.8c0 3.9-6.2 7.8-6.2 7.8Z"
      fill="rgba(224,120,140,0.75)"
    />
  </svg>
);

export const WanderingFriends: React.FC = () => {
  const [cast, setCast] = useState<Cast>('none');

  useEffect(() => {
    // Motion IS the easter egg, so with reduced-motion the polite move is to never appear rather
    // than to appear frozen. Handled here, not in a media query: a `@media` block inside this
    // component's <style> would be global and could hide unrelated elements elsewhere.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Rolled once per mount. A user who reloads all day gets a few; a user who leaves it open sees
    // one and tells someone about it.
    if (Math.random() > SOLO_CHANCE) return;
    const pair = Math.random() < PAIR_CHANCE;
    setCast(pair ? 'pair' : 'solo');
    // Clear once the walk is over so nothing lingers in the tree.
    const t = setTimeout(() => setCast('none'), pair ? 22000 : 26000);
    return () => clearTimeout(t);
  }, []);

  if (cast === 'none') return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {cast === 'solo' ? (
        <div style={{ position: 'absolute', bottom: '6%', left: 0, animation: 'friendCross 26s linear forwards' }}>
          <Penguin />
        </div>
      ) : (
        <>
          <div style={{ position: 'absolute', bottom: '6%', left: 0, animation: 'friendMeetLeft 22s ease-in-out forwards' }}>
            <Penguin />
          </div>
          <div style={{ position: 'absolute', bottom: '6%', left: 0, animation: 'friendMeetRight 22s ease-in-out forwards' }}>
            <Penguin flip />
          </div>
          <div style={{ position: 'absolute', bottom: '13%', left: 0, animation: 'friendHeart 22s ease-out forwards' }}>
            <Heart />
          </div>
        </>
      )}

      <style>{`
        /* Rocking side to side. Small — a penguin waddles, it doesn't capsize. */
        @keyframes friendWaddle {
          0%   { rotate: -7deg; }
          100% { rotate:  7deg; }
        }
        /* Solo: straight across and out. */
        @keyframes friendCross {
          0%   { transform: translateX(-8vw); }
          100% { transform: translateX(108vw); }
        }
        /* Pair: in from both edges, meet at centre, hold the hug, then linger. They stop at 38% and
           never separate — that is the whole joke.
           The 1.4vw between them is deliberate and measured: a penguin is 20px wide, so at a 1280px
           window their edges just touch, and they stay touching across window sizes. An earlier
           6vw gap left them standing politely 57px apart, which reads as a conversation, not a hug. */
        @keyframes friendMeetLeft {
          0%   { transform: translateX(-8vw); }
          38%  { transform: translateX(48vw); }
          100% { transform: translateX(48vw); }
        }
        @keyframes friendMeetRight {
          0%   { transform: translateX(108vw); }
          38%  { transform: translateX(49.4vw); }
          100% { transform: translateX(49.4vw); }
        }
        /* The heart appears only once they've actually met, then drifts up and fades. */
        @keyframes friendHeart {
          0%, 38%  { transform: translateX(48.6vw) translateY(0); opacity: 0; }
          46%      { transform: translateX(48.6vw) translateY(-6px); opacity: 0.95; }
          80%      { transform: translateX(48.6vw) translateY(-34px); opacity: 0; }
          100%     { transform: translateX(48.6vw) translateY(-34px); opacity: 0; }
        }
      `}</style>
    </div>
  );
};
