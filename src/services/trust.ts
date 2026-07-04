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

// The tool panels the docked agent can read on screen (see useToolContextStore). Inbound comms —
// mail and messages — carry content the user RECEIVED from others, so they're attacker-influençable
// (anyone can email/text you) and must be fenced as untrusted-external DATA, never instructions
// (§3 rule 1). The user's own tools (notes, calendar, tasks) are trusted-local. An untagged snapshot
// defaults to trusted-local — only the inbound surfaces opt into the untrusted fence.
// `screen` = on-device OCR of whatever app is frontmost. It can be a web page, someone else's
// message, any app — wholly attacker-influençable — so it fences as untrusted-external, same as
// inbound comms. (The overlay fences it inline today; this keeps the buildSystemPrompt path correct
// when the sidecar routes screen context through toolContext.)
export type ToolContextSource = 'mail' | 'messages' | 'notes' | 'calendar' | 'tasks' | 'screen' | 'mcp';

export const trustOfToolSource = (source?: ToolContextSource): TrustTier =>
  source === 'mail' || source === 'messages' || source === 'screen' || source === 'mcp' ? 'untrusted-external' : 'trusted-local';
