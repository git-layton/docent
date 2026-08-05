// ─── Provenance ───────────────────────────────────────────────────────────────
// Step 1 of docs/concept-canvas-design.md. The rule the whole design rests on:
//
//   A model's own output can never ground a claim.
//
// This is not a policy preference, it is what the technology permits. Hallucination
// is structurally inevitable (true facts exist beyond any finite training set, and
// retrieval from weights is non-deterministic), and models cannot report their own
// reliability — internal states reflect knowledge *recall*, not truthfulness. So
// self-assessed confidence is never evidence.
//
// What models ARE reliable at is the regime where output can be checked against
// something outside the model: extraction, summarization, reorganization, drafting
// against a compiler. Docent's compiler is the user's own library. Provenance is
// how a block declares which side of that line it came from.
//
// The failure this prevents is measured, not hypothetical: a corpus that consumes
// its own output drifts from ~13% synthetic to 50% within ~17 generations and
// stabilises around 72% — and it is invisible while it happens, because fluency
// survives even as grounding drains away. The erosion has to be structurally
// impossible, because it cannot be noticed.
//
// Two structural guarantees live here, and both matter more than they look:
//
//   1. THE MODEL NEVER CHOOSES ITS OWN ORIGIN. `blockFromModelOutput` will not let
//      model output claim `read`, `authored` or `observed` no matter what it emits.
//      Grounded origins are stamped by the layer that actually held the evidence —
//      the retrieval path, the editor, the capture loop — never by the generator.
//
//   2. VERIFICATION IS MECHANICAL. `verifyQuote` is a string match. It is never a
//      model judging whether a claim is supported: a model asked to check its own
//      output agrees with itself, because generator and critic reproduce the same
//      reasoning. A quote either appears in the source or it does not.

/** Where a block came from. See docs/concept-canvas-design.md §Provenance. */
export type Origin = 'read' | 'authored' | 'observed' | 'generated' | 'contested';

/**
 * What a block is entitled to ground.
 *
 * The `observed` tier is the subtle one. The screen log is genuinely checkable —
 * there is a frame and a timestamp — so it is categorically unlike `generated`.
 * But it grounds claims about YOUR ACTIVITY, not about the world: you saw a page;
 * you did not necessarily read it, agree with it, or check it.
 */
export type GroundingScope = 'world' | 'activity' | 'none';

/**
 * Provenance is encoded in FORM, not hue — the accent is user-swappable across ten
 * themes, so a colour can never be load-bearing (a `jade` user's chrome is the same
 * green that would otherwise mean "grounded"). Tint is decoration; shape carries
 * the meaning, and it survives colourblindness for free.
 */
export type StripeForm = 'solid' | 'dashed' | 'doubled';

/**
 * A block of a concept. Each grounding variant carries the evidence that makes it
 * checkable, so the compiler will not let a caller claim grounding without it.
 * `generated` and `contested` carry no evidence because there is none to carry.
 */
export type Block =
  | { origin: 'read' | 'authored'; text: string; sourcePath: string; quote: string }
  | { origin: 'observed'; text: string; frameId: string; seenAt: number }
  | { origin: 'generated' | 'contested'; text: string };

/**
 * Minimum length for a quote to be worth verifying. A three-character quote matches
 * almost any source, which would make verification theatre rather than a check.
 */
export const MIN_QUOTE_CHARS = 24;

// ── The rule ────────────────────────────────────────────────────────────────

export function groundingScope(origin: Origin): GroundingScope {
  switch (origin) {
    case 'read':
    case 'authored':
      return 'world';
    case 'observed':
      return 'activity';
    case 'generated':
    case 'contested':
      return 'none';
  }
}

/** Does this block ground anything at all? */
export function countsAsGrounding(block: Block): boolean {
  return groundingScope(block.origin) !== 'none';
}

/**
 * May this block support a claim about the world?
 *
 * This is the predicate the grounding meter and any "is this sourced" question
 * should use. `observed` deliberately returns false: the screen log is evidence of
 * what you looked at, never of what is true.
 */
export function groundsWorldClaims(block: Block): boolean {
  return groundingScope(block.origin) === 'world';
}

/** Single source of truth for how provenance renders, so no surface can invent a hue. */
export function stripeForm(origin: Origin): StripeForm {
  switch (origin) {
    case 'read':
    case 'authored':
    case 'observed':
      return 'solid';
    case 'generated':
      return 'dashed';
    case 'contested':
      return 'doubled';
  }
}

// ── Mechanical verification ─────────────────────────────────────────────────

/**
 * Normalize for comparison: collapse all whitespace, trim, case-fold.
 *
 * Sources get reflowed, re-indented and re-wrapped constantly; a quote that fails
 * only because a line break moved is a false alarm, and false alarms train people
 * to ignore the signal. Case-folding is deliberate for the same reason — headings
 * and sentence casing shift under editing.
 */
export function normalizeForMatch(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Does `quote` actually appear in `sourceText`? A string match, never a judgement.
 *
 * Returns false for quotes shorter than MIN_QUOTE_CHARS: a short string matches by
 * coincidence, and a check that always passes is worse than no check, because it
 * launders an unverified claim into a verified-looking one.
 */
export function verifyQuote(quote: string, sourceText: string): boolean {
  const q = normalizeForMatch(quote);
  const s = normalizeForMatch(sourceText);
  if (q.length < MIN_QUOTE_CHARS) return false;
  if (!s) return false;
  return s.includes(q);
}

// ── Constructors ────────────────────────────────────────────────────────────
// The only sanctioned way to make a block. Grounded variants are constructed by
// the layer that HELD the evidence, and the read/authored constructors refuse to
// return a grounded block unless the quote actually verifies against the source.

export function generatedBlock(text: string): Block | null {
  const t = String(text ?? '').trim();
  return t ? { origin: 'generated', text: t } : null;
}

export function contestedBlock(text: string): Block | null {
  const t = String(text ?? '').trim();
  return t ? { origin: 'contested', text: t } : null;
}

export function observedBlock(text: string, frameId: string, seenAt: number): Block | null {
  const t = String(text ?? '').trim();
  const f = String(frameId ?? '').trim();
  if (!t || !f) return null;
  if (!Number.isFinite(seenAt) || seenAt <= 0) return null;
  return { origin: 'observed', text: t, frameId: f, seenAt };
}

/**
 * Build a grounded block, or fall back to `generated` when the evidence does not
 * check out.
 *
 * NEVER throws and never silently drops the text: an unverifiable claim is still
 * worth showing, it simply may not wear a grounded stripe. This encodes the
 * "render dashed and upgrade, never the reverse" rule — verification has latency,
 * and a claim shown as grounded before the check returns has already been believed.
 */
export function groundedBlock(
  origin: 'read' | 'authored',
  text: string,
  sourcePath: string,
  quote: string,
  sourceText: string,
): Block | null {
  const t = String(text ?? '').trim();
  if (!t) return null;

  const path = String(sourcePath ?? '').trim();
  const q = String(quote ?? '').trim();
  if (!path || !verifyQuote(q, sourceText)) {
    // Evidence missing or stale — the text survives, the claim to grounding does not.
    return { origin: 'generated', text: t };
  }
  return { origin, text: t, sourcePath: path, quote: q };
}

// ── The untrusted boundary ──────────────────────────────────────────────────

/**
 * Turn raw model output into a Block.
 *
 * THE LOAD-BEARING FUNCTION. Model output is parsed here and may only ever become
 * `generated` or `contested` — the two origins that ground nothing. A model that
 * emits `{"origin":"read","sourcePath":"…","quote":"…"}`, whether by drift or by
 * following injected instructions, is downgraded rather than believed. Grounded
 * origins are stamped by the layer that held the evidence; they are never claimed
 * by the layer that produced the prose.
 *
 * `contested` is permitted from a model because it is an admission of uncertainty,
 * not a claim to authority — and it grounds nothing either way.
 */
export function blockFromModelOutput(raw: unknown): Block | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;

  // The ONLY origin a model is allowed to assert is `contested`. Everything else it
  // might claim — including a fully-formed sourcePath and quote — becomes `generated`.
  return r.origin === 'contested'
    ? { origin: 'contested', text }
    : { origin: 'generated', text };
}

// ── Aggregate ───────────────────────────────────────────────────────────────

export interface GroundingSplit {
  /** Blocks grounding claims about the world — `read` + `authored`. */
  world: number;
  /** Blocks grounding claims about your activity — `observed`. */
  activity: number;
  /** Blocks grounding nothing — `generated` + `contested`. */
  ungrounded: number;
  total: number;
  /** world / total, as a percentage. The number the grounding meter shows. */
  groundedPct: number;
}

/**
 * The grounding meter's arithmetic, in one place.
 *
 * `observed` is counted separately and deliberately excluded from `groundedPct`.
 * Rolling the screen log into the grounded share would let "I looked at a page"
 * masquerade as "I have a source for this" — which is the whole distinction the
 * `observed` tier exists to preserve.
 */
export function groundingSplit(blocks: readonly Block[]): GroundingSplit {
  let world = 0, activity = 0, ungrounded = 0;
  for (const b of blocks ?? []) {
    const scope = groundingScope(b.origin);
    if (scope === 'world') world++;
    else if (scope === 'activity') activity++;
    else ungrounded++;
  }
  const total = world + activity + ungrounded;
  return {
    world,
    activity,
    ungrounded,
    total,
    groundedPct: total === 0 ? 0 : (world / total) * 100,
  };
}
