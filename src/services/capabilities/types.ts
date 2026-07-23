// Agent capability model (design: docs/agent-capabilities-design.md §4).
// A Capability is a self-describing unit the agent can invoke. The gatekeeper still decides WHICH
// route to take; the registry turns that route into an executable capability, scoped to what's open
// in the active Space/DM. Phase 1 wraps the four built-in tools with no behavior change.
import type { ToolRoute } from '../memoryGatekeeper';
import type { OmniTab, OmniTabType } from '../../types/omniTab';

export interface CapabilitySource {
  title: string;
  url?: string;
  path?: string;
  snippet?: string;
}

/** How the tool-call status chip is finalized once the capability returns. */
export type CapabilityStatus =
  | { type: 'replace'; content: string } // swap the chip for a final summary (Web Search / Browse)
  | { type: 'remove' }; // fade the chip out after a beat (Knowledge Search / Calendar)

export interface CapabilityResult {
  /** Folded into the user message in the LLM payload only — never stored in chat. */
  toolData: string;
  /** Sources to surface on the bot reply. */
  sources: CapabilitySource[];
  /** Final disposition of the status chip. */
  status: CapabilityStatus;
}

/** Per-request execution context, snapshotted at the start of the request. */
export interface CapabilityContext {
  userMsg: any;
  chatId: string;
  agentId: string | null;
  assistant: any;
  hwProfile: any;
  integrations: any;
  model: any;
  signal?: AbortSignal;
  /** Tabs open in the active Space/DM — the basis for surface scoping (G2). */
  openTabs: OmniTab[];
  /** Live-update the status chip while the capability runs (e.g. browse progress). */
  setStatus: (label: string) => void;
}

export interface Capability {
  id: string;
  /** User-facing tool label. Matches the legacy `toolUsed` strings for parity. */
  title: string;
  description: string;
  /** read = no side effects · write = local mutation · authority = external/irreversible (§3 rule 2). */
  effect: 'read' | 'write' | 'authority';
  /** Open-tab kinds that make this capability available. '*' = always available. */
  surfaces: OmniTabType[] | '*';
  /** Gatekeeper routes this capability satisfies. */
  routes: ToolRoute[];
  /** Optional finer availability gate beyond `surfaces`. */
  isAvailable?: (ctx: CapabilityContext) => boolean;
  execute: (ctx: CapabilityContext) => Promise<CapabilityResult>;
}
