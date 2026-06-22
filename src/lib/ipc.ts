// ─────────────────────────────────────────────────────────────────────────────
// Typed Tauri IPC choke point.
//
// THE BUG CLASS THIS PREVENTS — snake_case ↔ camelCase arg binding.
//
// Tauri v2 takes the JS object you pass as the second arg to `invoke()` and maps
// its keys onto the Rust command's parameter names. The catch: Tauri converts
// Rust `snake_case` parameter names to `camelCase` on the JS side. So a Rust
// command declared as
//
//     #[tauri::command]
//     fn write_memory(path: String, commit_message: String, agent_id: Option<String>, ...) { … }
//
// must be called from JS with CAMELCASE keys:
//
//     invoke('write_memory', { path, commitMessage, agentId, … })   ✅ binds
//     invoke('write_memory', { path, commit_message, agent_id, … }) ❌ silently drops
//
// When you send `commit_message` (snake_case), Tauri does NOT find a matching
// param. For `Option<T>` params it binds `None`; for required params the call
// rejects. Either way it fails *silently at runtime* — TypeScript can't catch a
// loose `Record<string, unknown>`, so the bug ships. We had exactly this:
// contextEvaluator.ts / pageDigest.ts / SpotlightBar.tsx all passed
// `commit_message` / `agent_id` / `context_tokens` / `ram_state`, so every
// auto-saved memory committed as "manual / unknown / unknown" with no agent
// attribution.
//
// FIX: route every invoke through the typed wrappers below. The exported
// per-command functions take a camelCase argument object whose shape is checked
// by the compiler, then forward it verbatim. There is no place left to type a
// snake_case key. `tauriInvoke` is the single low-level choke point for
// commands that don't yet have a dedicated wrapper.
//
// NOTE: this only governs the JS→Rust *argument* keys. Values returned from Rust
// (serde_json) keep whatever case the Rust side serializes (often snake_case);
// those are typed on each function's return type below.
// ─────────────────────────────────────────────────────────────────────────────

import { invoke } from '@tauri-apps/api/core';

/**
 * The single low-level choke point over `@tauri-apps/api/core`'s `invoke`.
 *
 * Always pass **camelCase** keys in `args` — Tauri v2 maps a Rust `snake_case`
 * command parameter (`commit_message`) to its camelCase form (`commitMessage`)
 * on the JS side. Prefer the typed per-command wrappers in this file; reach for
 * `tauriInvoke` directly only for commands that don't have one yet.
 *
 * Rethrows whatever Tauri rejects with (string or Error) unchanged so callers
 * keep their existing `.catch()` / error-shaping logic.
 */
export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(cmd, args);
}

// ─── write_memory (the headline offender) ────────────────────────────────────

/** Result shape returned by the Rust `write_memory` command (serde_json). */
export interface WriteMemoryResult {
  blocked: boolean;
  conflict: boolean;
  /** Commit summary line (e.g. "[main abc1234] …") or null when nothing committed. */
  commit: string | null;
  prune_suggested: boolean;
  /** Present only on the blocked-by-nuke-shield path. */
  error?: string;
  deletions?: number;
  existing_lines?: number;
  diff_stat?: string;
}

/** camelCase argument shape for {@link writeMemory} — mirrors the Rust params. */
export interface WriteMemoryArgs {
  /** Absolute path (or knowledge-relative path) of the markdown file to write. */
  path: string;
  content: string;
  /** Maps to Rust `commit_message`. */
  commitMessage: string;
  /** Maps to Rust `agent_id`. Pass null for a manual/unattributed write. */
  agentId?: string | null;
  /** Maps to Rust `context_tokens`. */
  contextTokens?: number | null;
  /** Maps to Rust `ram_state`. */
  ramState?: string | null;
}

/**
 * Write (and git-commit) a Knowledge Core memory file.
 *
 * Sends CAMELCASE keys so Tauri binds every param correctly — `commitMessage`,
 * `agentId`, `contextTokens`, `ramState` (NOT `commit_message` / `agent_id` /
 * `context_tokens` / `ram_state`, which Tauri would silently drop).
 */
export function writeMemory(args: WriteMemoryArgs): Promise<WriteMemoryResult> {
  return tauriInvoke<WriteMemoryResult>('write_memory', {
    path: args.path,
    content: args.content,
    commitMessage: args.commitMessage,
    agentId: args.agentId ?? null,
    contextTokens: args.contextTokens ?? null,
    ramState: args.ramState ?? null,
  });
}

// ─── Sibling memory / Dream-Cycle commands used by the same four call sites ───

/** Result shape returned by the Rust `init_knowledge_core` command. */
export interface InitKnowledgeCoreResult {
  initialized: boolean;
  path: string;
}

/** Ensure the Knowledge Core git repo + subdirectories exist (idempotent). */
export function initKnowledgeCore(): Promise<InitKnowledgeCoreResult> {
  return tauriInvoke<InitKnowledgeCoreResult>('init_knowledge_core');
}

/**
 * Persist the Dream-Cycle log. Rust param is `log: serde_json::Value`, so the
 * single key is already lowercase — no camelCase trap here, but we keep it typed
 * and centralized for consistency.
 */
export function writeDreamLog(log: unknown): Promise<unknown> {
  return tauriInvoke<unknown>('write_dream_log', { log });
}

/**
 * Restore a previously-archived memory file to its original location.
 *
 * Rust params are `archive_path` / `original_path` → send `archivePath` /
 * `originalPath`. (The current App.tsx call site passes snake_case and so is
 * broken; a later phase swaps it to this wrapper.)
 */
/** Result shape returned by the Rust `restore_archived_file` command (serde_json). */
export interface RestoreArchivedResult {
  ok: boolean;
  restored_path?: string;
  commit?: string | null;
  error?: string;
}

export function restoreArchivedFile(args: {
  archivePath: string;
  originalPath: string;
}): Promise<RestoreArchivedResult> {
  return tauriInvoke<RestoreArchivedResult>('restore_archived_file', {
    archivePath: args.archivePath,
    originalPath: args.originalPath,
  });
}

/** Delete a memory file by path. Rust param is `path` — no remapping needed. */
export function deleteMemoryFile(path: string): Promise<unknown> {
  return tauriInvoke<unknown>('delete_memory_file', { path });
}

/**
 * Revert a memory git commit. Rust param is `commit_hash` → send `commitHash`.
 */
export function revertMemoryCommit(commitHash: string): Promise<unknown> {
  return tauriInvoke<unknown>('revert_memory_commit', { commitHash });
}

/** Roll a file back to its last committed state. Rust param is `path`. */
export function rollbackFile(path: string): Promise<unknown> {
  return tauriInvoke<unknown>('rollback_file', { path });
}
