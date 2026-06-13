// Capability registry (design: docs/agent-capabilities-design.md §4).
// `registerCapability` is the single extension point — anything the user builds becomes usable by
// agents with one call here (and, for new commands, the auto-generated allow-app-local ACL).
import type { Capability, CapabilityContext } from './types';
import type { ToolRoute } from '../memoryGatekeeper';

const REGISTRY = new Map<string, Capability>();

export function registerCapability(cap: Capability): void {
  REGISTRY.set(cap.id, cap);
}

export function allCapabilities(): Capability[] {
  return [...REGISTRY.values()];
}

function surfaceMatches(cap: Capability, ctx: CapabilityContext): boolean {
  if (cap.surfaces === '*') return true;
  return ctx.openTabs.some(t => (cap.surfaces as string[]).includes(t.type));
}

/** Capabilities available given what's open in the active Space/DM (the consent boundary, G2). */
export function availableCapabilities(ctx: CapabilityContext): Capability[] {
  return allCapabilities().filter(
    cap => surfaceMatches(cap, ctx) && (cap.isAvailable?.(ctx) ?? true),
  );
}

/** Resolve the gatekeeper's chosen route to an available capability (or null). */
export function capabilityForRoute(
  route: ToolRoute | null,
  ctx: CapabilityContext,
): Capability | null {
  if (!route || route === 'none') return null;
  return availableCapabilities(ctx).find(cap => cap.routes.includes(route)) ?? null;
}
