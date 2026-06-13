// Trust & provenance model (agent-capabilities-design.md §3).
// Every piece of context an agent sees carries a trust tier so the three hard rules are
// machine-checkable rather than prompt-hoped:
//   1. Untrusted content is DATA, never instructions (wrapped in a labeled delimiter on the way in).
//   2. `authority` actions are never driven solely by untrusted content.
//   3. Memory derived from untrusted content is provenance-tagged + quarantined.
import type { OmniTab } from '../types/omniTab';

export type TrustTier = 'trusted-local' | 'untrusted-external';

export interface Provenance {
  trust: TrustTier;
  source: 'user' | 'file' | 'web' | 'mail' | 'calendar' | 'mixed';
  sourceUrls?: string[];
  sourcePaths?: string[];
  surfaceId?: string; // the OmniTab.id / Space.id it came from
  capturedAt: number;
}

// Web pages in the browser-panel are attacker-influençable; every other surface in the workspace
// (docs, canvas, tools, the user's own chat) originates from the user and is trusted-local.
export const trustOfTab = (t: OmniTab): TrustTier =>
  t.type === 'web' ? 'untrusted-external' : 'trusted-local';
