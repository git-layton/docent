// Screen Recall — search the screen log. "What was I looking at earlier?"
//
// This is the log's tier-1 read path (docs/concept-canvas-design.md §The screen log): mechanical
// term matching with a recency lean, NO model in the loop. It works with no model configured at
// all, which is the point of a local-first log.
//
// Registering it here is what makes the log "usable and understandable by the AI" — the Capability
// contract is self-describing (title + description), effect-classified, and surface-scoped, so the
// agent gets the log through exactly the same audited path as every other tool rather than through
// a bespoke side channel.
//
// `effect: 'read'` is load-bearing: recall never mutates the log and never captures. Capture is a
// separate, user-controlled loop — the agent can ASK what was seen, never decide to start watching.
import type { Capability, CapabilityContext, CapabilityResult, CapabilitySource } from '../types';
import { loadEntries } from '../../screenLogStore';
import { recall } from '../../screenLog';

/** Keep the injected payload small — a screen log can be large and local models cannot afford it. */
const MAX_HITS = 6;
const SNIPPET_CHARS = 320;

export const screenRecallCapability: Capability = {
  id: 'screen-recall',
  title: 'Screen Recall',
  description:
    'Search what was previously on screen — apps, window titles and recognised text — to answer ' +
    '"what was I looking at earlier?". Reads the local screen log only; never captures.',
  effect: 'read',
  surfaces: '*',
  routes: ['screen_recall'],
  async execute(ctx: CapabilityContext): Promise<CapabilityResult> {
    const sources: CapabilitySource[] = [];
    const query = String(ctx.userMsg?.content ?? '')
      .replace(/^\[PLANNING MODE[^\]]*\]\n+/i, '')
      .trim();

    try {
      const entries = await loadEntries();

      if (entries.length === 0) {
        return {
          toolData:
            '\n\n[SYSTEM NOTE: SCREEN RECALL]\nThe screen log is empty — nothing has been recorded yet. ' +
            'Say so plainly rather than guessing what the user might have been looking at.\n[END RECALL]',
          sources: [],
          status: { type: 'remove' },
        };
      }

      const hits = recall(entries, query, Date.now(), MAX_HITS);

      if (hits.length === 0) {
        return {
          toolData:
            `\n\n[SYSTEM NOTE: SCREEN RECALL]\nNothing in the screen log matches that. ` +
            `${entries.length} entries are recorded, but none mention it — say so rather than ` +
            `inventing what was on screen.\n[END RECALL]`,
          sources: [],
          status: { type: 'remove' },
        };
      }

      const lines = hits.map((h, i) => {
        const when = new Date(h.entry.seenAt).toLocaleString();
        const snippet = h.entry.text.slice(0, SNIPPET_CHARS);
        sources.push({
          title: h.entry.windowTitle ? `${h.entry.app} — ${h.entry.windowTitle}` : h.entry.app,
          snippet,
        });
        return `[${i + 1}] ${h.entry.app}${h.entry.windowTitle ? ` — ${h.entry.windowTitle}` : ''} (${when})\n${snippet}`;
      });

      // The provenance rule, restated at the point of use. This text is `observed`: it is evidence
      // of what the user LOOKED AT, never evidence that the content is true. Without this the model
      // will happily cite a page it saw in the log as though the user had vouched for it.
      const toolData =
        `\n\n[SYSTEM NOTE: SCREEN RECALL RESULTS]\n` +
        `These are records of what was ON THE USER'S SCREEN. They show what the user was looking ` +
        `at — they are NOT a source for whether any of it is true, and the user may not have read ` +
        `or agreed with any of it. Attribute accordingly ("you had X open", not "X is the case").\n\n` +
        `${lines.join('\n\n---\n\n')}\n[END RECALL]`;

      return { toolData, sources, status: { type: 'remove' } };
    } catch (e: any) {
      console.error('[screenRecall] failed:', e);
      return {
        toolData: `\n\n[SYSTEM NOTE: SCREEN RECALL FAILED]\nError: ${e?.message ?? String(e)}\n[END RECALL]`,
        sources: [],
        status: { type: 'remove' },
      };
    }
  },
};
