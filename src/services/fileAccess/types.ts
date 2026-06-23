// File access (Workshop model) — shared types. See docs/agent-file-access-design.md.
// The agent proposes file work by emitting a ```file-op JSON block; the consent layer decides whether
// it auto-applies (the agent's own workspace) or needs the user to approve the actual change.

export type FileOpAction =
  | 'write'    // create or overwrite a text file
  | 'create'   // alias of write (new file)
  | 'delete'   // remove a file/folder
  | 'move'     // rename/move
  | 'import'   // copy an external file INTO the workspace
  | 'read'     // read a file's contents
  | 'list'     // list a directory
  | 'command'; // run a shell/git command (Developer Mode only)

/** The structured intent the agent emits inside a ```file-op block. */
export interface FileOp {
  action: FileOpAction;
  /** Target path — workspace-relative (no leading "/") or an absolute real-filesystem path. */
  path?: string;
  /** New file contents (write/create). */
  content?: string;
  /** Destination (move) or import target name. */
  to?: string;
  /** Absolute source path (import). */
  source?: string;
  /** Shell command (command). */
  command?: string;
  /** Working directory for the command (absolute). */
  cwd?: string;
  /** One-line, human-readable description of why — shown on the card. */
  summary?: string;
}

/** Which consent lane an op falls into. */
export type OpTier =
  | 'workspace' // inside ~/AgentForge/workspace → the agent's desk, auto-applies
  | 'external'  // touches the real filesystem → consent card, remembered grants
  | 'command'   // shell execution → Developer Mode + command card
  | 'invalid';  // malformed op, never runs

export type GrantScope = 'once' | 'file' | 'folder';
// 'command' is a DISTINCT authority from file 'write': granting file-write in a repo must not also
// authorize arbitrary shell execution there (SEC-GRANTS).
export type GrantEffect = 'read' | 'write' | 'command';

/** A standing permission the user gave for a real-filesystem path. `once` grants are never stored. */
export interface FileGrant {
  path: string;       // absolute file or folder path
  scope: GrantScope;  // 'file' = this exact path, 'folder' = this path and anything under it
  effect: GrantEffect;
  grantedAt: number;
  /** Epoch ms after which the grant is ignored. Undefined = no expiry. Command grants set this so
   *  standing shell authority can't last forever. */
  expiresAt?: number;
}

/** A receipt for the activity log. */
export interface FileActivityEntry {
  id: string;
  action: FileOpAction;
  path: string;
  tier: OpTier;
  ok: boolean;
  detail?: string;
  at: number;
}
