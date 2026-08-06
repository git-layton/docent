// ─── Space from a topic ───────────────────────────────────────────────────────
// "Make these their own Space." The manual counterpart to auto-suggesting a split.
//
// Why manual: an automatic suggestion is a guess about intent, and the skill-library
// research names the failure mode — "erosion", where over-eager governance destroys
// useful continuity faster than it accumulates. Nothing here splits anything unless
// the user says so, which sidesteps that entirely.
//
// COPY vs MOVE is the real decision, and it mirrors how a map works:
//   - COPY leaves the topic where it was and also seeds a Space. Right for concepts,
//     because a concept can legitimately sit in several places at once.
//   - MOVE takes it out of the original. Right for decluttering, and it is the
//     destructive one — so the caller records a receipt with an undo.
//
// The planning rules live here, pure, because they are the part with edge cases:
// which tabs may travel, what the Space should be called, and what the original
// Space is left holding. Mutation lives in useSpaceStore.

import type { OmniTab } from '../types/omniTab';

export type TransferMode = 'copy' | 'move';

export type SkipReason = 'home-tab' | 'not-found' | 'duplicate';

export interface TransferPlan {
  /** Tabs that will appear in the new Space, in the order requested. */
  take: OmniTab[];
  /** Tab ids to detach from their original Space. Empty for a copy. */
  remove: string[];
  /** Requested tabs that will not travel, and why — surfaced rather than silently dropped. */
  skipped: Array<{ id: string; reason: SkipReason }>;
}

/**
 * A Space's `home` tab is its dashboard, not content.
 *
 * Taking one is always wrong: on a copy it duplicates a dashboard that the new Space
 * creates for itself anyway, and on a move it strips the original Space of the tab that
 * makes it navigable. Skipped rather than rejected, so selecting "everything" still
 * does the sensible thing with the rest.
 */
const isTransferable = (tab: OmniTab): boolean => tab.type !== 'home';

export function planSpaceFromTabs(
  allTabs: readonly OmniTab[],
  tabIds: readonly string[],
  mode: TransferMode,
): TransferPlan {
  const byId = new Map((allTabs ?? []).map(t => [t.id, t]));
  const take: OmniTab[] = [];
  const skipped: TransferPlan['skipped'] = [];
  const seen = new Set<string>();

  for (const id of tabIds ?? []) {
    if (seen.has(id)) {
      skipped.push({ id, reason: 'duplicate' });
      continue;
    }
    seen.add(id);

    const tab = byId.get(id);
    if (!tab) {
      skipped.push({ id, reason: 'not-found' });
      continue;
    }
    if (!isTransferable(tab)) {
      skipped.push({ id, reason: 'home-tab' });
      continue;
    }
    take.push(tab);
  }

  return {
    take,
    remove: mode === 'move' ? take.map(t => t.id) : [],
    skipped,
  };
}

/**
 * Name the Space after what is going into it.
 *
 * One tab lends its label directly; several become "<first> +N". A generic fallback beats
 * an empty title, because an unnamed Space is unfindable and renaming is one click.
 */
export function nameFromTabs(tabs: readonly OmniTab[], fallback = 'New Space'): string {
  const labels = (tabs ?? []).map(t => String(t.label ?? '').trim()).filter(Boolean);
  if (labels.length === 0) return fallback;
  if (labels.length === 1) return labels[0].slice(0, 60);
  return `${labels[0].slice(0, 40)} +${labels.length - 1}`;
}

/**
 * Copies need their own tab identity, or the same tab would appear in two Spaces and any
 * update to one would silently change the other. Content references (`canvasContentId`,
 * `url`, `toolId`) are deliberately shared — copying a tab duplicates the VIEW, never the
 * document behind it.
 *
 * Pinning and favourite status are dropped: those are statements about a tab's place in a
 * particular Space, and they do not survive the journey.
 */
export function duplicateForSpace(tab: OmniTab, newId: string, spaceId: string): OmniTab {
  const { isPinned: _p, isFavorite: _f, ...rest } = tab;
  return { ...rest, id: newId, spaceId };
}

/** True when a move would leave the original Space with nothing but its dashboard. */
export function movesEverything(
  allTabs: readonly OmniTab[],
  sourceSpaceId: string | undefined,
  plan: TransferPlan,
): boolean {
  if (plan.remove.length === 0) return false;
  const remaining = (allTabs ?? []).filter(
    t => t.spaceId === sourceSpaceId && t.type !== 'home' && !plan.remove.includes(t.id),
  );
  return remaining.length === 0;
}
