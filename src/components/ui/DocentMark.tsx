/**
 * The Docent mark — round wire spectacles, traced from the app icon
 * (`public/app-icon.png`, also `src-tauri/icons/icon.png`).
 *
 * Drawn as an inline SVG rather than rendering the PNG: the mark appears at 12–20px in avatar
 * chips, where the PNG's own dark rounded-square backplate would fight whatever surface it sits
 * on. As a stroked path it inherits `currentColor`, so it works on light and dark and inside a
 * filled avatar container without a second background.
 *
 * Geometry is MEASURED off the source art, not eyeballed — scanning the 1024px PNG's centre line
 * gives four stroke runs (the two lenses' edges):
 *
 *     lens radius (centreline) 125px  → r 2.93     centre separation 347px → 8.13
 *     stroke                    18px  → 0.42       visible gap        79px → 1.85
 *     bridge peak above centre  47.5px → 1.11
 *
 * The stroke is the one deliberate departure. True-to-art 0.42 disappears below ~40px, and this
 * renders at 12/14/16/20/64px (16px — the chat avatar — is the common case). 0.9 is the heaviest
 * value that still leaves daylight in the 1.85-unit gap at 16px: the stroke straddles the path, so
 * visible gap = 1.85 − strokeWidth, and past ~1.1 the lenses merge into an "∞".
 *
 * If you change any number here, re-render the size ladder against the source PNG rather than
 * judging it at one large size — every wrong version of this looked fine at 96px.
 */
export function DocentMark({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.93" cy="12" r="2.93" />
      <circle cx="16.07" cy="12" r="2.93" />
      <path d="M10.9 11.15 Q12 10.55 13.1 11.15" />
    </svg>
  );
}
