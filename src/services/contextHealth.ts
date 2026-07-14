// ─── Context Health ───────────────────────────────────────────────────────────
// Reframes the context window from a fuel gauge ("how full — red when near 100%")
// into a health assessment ("is the window being managed well").
//
// Premise: conversations in Agent Forge never end (no new chats), so a full
// window is the NORMAL steady state, not a failure. The runtime already
// self-manages it: oldest unpinned messages rotate out, the MEMS evaluator
// saves what matters to persistent memory, pins keep verbatim content, and the
// Dream Cycle consolidates memory in the background. Health is about whether
// that loop is working — not about fill percentage.
//
// What actually degrades a long-running window (and what we flag):
//   - Pins never rotate out, so heavy pinning permanently shrinks the live window.
//   - Instructions + attached docs are re-sent every turn; past a point they
//     crowd out the conversation itself.
//   - Rotation without a working memory pipeline means messages are genuinely
//     lost, not archived.
//   - Once a lot of the conversation lives in memory rather than the window,
//     recall quality depends on consolidation — an overdue Dream Cycle is a
//     health signal, not just a nicety.

export type ContextHealthStatus = 'healthy' | 'optimized' | 'attention';

export type ContextHealthRecId =
  | 'unpin'
  | 'trim-docs'
  | 'trim-instructions'
  | 'enable-memory'
  | 'dream';

export interface ContextHealthRecommendation {
  id: ContextHealthRecId;
  text: string;
}

export interface ContextHealthInput {
  /** Total chars currently in the live window (messages + system scaffolding). */
  usedChars: number;
  /** Model context limit, in chars (same approximation the rest of the app uses). */
  limitChars: number;
  /** Agent instructions + profile + tasks — re-sent every turn. */
  systemChars: number;
  /** Pinned messages — never rotate out. */
  pinsChars: number;
  /** Attached training docs — re-sent every turn. */
  docsChars: number;
  /** Live browser page context, if any. */
  browserChars: number;
  /** True when messages have already fallen out of the window (forgettingIndex > 0). */
  rotating: boolean;
  /** True when the MEMS evaluator can run (model + memory path available). */
  memoryPipelineActive: boolean;
  /** Epoch ms of the last completed Dream Cycle, or null if never run. */
  lastDreamAt?: number | null;
  /** Injectable clock for tests. */
  now?: number;
}

export interface ContextHealth {
  status: ContextHealthStatus;
  /** Short chip label: "Healthy" / "Optimized" / "Needs tuning". */
  headline: string;
  /** One-line explanation of WHY — suitable for a tooltip or subline. */
  detail: string;
  /** Fill percentage, still useful for the meter itself. */
  fillPct: number;
  /** Share of the window permanently claimed by pins + instructions + docs. */
  overheadPct: number;
  recommendations: ContextHealthRecommendation[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Dream Cycle older than this (while the window is rotating) counts against health. */
export const DREAM_OVERDUE_MS = 3 * DAY_MS;

// Structural thresholds, as % of the model's context limit.
const PIN_BLOAT_PCT = 25;
const DOCS_BLOAT_PCT = 35;
const SYSTEM_BLOAT_PCT = 25;
/** Below this much window left for live conversation, coherence suffers. */
const LIVE_FLOOR_PCT = 25;
/** Under this fill, the window simply isn't under any pressure yet. */
const STEADY_STATE_PCT = 70;

export function assessContextHealth(input: ContextHealthInput): ContextHealth {
  const now = input.now ?? Date.now();
  const limit = Math.max(1, input.limitChars);
  const fillPct = Math.min((input.usedChars / limit) * 100, 100);

  const pinsPct = (input.pinsChars / limit) * 100;
  const docsPct = (input.docsChars / limit) * 100;
  const systemPct = (input.systemChars / limit) * 100;
  const overheadPct = Math.min(pinsPct + docsPct + systemPct + (input.browserChars / limit) * 100, 100);
  const livePct = Math.max(0, 100 - overheadPct);

  const recommendations: ContextHealthRecommendation[] = [];
  // Structural signals — fixed content squeezing the live conversation. Any of
  // these means "attention": rotation can't fix them because they never rotate.
  let structural = false;

  if (input.rotating && !input.memoryPipelineActive) {
    structural = true;
    recommendations.push({
      id: 'enable-memory',
      text: 'Older messages are rotating out of the window without being saved — connect a model and memory folder so nothing is lost.',
    });
  }
  if (pinsPct > PIN_BLOAT_PCT) {
    structural = true;
    recommendations.push({
      id: 'unpin',
      text: `Pins permanently hold ${Math.round(pinsPct)}% of the window. Unpin anything you no longer need verbatim — memory still remembers it.`,
    });
  }
  if (docsPct > DOCS_BLOAT_PCT) {
    structural = true;
    recommendations.push({
      id: 'trim-docs',
      text: `Attached docs take ${Math.round(docsPct)}% of every request. Detach ones this conversation no longer needs.`,
    });
  }
  if (systemPct > SYSTEM_BLOAT_PCT) {
    structural = true;
    recommendations.push({
      id: 'trim-instructions',
      text: `Agent instructions take ${Math.round(systemPct)}% of every request — consider tightening them in Settings.`,
    });
  }
  if (!structural && livePct < LIVE_FLOOR_PCT) {
    // Overhead is spread across categories without any single one crossing its
    // threshold, but the live window is still squeezed.
    structural = true;
    recommendations.push({
      id: 'unpin',
      text: `Only ${Math.round(livePct)}% of the window is left for live conversation — trim pins, docs, or instructions to give it room.`,
    });
  }

  // Consolidation signal — the conversation has outgrown the window, so recall
  // quality now rides on memory. An overdue Dream Cycle is worth flagging.
  const dreamOverdue =
    input.rotating &&
    input.memoryPipelineActive &&
    (input.lastDreamAt == null || now - input.lastDreamAt > DREAM_OVERDUE_MS);
  if (dreamOverdue) {
    recommendations.push({
      id: 'dream',
      text: input.lastDreamAt == null
        ? 'Much of this conversation now lives in memory. Run a Dream Cycle to consolidate it so recall stays sharp.'
        : 'Memory has grown since the last Dream Cycle. Run one to consolidate so recall stays sharp.',
    });
  }

  if (structural || dreamOverdue) {
    return {
      status: 'attention',
      headline: 'Needs tuning',
      detail: recommendations[0].text,
      fillPct,
      overheadPct,
      recommendations,
    };
  }

  if (input.rotating || fillPct >= STEADY_STATE_PCT) {
    return {
      status: 'optimized',
      headline: 'Optimized',
      detail: input.rotating
        ? 'Steady state: older messages are scored and saved to memory as they rotate out; pins and instructions stay put.'
        : 'The window is filling; when it does, older messages will rotate into memory automatically — nothing important is lost.',
      fillPct,
      overheadPct,
      recommendations,
    };
  }

  return {
    status: 'healthy',
    headline: 'Healthy',
    detail: `${Math.round(fillPct)}% in use — plenty of headroom.`,
    fillPct,
    overheadPct,
    recommendations,
  };
}
