/**
 * Generate a short, collision-resistant id.
 *
 * Format (with a prefix): `${prefix}-${Date.now()}-${random}` where `random`
 * is `Math.random().toString(36).slice(2, 9)` — a 7-char base-36 suffix.
 * This is byte-identical to the local `generateId` helpers that previously
 * lived in App.tsx and the Zustand stores, so existing id shapes are preserved.
 *
 * If `prefix` is omitted, the leading `${prefix}-` segment is dropped so we
 * don't emit a stray leading dash.
 */
export function generateId(prefix?: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return prefix === undefined
    ? `${Date.now()}-${rand}`
    : `${prefix}-${Date.now()}-${rand}`;
}
