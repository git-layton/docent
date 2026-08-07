// ─── Research Run ─────────────────────────────────────────────────────────────
// The loop: ask an angle, read what comes back, digest it, recount, decide whether the
// knowledge base is ready. Planning and the stop predicate live in researchPlan.ts; this is
// the part that actually spends time and network.
//
// Dependencies are INJECTED rather than imported. The real run uses browserAgent + pageDigest,
// which need Tauri and a live browser panel — but the orchestration (dedupe, diversity
// preference, budget enforcement, abort, failure tolerance) is where the bugs live, and none
// of it should require an app to test. A run against fakes and a run against the web execute
// exactly the same code path.

import {
  planResearch, shouldStop, nextQuestion, describeOutcome, domainOf,
  type ResearchPlan, type ResearchProgress, type ResearchBudget, type StopDecision,
} from './researchPlan';
import { contentTerms } from './sufficiency';

export interface FoundSource {
  url: string;
  title: string;
  /** Extracted page text, when the searcher already has it. */
  text?: string;
}

export interface DigestResult {
  /** Blocks that ended up grounded. Zero is a legitimate outcome — some pages yield nothing. */
  groundedBlocks: number;
  /** True when this source disagreed with what the run had already gathered. */
  contested?: boolean;
  /**
   * The page's text, used to check the material is actually ABOUT the topic. Optional, but a
   * run that never supplies it can never satisfy the coverage condition and will report
   * "not actually about" rather than declaring a false success — which is the safe direction.
   */
  text?: string;
}

export interface RunEvent {
  phase: 'question' | 'read' | 'digested' | 'stopped';
  message: string;
  progress: ResearchProgress;
}

export interface ResearchDeps {
  /** Find candidate sources for one angle. */
  search: (question: string, signal?: AbortSignal) => Promise<FoundSource[]>;
  /** Ingest a source into the knowledge base. Throwing is tolerated — see the loop. */
  digest: (source: FoundSource, signal?: AbortSignal) => Promise<DigestResult>;
  now?: () => number;
  onEvent?: (e: RunEvent) => void;
  signal?: AbortSignal;
  /** Per-source ceiling; defaults to SOURCE_TIMEOUT_MS. */
  sourceTimeoutMs?: number;
}

export interface ResearchOutcome {
  plan: ResearchPlan;
  progress: ResearchProgress;
  decision: StopDecision;
  /** What to tell the user. */
  report: string;
  /** Every source actually read, in order. */
  read: FoundSource[];
}

/** Sources per angle. Reading everything one query returns is how a run becomes a monoculture. */
export const MAX_PER_QUESTION = 4;

/**
 * Per-source ceiling. A run's wall-clock budget is only consulted BETWEEN sources, so without
 * this a single page that never responds stalls the entire run forever — the time budget can
 * never fire because control never comes back to check it.
 *
 * Found by running the loop against the live web: one unresponsive page hung a run past every
 * budget it had. A budget that only applies when things are going well is not a budget.
 */
export const SOURCE_TIMEOUT_MS = 20_000;

/** Reject after `ms`, so one unresponsive dependency can't outlive the run's budget. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    work.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Order candidates so unseen domains come first — decision ② of researchPlan, enforced while
 * the run is happening rather than audited afterwards.
 *
 * A search engine returns its best matches, which cluster on the sites that rank well. Taking
 * them in order is exactly how a run ends up with eight sources that agree because they came
 * from the same three places. Stable within each group, so a good result is never buried, only
 * deferred behind something new.
 */
export function preferUnseenDomains(
  sources: readonly FoundSource[],
  seenDomains: readonly string[],
): FoundSource[] {
  const seen = new Set(seenDomains);
  const fresh: FoundSource[] = [];
  const repeat: FoundSource[] = [];
  for (const s of sources ?? []) {
    (seen.has(domainOf(s.url)) ? repeat : fresh).push(s);
  }
  return [...fresh, ...repeat];
}

const aborted = (signal?: AbortSignal) => !!signal?.aborted;

export async function runResearch(
  topic: string,
  deps: ResearchDeps,
  opts: { budget?: Partial<ResearchBudget>; questions?: string[] } = {},
): Promise<ResearchOutcome> {
  const now = deps.now ?? (() => Date.now());
  const plan = planResearch(topic, opts);

  const progress: ResearchProgress = {
    sourcesRead: 0,
    domains: [],
    groundedBlocks: 0,
    contestedFound: 0,
    asked: [],
    topicTermsSeen: [],
    startedAt: now(),
    now: now(),
  };

  // The topic's own words, so each page can be checked for whether it is about the thing —
  // not merely adjacent to it.
  const topicTerms = contentTerms(topic);
  const termsSeen = new Set<string>();

  // URLs already read, so the same page found by two different angles is not counted twice —
  // double-counting would inflate every stop condition at once.
  const seenUrls = new Set<string>();
  const read: FoundSource[] = [];
  const emit = (phase: RunEvent['phase'], message: string) =>
    deps.onEvent?.({ phase, message, progress: { ...progress, domains: [...progress.domains] } });

  let decision: StopDecision = { stop: false, reason: 'continue', detail: '' };

  while (!aborted(deps.signal)) {
    progress.now = now();
    decision = shouldStop(plan, progress);
    if (decision.stop) break;

    const question = nextQuestion(plan, progress);
    if (!question) {
      // Out of angles. Mark every angle asked so shouldStop reports `exhausted` rather than
      // spinning — the loop must never depend on a caller noticing it is stuck.
      progress.asked = [...plan.questions];
      progress.now = now();
      decision = shouldStop(plan, progress);
      break;
    }

    emit('question', `Looking into: ${question}`);
    progress.asked.push(question);

    let candidates: FoundSource[] = [];
    try {
      candidates = await withTimeout(
        deps.search(question, deps.signal),
        deps.sourceTimeoutMs ?? SOURCE_TIMEOUT_MS,
        'search',
      );
    } catch (e) {
      // A failed search costs this angle, not the run.
      emit('question', `That search failed (${(e as Error)?.message ?? e}) — trying the next angle.`);
      continue;
    }

    const ordered = preferUnseenDomains(candidates, progress.domains).slice(0, MAX_PER_QUESTION);

    for (const source of ordered) {
      if (aborted(deps.signal)) break;
      if (!source?.url || seenUrls.has(source.url)) continue;
      // Enforce the ceiling INSIDE the question loop, not just between angles, so a single
      // generous search can't overshoot the budget by three or four reads.
      if (progress.sourcesRead >= plan.budget.maxSources) break;

      seenUrls.add(source.url);
      emit('read', `Reading ${source.title || source.url}`);

      let result: DigestResult;
      try {
        result = await withTimeout(
          deps.digest(source, deps.signal),
          deps.sourceTimeoutMs ?? SOURCE_TIMEOUT_MS,
          'reading that page',
        );
      } catch (e) {
        // A page that fails to digest still counts as READ — it consumed budget and produced
        // nothing. Recording it is what lets describeOutcome say "3 sources produced nothing
        // quotable" instead of quietly pretending they were never opened.
        result = { groundedBlocks: 0 };
        emit('digested', `Couldn't use ${source.title || source.url}: ${(e as Error)?.message ?? e}`);
      }

      read.push(source);
      progress.sourcesRead += 1;
      const d = domainOf(source.url);
      if (d) progress.domains.push(d);
      progress.groundedBlocks += Math.max(0, result.groundedBlocks | 0);
      if (result.contested) progress.contestedFound += 1;

      // Which of the topic's words this page actually contained. The title is included
      // because a search result's title is often the only place the exact term survives.
      const hay = `${source.title ?? ''} ${result.text ?? source.text ?? ''}`.toLowerCase();
      for (const t of topicTerms) if (hay.includes(t)) termsSeen.add(t);
      progress.topicTermsSeen = [...termsSeen];

      progress.now = now();
      const mid = shouldStop(plan, progress);
      if (mid.stop) { decision = mid; break; }
    }

    progress.now = now();
    const after = shouldStop(plan, progress);
    if (after.stop) { decision = after; break; }
  }

  if (aborted(deps.signal)) {
    decision = {
      stop: true,
      reason: 'budget-time',
      detail: `Stopped early — ${progress.sourcesRead} source${progress.sourcesRead === 1 ? '' : 's'} read before you cancelled.`,
    };
  }

  const report = describeOutcome(progress, decision);
  emit('stopped', report);
  return { plan, progress, decision, report, read };
}
