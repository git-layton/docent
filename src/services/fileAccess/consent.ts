// File access consent logic — pure functions (no I/O), so they're trivially unit-tested.
// The rule: the agent's own workspace is frictionless; anything touching the real filesystem needs
// the user, shown the actual change, with optionally-remembered grants. See the design doc.
import type { FileOp, OpTier, GrantEffect, GrantScope, FileGrant } from './types';

/** Normalize trailing slashes for prefix comparisons. */
function trimSlash(p: string): string {
  return p.replace(/\/+$/, '');
}

/** Is this path inside the agent's workspace? Relative paths are workspace-by-definition. */
export function isWorkspacePath(path: string | undefined, workspaceRoot: string): boolean {
  if (!path) return true; // e.g. `list` with no path = workspace root
  if (!path.startsWith('/')) return true; // relative → resolved against the workspace jail
  const root = trimSlash(workspaceRoot);
  return path === root || path.startsWith(root + '/');
}

/** Which side effect an action has, for grant matching. */
export function effectOf(action: FileOp['action']): GrantEffect {
  return action === 'read' || action === 'list' ? 'read' : 'write';
}

/** Every real-filesystem path an op reads or writes (used to decide the tier). */
function involvedPaths(op: FileOp): string[] {
  switch (op.action) {
    case 'move':
      return [op.path, op.to].filter(Boolean) as string[];
    case 'import':
      // The destination is the workspace; the SOURCE is the external read that needs consent.
      return [op.source].filter(Boolean) as string[];
    default:
      return [op.path].filter(Boolean) as string[];
  }
}

/** Does the op carry the fields it needs to run? */
export function isValidOp(op: FileOp): boolean {
  switch (op?.action) {
    case 'write':
    case 'create':
      return typeof op.path === 'string' && op.path.length > 0 && typeof op.content === 'string';
    case 'delete':
    case 'read':
      return typeof op.path === 'string' && op.path.length > 0;
    case 'list':
      return true;
    case 'move':
      return !!op.path && !!op.to;
    case 'import':
      return !!op.source && !!op.to;
    case 'command':
      return typeof op.command === 'string' && op.command.trim().length > 0;
    default:
      return false;
  }
}

/** A relative path that climbs out with ".." is malformed — the agent must use an absolute path to
 * reach outside the workspace (so the user sees and consents to the real target). */
function isRelativeEscape(p: string | undefined): boolean {
  if (!p || p.startsWith('/')) return false;
  return p.split('/').includes('..');
}

/** Classify an op into a consent lane. */
export function classifyOp(op: FileOp, workspaceRoot: string): OpTier {
  if (!op || !isValidOp(op)) return 'invalid';
  if ([op.path, op.to, op.source].some(isRelativeEscape)) return 'invalid';
  if (op.action === 'command') return 'command';
  const external = involvedPaths(op).some(p => !isWorkspacePath(p, workspaceRoot));
  return external ? 'external' : 'workspace';
}

// ─── Remembered grants ────────────────────────────────────────────────────────

/** Find a standing grant covering this path+effect (exact file, or an ancestor folder grant). */
export function findGrant(
  grants: Record<string, FileGrant> | undefined,
  path: string,
  effect: GrantEffect,
): FileGrant | null {
  if (!grants || !path) return null;
  const target = trimSlash(path);
  for (const g of Object.values(grants)) {
    if (g.effect !== effect && !(effect === 'read' && g.effect === 'write')) continue; // write grant implies read
    const gp = trimSlash(g.path);
    if (g.scope === 'file' && gp === target) return g;
    if (g.scope === 'folder' && (target === gp || target.startsWith(gp + '/'))) return g;
  }
  return null;
}

/** Build a grant record + the key it should be stored under. `once` scope is never persisted. */
export function makeGrant(path: string, scope: GrantScope, effect: GrantEffect, now: number): FileGrant {
  return { path: trimSlash(path), scope, effect, grantedAt: now };
}

export function grantKey(grant: FileGrant): string {
  return `${grant.scope}:${grant.effect}:${grant.path}`;
}

/** True when an op can run without prompting: it's a workspace op, or a remembered grant covers it. */
export function isPreapproved(
  op: FileOp,
  workspaceRoot: string,
  grants: Record<string, FileGrant> | undefined,
): boolean {
  const tier = classifyOp(op, workspaceRoot);
  if (tier === 'workspace') return true;
  if (tier !== 'external') return false; // command always prompts
  const effect = effectOf(op.action);
  return involvedPaths(op).every(p => findGrant(grants, p, effect) !== null);
}
