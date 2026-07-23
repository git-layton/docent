// Mail triage — the pure engine behind queue-based Mail and Sweep (roadmap D1).
//
// House Stance discipline throughout:
//   • (v) deterministic fallback: `classifyHeaderHeuristic` works with no model at all —
//     the model pass only UPGRADES classifications, and a bad model response falls back.
//   • (iii) `_rationale` is the FIRST field in the model schema, single pass.
//   • (ii) `parseTriageResponse` is defensive: schema conformance isn't correctness, so
//     unknown uids are dropped and malformed output returns null (caller uses heuristics).
//   • Sweep produces a PLAN (data), executed elsewhere with ONE batch receipt whose undo
//     comes from `invertSweepPlan` — the plan carries its own reversal.
//
// Everything here is pure and unit-tested; no Tauri, no store, no model calls.

export type MailQueue = 'needs-reply' | 'newsletter' | 'receipt' | 'other';

export interface TriageHeader {
  uid: number;
  account: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string;   // RFC-ish date string from IMAP
  seen: boolean;
  flagged: boolean;
}

export interface ClassifiedHeader extends TriageHeader {
  queue: MailQueue;
  /** True when the classification came from the model pass, not the heuristic floor. */
  modelClassified?: boolean;
}

// ── Heuristic floor (Stance v) ──────────────────────────────────────────────

const AUTOMATED_SENDER = /^(no-?reply|noreply|donotreply|notifications?|updates?|newsletter|news|digest|mailer|bounce|alerts?|info|marketing|hello|support|team)@/i;
const NEWSLETTER_SUBJECT = /\b(newsletter|digest|weekly|monthly|roundup|issue #?\d+|unsubscribe|what's new|this week in)\b/i;
const RECEIPT_SUBJECT = /\b(receipt|invoice|order (confirm|#|no)|payment|purchase|shipped|shipping|delivery|tracking|your order|booking confirm|reservation|statement|renewal)\b/i;
const URGENT_SUBJECT = /\b(urgent|asap|action required|deadline|today|by (eod|end of day)|final notice|reminder:)\b/i;

/** Deterministic classification — the floor every install gets, model or not. */
export function classifyHeaderHeuristic(h: TriageHeader): MailQueue {
  const from = h.fromEmail.trim();
  if (RECEIPT_SUBJECT.test(h.subject)) return 'receipt';
  if (AUTOMATED_SENDER.test(from) || NEWSLETTER_SUBJECT.test(h.subject)) return 'newsletter';
  // A human sender: unread mail is a reply candidate; read mail rests in Everything else.
  return h.seen ? 'other' : 'needs-reply';
}

export function classifyAllHeuristic(headers: TriageHeader[]): ClassifiedHeader[] {
  return headers.map(h => ({ ...h, queue: classifyHeaderHeuristic(h) }));
}

// ── Model upgrade pass (Stances ii + iii) ───────────────────────────────────

/**
 * Prompt for the single-pass model upgrade. The model sees numbered headers (subjects +
 * senders only — bodies never leave the panel) and returns STRICT JSON whose first field is
 * its rationale, so reasoning happens before the answer fields (Stance iii).
 */
export function buildTriagePrompt(headers: TriageHeader[]): string {
  const lines = headers
    .map(h => `${h.uid}: from "${h.fromName || h.fromEmail}" <${h.fromEmail}> — "${h.subject}"${h.seen ? ' (read)' : ''}`)
    .join('\n');
  return `Classify each email header into exactly one queue: "needs-reply" (a person expects the user to respond), "newsletter" (bulk/automated content), "receipt" (transactions, orders, confirmations), or "other".

Return ONLY JSON in this exact shape, _rationale first:
{"_rationale": "<2-3 sentences on the judgment calls>", "queues": {"<uid>": "<queue>", ...}}

Headers:
${lines}`;
}

/**
 * Defensive parse of the model's triage response. Returns null when the response is
 * unusable (caller keeps the heuristic floor). Unknown uids and invalid queue names are
 * dropped individually — one bad entry never poisons the batch.
 */
export function parseTriageResponse(text: string, knownUids: number[]): Map<number, MailQueue> | null {
  const VALID: MailQueue[] = ['needs-reply', 'newsletter', 'receipt', 'other'];
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: any;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.queues !== 'object' || parsed.queues === null) return null;
  const known = new Set(knownUids);
  const out = new Map<number, MailQueue>();
  for (const [k, v] of Object.entries(parsed.queues)) {
    const uid = Number(k);
    if (known.has(uid) && VALID.includes(v as MailQueue)) out.set(uid, v as MailQueue);
  }
  return out.size > 0 ? out : null;
}

/** Merge the model's upgrades over the heuristic floor. */
export function applyModelUpgrade(base: ClassifiedHeader[], upgrade: Map<number, MailQueue>): ClassifiedHeader[] {
  return base.map(h => (upgrade.has(h.uid) ? { ...h, queue: upgrade.get(h.uid)!, modelClassified: true } : h));
}

// ── Sweep (plan → execute elsewhere → ONE undoable batch receipt) ───────────

export interface SweepPlan {
  /** Mark read + archive: bulk content that needs no attention. */
  archive: ClassifiedHeader[];
  /** Queue a held draft (never sent) for each of these. */
  draft: ClassifiedHeader[];
  /** Star: reply candidates with urgency markers. */
  flag: ClassifiedHeader[];
  /** Human sentence for the confirmation + receipt. */
  summary: string;
}

export function planSweep(classified: ClassifiedHeader[]): SweepPlan {
  const unread = classified.filter(h => !h.seen);
  const archive = unread.filter(h => h.queue === 'newsletter' || h.queue === 'receipt');
  const replyCandidates = unread.filter(h => h.queue === 'needs-reply');
  const flag = replyCandidates.filter(h => URGENT_SUBJECT.test(h.subject) && !h.flagged);
  const parts: string[] = [];
  if (archive.length) parts.push(`archive ${archive.length} newsletter${archive.length === 1 ? '' : 's'}/receipt${archive.length === 1 ? '' : 's'}`);
  if (replyCandidates.length) parts.push(`draft ${replyCandidates.length} repl${replyCandidates.length === 1 ? 'y' : 'ies'}`);
  if (flag.length) parts.push(`flag ${flag.length} urgent`);
  return {
    archive,
    draft: replyCandidates,
    flag,
    summary: parts.length ? `Sweep: ${parts.join(', ')}.` : 'Sweep: inbox already clean — nothing to do.',
  };
}

export interface SweepInverse {
  /** Mark unread again (un-archive). */
  unarchive: Array<{ account: string; uid: number }>;
  /** Remove the star. */
  unflag: Array<{ account: string; uid: number }>;
  // Held drafts are discarded by the executor on undo; they were never sent, so there is
  // nothing external to reverse — which is exactly why drafting is Sweep-safe.
}

/** The plan carries its own reversal — this is what the batch receipt's undo replays. */
export function invertSweepPlan(plan: SweepPlan): SweepInverse {
  return {
    unarchive: plan.archive.map(h => ({ account: h.account, uid: h.uid })),
    unflag: plan.flag.map(h => ({ account: h.account, uid: h.uid })),
  };
}
