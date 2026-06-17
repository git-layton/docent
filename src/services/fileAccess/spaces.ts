// Per-space workspace home. Each Space gets its own subfolder under the agent-workspace jail
// (~/AgentForge/workspace/spaces/<spaceId>/), so a space's files — plans, notes, drafts, code — stay
// separate from other spaces' (a space ≈ a project). The path is jail-RELATIVE (no leading slash), so
// it composes with the existing fs_* commands and the consent classification with zero backend changes
// — `spaces/<id>/plan.md` is still a workspace-tier path. See docs/agentforge-code-design.md.

const SPACES_DIR = 'spaces';

/** Make a Space id safe to use as a single path segment. */
export function safeSpaceSegment(spaceId: string): string {
  const cleaned = (spaceId || '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'default';
}

/** The workspace-relative home folder for a space. Empty string ⇒ no active space ⇒ workspace root. */
export function spaceHome(spaceId: string | null | undefined): string {
  if (!spaceId) return '';
  return `${SPACES_DIR}/${safeSpaceSegment(spaceId)}`;
}

/** Join a space's home with a relative subpath inside it (used to scope writes/imports into the space).
 * Idempotent: a path already under the space home is returned unchanged (never double-prefixed) — so an
 * agent that re-emits a fully-qualified `spaces/<id>/…` path it saw in a listing can't get it nested twice. */
export function spacePath(spaceId: string | null | undefined, rel: string): string {
  const home = spaceHome(spaceId);
  const clean = (rel || '').replace(/^\/+/, '');
  if (!home) return clean;
  if (clean === home || clean.startsWith(home + '/')) return clean;
  return clean ? `${home}/${clean}` : home;
}

/** The per-space project-context file (`AGENTS.md`) — the agent's durable "how this project works"
 * memory, folded into the prompt every turn (P6 in the architecture doc §9 phase 2). User-authored,
 * so it's rendered TRUSTED-LOCAL (not fenced as untrusted). Jail-relative, like spaceHome. */
export function projectContextPath(spaceId: string | null | undefined): string {
  return spacePath(spaceId, 'AGENTS.md');
}

/** Seed contents written when a space has no AGENTS.md yet — lean and commented, so the user can edit
 * it without a blank page. Pure constant (no I/O); the create-if-missing write lives in the store. */
export const AGENTS_TEMPLATE = `# Project

<!-- One or two lines: what this project is, and what you (the agent) are helping build here. -->

## Build & test commands

<!-- The commands to build, run, and verify. The agent runs these to check its own work (P4). e.g.:
- Install:   npm install
- Dev:       npm run dev
- Test:      npm test
- Typecheck: npx tsc --noEmit
-->

## Conventions

<!-- House style the agent should follow: language/framework, formatting, file layout, naming. -->

## Gotchas

<!-- Anything non-obvious that trips people up. Keep this file short; prune it ruthlessly. -->
`;

/** Strip the space-home prefix from a workspace-relative path, for display — so the UI shows
 * `notes/plan.md`, not `spaces/<id>/notes/plan.md`. Returns the path unchanged if it isn't under home. */
export function relativeToSpace(spaceId: string | null | undefined, path: string): string {
  const home = spaceHome(spaceId);
  if (!home) return path;
  if (path === home) return '';
  return path.startsWith(home + '/') ? path.slice(home.length + 1) : path;
}

/** Resolve a file op's WORKSPACE-relative paths into the active space's home, so the agent's `file_op`
 * writes land in the same folder the human panel shows. Returns the op unchanged when no space is active.
 * - workspace write/read/move → prefix `path` (and `move`'s `to`);
 * - workspace no-path `list` → scope to the space home (NOT the workspace root, which holds OTHER spaces);
 * - `import` is external (its `source` is an outside file) but its `to` is a workspace-relative target NAME,
 *   so scope `to` to match the human panel's import; `source`/absolute paths are never touched.
 * `spacePath` is idempotent, so an already-scoped path is never double-prefixed. Pure (no I/O), unit-testable. */
export function resolveWorkspaceOpPaths<T extends { action: string; path?: string; to?: string; source?: string }>(
  op: T,
  tier: string,
  spaceId: string | null | undefined,
): T {
  if (!spaceId) return op;
  if (op.action === 'import') {
    return typeof op.to === 'string' ? { ...op, to: spacePath(spaceId, op.to) } : op;
  }
  if (tier !== 'workspace') return op;
  const next: T = { ...op };
  if (op.action === 'list') {
    next.path = spacePath(spaceId, op.path ?? '');
  } else if (typeof op.path === 'string') {
    next.path = spacePath(spaceId, op.path);
  }
  if (op.action === 'move' && typeof op.to === 'string') next.to = spacePath(spaceId, op.to);
  return next;
}
