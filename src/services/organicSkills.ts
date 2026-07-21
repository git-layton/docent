// ─── Organic Skill Learning ─────────────────────────────────────────────────────
// How Docent acquires new skills by DOING, not by decree.
//
// Docent already stores procedural skills as "playbooks" (appliedMemory.ts): a task-intent → a
// sequence of steps, held behind a `verified` trust flag until it's earned the right to be suggested.
// What was missing is how a skill is BORN. Today the model has to explicitly decree one (a
// `playbook:capture` action), so a skill only exists if the agent thought to name it in the moment.
//
// This module makes skills EMERGE instead. After the agent completes a multi-step task, we distill a
// *candidate* skill from what it actually did and let repetition decide its fate: a task the agent
// keeps doing crystallizes into a suggestable skill; a one-off decays and is quietly forgotten. The
// safety model is untouched — a learned skill only ever becomes an OFFER (formatProceduresBlock), never
// an auto-run, and each step is still individually confirmed at execution time.
//
// This file is PURE and dependency-light (mirrors appliedMemory's pure helpers), so the learning
// POLICY is unit-tested in isolation. Disk/store wiring lives at the call site — see
// `docs/organic-skills.md` for the intended integration seam.

import type { Playbook, PlaybookStep } from './appliedMemory';
import { playbookTriggerSlug, formatProceduresBlock } from './appliedMemory';
import { skillPromptForSurface, type SurfaceContext } from '../data/skills';

// A skill Docent has watched itself perform. A Playbook plus the organic-learning counters that decide
// whether it graduates from candidate to suggestable.
export interface LearnedSkill extends Playbook {
  seen: number;         // times this task-pattern has recurred and completed on its own (auto-observed)
  lastSeenAt?: string;  // ISO timestamp of the most recent observation — drives decay
}

// One completed, already-confirmed tool action, in the shape the app records during a turn. This is the
// raw material a skill is distilled from — the step's plain-language intent plus the tool it used.
export interface CompletedAction {
  tool: string;
  intent: string; // one-line natural-language description of what the step did
}

// How readily skills form, promote, and fade. Deliberately conservative: a skill must recur before it's
// ever suggested, so the agent never pitches a one-off as a proven, repeatable procedure.
export interface SkillLearningPolicy {
  minSteps: number;           // a task needs at least this many distinct steps to be worth remembering
  promoteAfterSeen: number;   // auto-promote to suggestable once observed this many times…
  promoteAfterAccept: number; // …or once the user has approved running it this many times
  decayAfterDays: number;     // an un-promoted candidate untouched this long is forgotten
}

export const DEFAULT_SKILL_POLICY: SkillLearningPolicy = {
  minSteps: 2,
  promoteAfterSeen: 3,
  promoteAfterAccept: 1,
  decayAfterDays: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const clean = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim();

// A tool label used only as a soft retrieval hint — normalized, never a bound action.
const cleanTool = (s: string): string => clean(s).toLowerCase().replace(/[^a-z0-9_]+/g, '');

// Title-case a short handle for the skill from its intent, so the offer reads like a name, not a slug.
function titleFromIntent(intent: string): string {
  const words = clean(intent).slice(0, 80).split(' ').filter(Boolean);
  if (!words.length) return 'Untitled skill';
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

// Collapse consecutive steps that repeat the same intent (a retry loop, a paginated fetch) into one, so
// a distilled skill reads as the shape of the task rather than a keystroke log.
function dedupeSteps(steps: PlaybookStep[]): PlaybookStep[] {
  const out: PlaybookStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.intent.toLowerCase() === s.intent.toLowerCase()) {
      // keep a tool hint if the earlier occurrence lacked one
      if (!prev.toolHint && s.toolHint) prev.toolHint = s.toolHint;
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/**
 * Distill a candidate skill from a just-completed task. Returns null when the task is too small to be
 * worth remembering (fewer than `minSteps` meaningful actions). The candidate starts UN-verified with
 * `seen: 1` — it has to recur to earn suggestability, so a single lucky run never becomes an offer.
 */
export function distillCandidate(
  intent: string,
  actions: CompletedAction[],
  policy: SkillLearningPolicy = DEFAULT_SKILL_POLICY,
  now: Date = new Date(),
): LearnedSkill | null {
  const steps = dedupeSteps(
    (actions ?? [])
      .map((a) => ({ intent: clean(a?.intent), toolHint: cleanTool(a?.tool) || undefined }))
      .filter((s) => s.intent),
  );
  if (steps.length < policy.minSteps) return null;

  const trigger = playbookTriggerSlug(intent || steps[0].intent);
  return {
    title: titleFromIntent(intent || steps[0].intent),
    trigger,
    steps,
    verified: false,
    accept: 0,
    seen: 1,
    lastSeenAt: now.toISOString(),
  };
}

/**
 * Fold a fresh observation of a task-pattern into what we already knew (pure — never mutates its
 * inputs). Same trigger as a known skill → its step shape is refreshed (tasks drift over time) and its
 * `seen` count grows. New trigger → the candidate stands on its own. This is the reinforcement that lets
 * a recurring task accumulate evidence toward promotion.
 */
export function observeCompletion(
  prior: LearnedSkill | null | undefined,
  fresh: LearnedSkill,
  now: Date = new Date(),
): LearnedSkill {
  if (!prior || prior.trigger !== fresh.trigger) {
    return { ...fresh, seen: Math.max(1, fresh.seen || 1), lastSeenAt: now.toISOString() };
  }
  return {
    ...prior,
    title: prior.title || fresh.title,
    steps: fresh.steps.length ? fresh.steps : prior.steps, // keep the most recent shape of the task
    seen: (prior.seen || 0) + 1,
    lastSeenAt: now.toISOString(),
  };
}

/**
 * Whether a candidate has earned suggestability: it recurred enough on its own (`seen`), or the user
 * explicitly approved running it (`accept`). Already-verified skills stay verified. This IS the trust
 * gate — nothing a candidate does before this returns true will ever surface it to the user.
 */
export function shouldPromote(skill: LearnedSkill, policy: SkillLearningPolicy = DEFAULT_SKILL_POLICY): boolean {
  if (skill.verified) return true;
  return (skill.seen ?? 0) >= policy.promoteAfterSeen || (skill.accept ?? 0) >= policy.promoteAfterAccept;
}

/** Apply promotion (pure): flip `verified` on once the skill qualifies, otherwise return it unchanged. */
export function promote(skill: LearnedSkill, policy: SkillLearningPolicy = DEFAULT_SKILL_POLICY): LearnedSkill {
  return !skill.verified && shouldPromote(skill, policy) ? { ...skill, verified: true } : skill;
}

/**
 * An un-promoted candidate that hasn't recurred within the decay window is forgotten, so speculative
 * one-offs don't accumulate forever. Verified skills never decay here — they've already proven useful.
 */
export function isStale(
  skill: LearnedSkill,
  policy: SkillLearningPolicy = DEFAULT_SKILL_POLICY,
  now: Date = new Date(),
): boolean {
  if (skill.verified) return false;
  if (!skill.lastSeenAt) return false;
  const last = new Date(skill.lastSeenAt).getTime();
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last > policy.decayAfterDays * DAY_MS;
}

/**
 * Compose the agent's total skill context for a turn: the STATIC surface skills (skills.ts — what the
 * surface you're working in calls for) plus the LEARNED, verified skills relevant to the task. Surface
 * skills frame HOW to work here; learned skills offer WHAT worked before. Kept as two blocks so each
 * reads clearly, and unverified candidates are filtered out so only earned skills are ever suggested.
 */
export function composeSkillContext(surface: SurfaceContext, learned: LearnedSkill[] = []): string {
  const surfaceBlock = skillPromptForSurface(surface);
  const earned = learned.filter((s) => s.verified);
  const learnedBlock = formatProceduresBlock(earned);
  return [surfaceBlock, learnedBlock].filter(Boolean).join('\n\n');
}
