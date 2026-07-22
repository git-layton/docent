import { invoke } from '@tauri-apps/api/core';
import { db } from './database';
import { extractAndWriteGraph, generateNodeId } from './graphEntityExtractor';
import { isEntityLabel } from './knowledgeLibrary';

/**
 * One-time repair of a graph that was built from the wrong things.
 *
 * The graph contained seven nodes, all typed `concept`, all labelled with a chat fragment — "Do it",
 * "Ok is it too late though" — and zero edges. Two independent causes, both now fixed upstream:
 * every saved memory minted a `concept` stub labelled with the first sentence of the user's message
 * (App.tsx), and the one path that extracted real entities silently wrote nothing whenever the model
 * call failed (graphEntityExtractor). Fixing the causes stops new junk; it does nothing about what
 * is already on disk, which is what this handles.
 *
 * Two steps, in order:
 *   1. Retype the stubs. `concept` shelves as a Topic, which is why utterances appear under Topics.
 *      A memory file is a note. Retyped, never deleted — the never-wipe policy applies to migrations
 *      (docs/agent-model-rollout.md), and the node's identity and edges are worth keeping.
 *   2. Back-fill. 22 saved web captures in memory/research/ produced no graph nodes at all because
 *      of the extractor bug. They are the richest content on disk — real page titles, real source
 *      URLs — so they are re-run through the now-correct extractor.
 *
 * Runs once, guarded by a version key. Failure is never fatal: this is a background improvement to
 * a knowledge base that works without it.
 */

const MIGRATION_KEY = 'graphMigrationVersion';
const CURRENT_VERSION = 2;

/** Bounded so a first run can't spend an unbounded number of model calls in one sitting. Anything
 *  left over is picked up by the next run, because completed work is detectable (the node exists). */
const MAX_BACKFILL_PER_RUN = 30;

interface GraphNodeRow {
  id: string;
  node_type: string;
  label: string;
  source_path?: string;
}

interface KnowledgeFile { path: string; name: string }

const isTauri = () => typeof window !== 'undefined' && !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);

/**
 * Step 1 — retype `memory-*` stubs from `concept` to `note`.
 * Returns how many were changed.
 */
async function retypeMemoryStubs(nodes: GraphNodeRow[]): Promise<number> {
  const stubs = nodes.filter(n => n.id.startsWith('memory-') && n.node_type === 'concept');
  let changed = 0;
  for (const n of stubs) {
    try {
      await invoke('update_graph_node', { id: n.id, nodeType: 'note' });
      changed++;
    } catch (e) {
      console.warn('[graphMigrations] retype failed for', n.id, e);
    }
  }
  return changed;
}

/**
 * Step 2 — feed knowledge files that have no graph node through the extractor.
 *
 * Skips anything already represented: re-running extraction over a file the graph already knows
 * about would spend a model call to learn nothing. Node ids are deterministic
 * (`generateNodeId('memory', path)`), so "already done" is a set lookup rather than bookkeeping.
 */
async function backfillFiles(
  existingIds: Set<string>,
  modelConfig: Record<string, unknown> | null,
): Promise<{ done: number; remaining: number }> {
  const listed = await Promise.all([
    invoke<{ files: KnowledgeFile[] }>('list_agent_memory_files', { agentId: 'default', spaceId: 'space-home' })
      .catch(() => ({ files: [] as KnowledgeFile[] })),
    invoke<{ files: KnowledgeFile[] }>('list_library_files').catch(() => ({ files: [] as KnowledgeFile[] })),
  ]);

  const seen = new Set<string>();
  const candidates: KnowledgeFile[] = [];
  for (const f of listed.flatMap(r => r.files ?? [])) {
    if (!f?.path || seen.has(f.path)) continue;
    seen.add(f.path);
    if (existingIds.has(generateNodeId('memory', f.path))) continue;
    candidates.push(f);
  }

  let done = 0;
  for (const f of candidates.slice(0, MAX_BACKFILL_PER_RUN)) {
    try {
      const read = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path: f.path })
        .catch(() => null);
      const content = read?.ok ? read.content : '';
      if (!content.trim()) continue;

      // Sequential on purpose. These are model calls against what may be a local model; running
      // them in parallel would contend for the same weights and make every one slower.
      await extractAndWriteGraph({
        text: content,
        sourceTitle: f.name || f.path.split('/').pop() || f.path,
        sourceNodeId: generateNodeId('memory', f.path),
        // Web captures carry a `source:` URL; everything else is a note. Matches how the shelves
        // route the same files (knowledgeLibrary.buildNoteItems).
        sourceNodeType: /^source:\s*["']?https?:\/\//im.test(content) ? 'page' : 'note',
        sourcePath: f.path,
        modelConfig: (modelConfig ?? {}) as Record<string, unknown>,
      });
      done++;
    } catch (e) {
      console.warn('[graphMigrations] backfill failed for', f.path, e);
    }
  }
  const remaining = Math.max(0, candidates.length - MAX_BACKFILL_PER_RUN);
  return { done, remaining };
}

export async function runGraphMigrations(modelConfig?: Record<string, unknown> | null): Promise<void> {
  if (!isTauri()) return;
  try {
    const version = await db.get(MIGRATION_KEY, 0);
    if (Number(version) >= CURRENT_VERSION) return;

    const graph = await invoke<{ nodes: GraphNodeRow[] }>('get_graph_full').catch(() => null);
    const nodes = graph?.nodes ?? [];

    const retyped = await retypeMemoryStubs(nodes);

    // Junk labels are reported, not deleted — the never-wipe policy holds, and a retyped stub on the
    // Notes shelf is harmless where the same text on Topics was not.
    const junk = nodes.filter(n => !isEntityLabel(n.label)).length;

    const existingIds = new Set(nodes.map(n => n.id));
    const { done: backfilled, remaining } = await backfillFiles(existingIds, modelConfig ?? null);

    if (remaining === 0) {
      await db.set(MIGRATION_KEY, CURRENT_VERSION);
    }
    console.info(`[graphMigrations] v${CURRENT_VERSION}: retyped ${retyped}, back-filled ${backfilled}, ${remaining} candidates remaining for next run, ${junk} legacy labels kept but reshelved`);
  } catch (e) {
    // Deliberately not re-thrown and the version key is NOT written, so a failed run retries next
    // launch rather than being silently marked done.
    console.warn('[graphMigrations] migration failed, will retry next launch:', e);
  }
}
