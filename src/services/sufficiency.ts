// ─── Context Sufficiency ──────────────────────────────────────────────────────
// The positive half of the provenance model.
//
// provenance.ts is entirely NEGATIVE: `generated` can't ground, a model can't claim `read`,
// a quote must verify. Those stop the model inventing. None of them help it FIND the true
// thing instead — and a system that only forbids invention, without knowing when it lacks
// the facts, just invents more confidently.
//
// The failure this exists to prevent is measured and counter-intuitive: **retrieval reduces
// a model's willingness to abstain.** Adding context raises confidence, so a model handed
// INSUFFICIENT context hallucinates more than one handed none. Surfacing more is therefore
// not automatically safer — it is only safer when paired with knowing whether what was
// surfaced is enough. Smaller local models are worse at this in both directions: they
// hallucinate with sufficient context and abstain with it too.
//
// So this module answers one question before an answer is composed: **do we actually have
// enough to say anything?** And it emits a DIRECTIVE, because a verdict nothing acts on
// changes no behaviour.
//
// Deliberately MECHANICAL — term coverage, grounded counts, source spread, entity gaps. No
// model call. A model asked "is this context sufficient?" is judging its own footing, and
// per the capability boundary (docs/concept-canvas-design.md) self-verification reproduces
// the same reasoning that created the problem. These signals are also free, which means the
// gate can run on every turn including on a local model with no budget for a second pass.

import { groundsWorldClaims, type Block } from './provenance';

export type Sufficiency = 'sufficient' | 'thin' | 'insufficient';

export interface SufficiencyInput {
  /** What was asked. */
  query: string;
  /** Everything retrieved for this turn — library passages, graph context, log entries. */
  passages: readonly Block[];
  /** Entities the query names that the map DOES hold. */
  entitiesFound?: readonly string[];
  /** Entities the query names that the map does NOT hold — the known unknowns. */
  entitiesMissing?: readonly string[];
}

export interface SufficiencyVerdict {
  level: Sufficiency;
  /** Share of the query's content words that appear anywhere in the retrieved text. */
  termCoverage: number;
  /** Passages that can support a claim about the world (`read` / `authored`). */
  groundedPassages: number;
  /** Distinct sources behind those passages. One source is a claim, not a consensus. */
  distinctSources: number;
  missingEntities: string[];
  /** Why, in the user's language — suitable for a UI line. */
  detail: string;
  /**
   * Injected into the prompt. This is the part that changes behaviour: a verdict nothing
   * reads is decoration.
   */
  directive: string;
}

/** Below this term coverage, retrieval plainly did not find the subject. */
export const COVERAGE_FLOOR = 0.25;
/** Below this, it found something adjacent but thin. */
export const COVERAGE_THIN = 0.5;

// Words that carry no retrieval signal. Short list on purpose — over-stripping makes
// coverage look worse than it is and pushes the gate toward false abstention.
//
// The PLEASANTRIES row is load-bearing, not politeness: without it "thanks!" parses as a
// one-term query, scores 0% coverage, and the gate answers a thank-you with "nothing in
// your library supports an answer to this." Callers should also skip the gate entirely on
// turns that aren't information-seeking — this list is the backstop for when they don't.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'can', 'could', 'would',
  'should', 'what', 'why', 'how', 'when', 'where', 'who', 'my', 'me', 'i', 'you', 'it',
  'this', 'that', 'these', 'those', 'about', 'from', 'as', 'by', 'so', 'we', 'they',
  // pleasantries
  'thanks', 'thank', 'hello', 'hi', 'hey', 'ok', 'okay', 'yes', 'no', 'yeah', 'nope',
  'please', 'sure', 'cool', 'nice', 'great', 'sorry', 'oops', 'wait', 'hmm',
]);

const normalize = (s: string) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Content words of a query — what retrieval was actually supposed to find. */
export function contentTerms(query: string): string[] {
  return normalize(query)
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

export function assessSufficiency(input: SufficiencyInput): SufficiencyVerdict {
  const terms = contentTerms(input.query);
  const passages = input.passages ?? [];
  const missingEntities = [...(input.entitiesMissing ?? [])];

  const grounded = passages.filter(groundsWorldClaims);
  const groundedPassages = grounded.length;

  const sources = new Set(
    grounded
      .map(p => (p as Extract<Block, { origin: 'read' | 'authored' }>).sourcePath)
      .filter(Boolean) as string[],
  );
  const distinctSources = sources.size;

  const haystack = normalize(passages.map(p => p.text).join(' '));
  const covered = terms.filter(t => haystack.includes(t)).length;
  // No content terms means an unanswerable-by-retrieval query ("hi", "thanks"). Treat
  // coverage as complete rather than zero — nothing was asked for, so nothing is missing.
  const termCoverage = terms.length === 0 ? 1 : covered / terms.length;

  // ── Verdict ───────────────────────────────────────────────────────────────
  // Nothing grounded is the strongest signal there is: whatever was retrieved, none of it
  // can support a claim about the world, so an answer would be the model talking to itself
  // with extra confidence — the exact documented failure.
  const nothingToStandOn = groundedPassages === 0;
  const missedTheSubject = termCoverage < COVERAGE_FLOOR;

  if (nothingToStandOn || missedTheSubject) {
    return {
      level: 'insufficient',
      termCoverage, groundedPassages, distinctSources, missingEntities,
      detail: nothingToStandOn
        ? 'Nothing in your library supports an answer to this yet.'
        : `Your library barely touches this — ${Math.round(termCoverage * 100)}% of what you asked about appears in it.`,
      directive:
        'CONTEXT IS INSUFFICIENT. The retrieved material does not support an answer to this ' +
        'question. Say so plainly and offer to go read about it. Do NOT answer from your own ' +
        'general knowledge as though it were sourced — if you do share what you know, label it ' +
        'explicitly as your own knowledge rather than something from the user\'s library.',
    };
  }

  // Grounded, but on one source or partial coverage. Answerable with care — and the care
  // has to be stated, because "hedge appropriately" is not something a model infers from
  // thin context; the research shows it grows MORE confident as context grows.
  const thin = termCoverage < COVERAGE_THIN || distinctSources <= 1 || missingEntities.length > 0;
  if (thin) {
    const why = missingEntities.length > 0
      ? `nothing on ${missingEntities.slice(0, 3).join(', ')}`
      : distinctSources <= 1
        ? 'only one source backs this'
        : `only ${Math.round(termCoverage * 100)}% of what you asked about is covered`;
    return {
      level: 'thin',
      termCoverage, groundedPassages, distinctSources, missingEntities,
      detail: `Partial — ${why}.`,
      directive:
        'CONTEXT IS THIN. Answer ONLY what the retrieved passages actually support. Where they ' +
        'do not reach, say what is missing instead of filling the gap. Do not present a ' +
        'single-source claim as settled.' +
        (missingEntities.length > 0
          ? ` The library holds nothing on: ${missingEntities.slice(0, 5).join(', ')}.`
          : ''),
    };
  }

  return {
    level: 'sufficient',
    termCoverage, groundedPassages, distinctSources, missingEntities,
    detail: `${groundedPassages} grounded passage${groundedPassages === 1 ? '' : 's'} across ${distinctSources} sources.`,
    directive:
      'Answer from the retrieved passages, citing them. If some part of the question is not ' +
      'covered by them, say so rather than supplying it from memory.',
  };
}

/** True when the honest move is to offer to go read instead of answering. */
export function shouldOfferToRead(v: SufficiencyVerdict): boolean {
  return v.level === 'insufficient';
}
