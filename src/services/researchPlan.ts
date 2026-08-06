// ─── Research Planning ────────────────────────────────────────────────────────
// The planning half of "go learn about this and tell me when the knowledge base is ready."
//
// Two decisions live here, and they are what separate this from every "read N pages and
// write a report" tool.
//
// ① READY IS MEASURED, NOT COUNTED. Deep-research tools stop at N pages or N minutes. That
//    makes "ready" a progress bar finishing rather than a claim about the library. Here the
//    run stops when the topic has enough GROUNDED material across enough DISTINCT sources —
//    a condition you can substantiate — and falls back to budget only as a backstop.
//
// ② DIVERSITY IS ENFORCED DURING THE LOOP, NOT AUDITED AFTER. Retrieval collapse erodes
//    source diversity before it erodes accuracy: an agent that takes the first ten results
//    converges on one narrative that reads well-grounded and moves together. So domain
//    spread is a stop CONDITION, not a report line, and one search angle exists purely to
//    hunt for disagreement — otherwise `contested` provenance has no way to ever appear.
//
// The measured failure this is designed against: deep-research agents produce >94% valid
// links and >80% topical relevance against only 39–77% factual accuracy. Citations that look
// immaculate while the facts don't hold. The antidote is not better search — it is that every
// claim carries a quote mechanically matched to its source (provenance.ts). Planning's job is
// to make sure the sources are worth quoting in the first place.
//
// Pure and network-free, so the strategy is testable before any page is fetched.

export interface ResearchBudget {
  /** Hard ceiling. A run never reads more than this, however unsatisfied it is. */
  maxSources: number;
  /** Wall-clock backstop, in minutes. */
  maxMinutes: number;
  /** Never declare "ready" below this, however well-covered it looks. */
  minSources: number;
  /** Never declare "ready" from fewer domains than this — see decision ②. */
  minDistinctDomains: number;
}

export const DEFAULT_BUDGET: ResearchBudget = {
  maxSources: 18,
  maxMinutes: 12,
  minSources: 6,
  minDistinctDomains: 4,
};

export interface ResearchPlan {
  topic: string;
  /** Search angles, in the order they should be pursued. */
  questions: string[];
  budget: ResearchBudget;
}

export interface ResearchProgress {
  /** Sources successfully read and digested. */
  sourcesRead: number;
  /** Domain of every source read, in order — duplicates expected and meaningful. */
  domains: string[];
  /** Blocks that ended up grounded (`read`/`authored`) after digestion. */
  groundedBlocks: number;
  /** Sources that disagreed with others — the reason the dissent angle exists. */
  contestedFound: number;
  /** Angles already pursued, so the planner doesn't repeat itself. */
  asked: string[];
  startedAt: number;
  now: number;
}

export type StopReason =
  | 'ready'
  | 'budget-sources'
  | 'budget-time'
  | 'exhausted'
  | 'continue';

// ── Angles ──────────────────────────────────────────────────────────────────

/**
 * MINIMAL fallback angles, used only when no model is available to generate real ones.
 *
 * An earlier draft had six templates — best practices, compared to alternatives, recent
 * developments — and that was the fixed grid the concept canvas explicitly rejected, smuggled
 * back in. It fails on its own terms: "grief best practices" and "the French Revolution
 * compared to alternatives" are nonsense. Four of those six silently assumed the topic was a
 * practice or a product.
 *
 * What survives is only what genuinely generalises. Every subject has an identity and a
 * dispute; not every subject has competitors or a release cycle. Generated questions are the
 * PRIMARY path — these exist so a run degrades rather than fails when no model is configured.
 *
 * The DISSENT angle is the one thing that is not optional, and it is here on evidence rather
 * than symmetry: without it a run reads only sources that agree, and `contested` provenance
 * can never be produced — the library would record every topic as settled because it never
 * went looking for an argument.
 */
export const ANGLES: Array<(topic: string) => string> = [
  t => `what is ${t}`,
  t => `${t} explained in detail`,
  t => `criticism of ${t} limitations problems`,   // the dissent angle — load-bearing
];

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function planResearch(
  topic: string,
  opts: { budget?: Partial<ResearchBudget>; questions?: string[] } = {},
): ResearchPlan {
  const t = clean(topic);
  const budget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };

  // Generated questions are the PRIMARY path — a model can decompose a topic on its own terms,
  // which is exactly what a fixed template list cannot do. The dissent angle is appended
  // regardless: a model asked to research something reliably proposes angles that confirm it,
  // and nothing else in the pipeline will go looking for the counter-argument.
  const generated = (opts.questions ?? []).map(clean).filter(Boolean);
  const questions = generated.length > 0
    ? dedupe([...generated, ANGLES[2](t)])
    : dedupe(ANGLES.map(fn => fn(t)));

  return { topic: t, questions, budget };
}

const dedupe = (xs: string[]) => [...new Set(xs.map(x => x.toLowerCase()))].map(
  lower => xs.find(x => x.toLowerCase() === lower) as string,
);

// ── Diversity ───────────────────────────────────────────────────────────────

/** Registrable-ish domain of a URL. Best-effort: a bad URL contributes nothing rather than throwing. */
export function domainOf(url: string): string {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Distinct domains over sources read. 1.0 = every source from a different place. */
export function diversityScore(domains: readonly string[]): number {
  const seen = (domains ?? []).filter(Boolean);
  if (seen.length === 0) return 0;
  return new Set(seen).size / seen.length;
}

/**
 * Has one domain come to dominate the run?
 *
 * A single site supplying most of what the library learns about a topic is the shape of
 * retrieval collapse — it reads as thorough and is a monoculture.
 */
export function isDominatedByOneDomain(domains: readonly string[], threshold = 0.5): boolean {
  const seen = (domains ?? []).filter(Boolean);
  if (seen.length < 4) return false;
  const counts = new Map<string, number>();
  for (const d of seen) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.values()].some(n => n / seen.length > threshold);
}

// ── The stop predicate ──────────────────────────────────────────────────────

export interface StopDecision {
  stop: boolean;
  reason: StopReason;
  /** Why, in the user's language. */
  detail: string;
}

export function shouldStop(plan: ResearchPlan, p: ResearchProgress): StopDecision {
  const { budget } = plan;
  const distinct = new Set((p.domains ?? []).filter(Boolean)).size;
  const elapsedMin = Math.max(0, (p.now - p.startedAt) / 60000);

  // Backstops first — a run must always terminate, however unsatisfied.
  if (p.sourcesRead >= budget.maxSources) {
    return {
      stop: true, reason: 'budget-sources',
      detail: `Read ${p.sourcesRead} sources — the limit for one run. Stopping with what I have.`,
    };
  }
  if (elapsedMin >= budget.maxMinutes) {
    return {
      stop: true, reason: 'budget-time',
      detail: `Spent ${Math.round(elapsedMin)} minutes on this. Stopping with what I have.`,
    };
  }

  // "Ready" — the measured condition. All three must hold: enough sources, enough SPREAD, and
  // material that actually grounds. Grounded blocks matter because a run can read ten pages
  // and digest nothing usable, which is a failure that a page count would report as success.
  const enough = p.sourcesRead >= budget.minSources;
  const spread = distinct >= budget.minDistinctDomains && !isDominatedByOneDomain(p.domains);
  const usable = p.groundedBlocks >= budget.minSources;

  if (enough && spread && usable) {
    return {
      stop: true, reason: 'ready',
      detail: `The start of a knowledge base on ${plan.topic} is ready — ${p.sourcesRead} sources across ${distinct} sites.`,
    };
  }

  // Nothing left to try. Reported honestly rather than dressed up as ready: a run that ran out
  // of angles has NOT covered the topic, and saying so is what lets the user decide to push.
  if (p.asked.length >= plan.questions.length && p.sourcesRead > 0) {
    return {
      stop: true, reason: 'exhausted',
      detail: enough
        ? `Followed every angle — ${p.sourcesRead} sources, but only ${distinct} distinct sites. Thin on independent corroboration.`
        : `Followed every angle and only found ${p.sourcesRead} usable sources. This topic is thinly covered where I can reach.`,
    };
  }

  return { stop: false, reason: 'continue', detail: '' };
}

/** The next angle to pursue, or null when they're spent. */
export function nextQuestion(plan: ResearchPlan, p: ResearchProgress): string | null {
  const asked = new Set((p.asked ?? []).map(a => a.toLowerCase()));
  return plan.questions.find(q => !asked.has(q.toLowerCase())) ?? null;
}

// ── Reporting ───────────────────────────────────────────────────────────────

/**
 * What to tell the user when the run finishes.
 *
 * Deliberately reports SHAPE, not a summary of the content: how much was read, how spread out
 * it was, and — the part that matters — what is still thin. A completion message that only
 * says "done, here's a report" hides whether the thing is actually worth trusting.
 */
export function describeOutcome(
  p: ResearchProgress,
  decision: StopDecision,
): string {
  const parts = [decision.detail];

  if (p.contestedFound > 0) {
    parts.push(`${p.contestedFound} source${p.contestedFound === 1 ? '' : 's'} disagreed with the rest — kept as contested rather than flattened.`);
  }
  if (decision.reason === 'ready' && diversityScore(p.domains) < 0.6) {
    parts.push('Several sources came from the same places, so treat the consensus carefully.');
  }
  if (p.groundedBlocks < p.sourcesRead) {
    parts.push(`${p.sourcesRead - p.groundedBlocks} source${p.sourcesRead - p.groundedBlocks === 1 ? '' : 's'} produced nothing quotable.`);
  }
  return parts.filter(Boolean).join(' ');
}
