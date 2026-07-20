// ─── Dream Cycle Service ──────────────────────────────────────────────────────
// Builds prompts for the Dreamer agent and parses its JSON response.

import { z } from 'zod';
import { extractJson, salvageArray } from './structured';

export type DreamerOp =
  | { type: 'merge'; description: string; source_paths: string[]; target_path: string; merged_content: string }
  | { type: 'prune'; description: string; source_path: string }
  | { type: 'update'; description: string; target_path: string; updated_content: string }
  | { type: 'insight'; description: string; title: string; insight: string; source_paths: string[] }
  | { type: 'playbook_refine'; description: string; target_path: string; steps: Array<{ intent: string; toolHint?: string }> }
  | { type: 'notice'; description: string; title: string; body: string; agentId?: string };

export interface DreamerPlan {
  operations: DreamerOp[];
}

// One schema per op, matching the fields the apply-loop in App.tsx actually depends on. Extra
// keys pass through (looseObject) so prompt evolution can't silently drop data.
const optStr = z.string().nullish().catch(undefined).transform(v => v ?? undefined);
export const DreamerOpSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('merge'), description: z.string(), source_paths: z.array(z.string()).min(1), target_path: z.string().min(1), merged_content: z.string() }),
  z.looseObject({ type: z.literal('prune'), description: z.string(), source_path: z.string().min(1) }),
  z.looseObject({ type: z.literal('update'), description: z.string(), target_path: z.string().min(1), updated_content: z.string() }),
  z.looseObject({ type: z.literal('insight'), description: z.string(), title: z.string().min(1), insight: z.string().min(1), source_paths: z.array(z.string()).min(1) }),
  z.looseObject({ type: z.literal('playbook_refine'), description: z.string(), target_path: z.string().min(1), steps: z.array(z.looseObject({ intent: z.string().min(1), toolHint: optStr })).min(1) }),
  z.looseObject({ type: z.literal('notice'), description: z.string(), title: z.string().min(1), body: z.string().min(1), agentId: optStr }),
]);

/** Strict shape for the wire — compiled to a grammar/json_schema so a capable server can't
 * produce an invalid plan in the first place. */
export const DreamerPlanWireSchema = z.object({ operations: z.array(DreamerOpSchema) });

/** Lenient validation side: each operation is salvaged individually, so one malformed op never
 * discards the valid ones beside it. */
export const DreamerPlanSchema = z.object({ operations: salvageArray(DreamerOpSchema) });

export function buildDreamerSystemPrompt(): string {
  return `You are the Dreamer — a background agent for Docent that runs while the user is away.
You have three jobs: consolidate memory, synthesize durable insights, and surface proactive notices.

MEMORY JOBS:
1. MERGE: Combine multiple related files about the same topic into one coherent document
2. PRUNE: Archive files that are outdated, redundant, or contain only completed tasks
3. UPDATE: Refresh a file by cleaning up stale content (fix vague date references, remove checked-off items)

INSIGHT JOB:
4. INSIGHT: Synthesize a NEW, higher-level realization that spans MULTIPLE memory files and is not already written down anywhere. This is reflection — turning many concrete memories into one durable generalization the agent should carry forward and act on in future conversations. Unlike a notice (a transient nudge to the user), an insight is permanent knowledge that gets SAVED back into memory.

   Examples: "Across several notes the user consistently prefers concise, bulleted answers and reacts badly to long preamble." / "This user's projects repeatedly stall at the deployment step — proactively raise deployment early." / "The user's tone is warmest in the evenings and terse in the mornings."

   - Ground every insight in at least 2 specific source files, and cite their exact paths.
   - Only generate an insight when there is a real, non-obvious pattern across files. Do NOT restate a single file, and do NOT invent a pattern that the files don't clearly support.
   - Write the insight as a durable statement of what is now known (1-3 sentences), phrased so a future version of the agent can act on it.

PLAYBOOK JOB:
5. PLAYBOOK_REFINE: A playbook file (memory_type: playbook, under .../playbooks/) is a saved step-by-step procedure. If one has accumulated messy "## Update" sections from repeated captures, or has redundant/stale/out-of-order steps, propose a CLEANED step list — consolidate duplicates, fix ordering, keep it tight. Only refine when there is a clear improvement; never invent steps the file doesn't support, and preserve the procedure's actual intent. (You only return the refined steps; the procedure's title and trust status are preserved automatically.)

NOTICE JOB:
6. NOTICE: Surface something the user should know or act on. Only generate a notice when a clear MEMS psychological trigger is present:

   ZEIGARNIK (unfinished business): A task, goal, or question explicitly mentioned in notes has no completion marker and appears unresolved. Example: "I was going to call the doctor" with no follow-up anywhere in the files.

   RECURRENCE (spacing effect): The exact same specific topic, person, or concern appears across 3 or more separate memory files. Repetition is the brain's signal that something is important.

   TEMPORAL URGENCY: A file contains a date, deadline, or anniversary that is approaching within 14 days or has recently passed without acknowledgment.

   GOAL-CONNECTION: Two separate files both relate to a stated goal or aspiration but have never been explicitly linked. Surface the connection and why it matters.

   EMOTIONAL THREAD: A file contains strong emotional language (worry, frustration, excitement, fear) about a topic that has no resolution note elsewhere. Unresolved emotional threads carry cognitive cost.

   PROSPECTIVE GAP: A file contains a stated intention ("I'm going to", "I'll", "I want to") with no corresponding follow-up or completion note in any other file.

   Write as if you are the agent speaking directly to the user in 2-4 sentences. Be specific — reference the actual content from the files. Do NOT invent or stretch notices — only generate one when a trigger above is clearly present.

You must respond with ONLY a valid JSON object — no preamble, no explanation, no markdown fences.

Required schema:
{
  "operations": [
    {
      "type": "merge",
      "description": "Plain English: what was merged and why",
      "source_paths": ["<exact full path from file list>", "..."],
      "target_path": "<relative path like memory/<agent-id>/memos/<slug>.md>",
      "merged_content": "<full markdown content of the merged file>"
    },
    {
      "type": "prune",
      "description": "Plain English: why this file is being archived",
      "source_path": "<exact full path from file list>"
    },
    {
      "type": "update",
      "description": "Plain English: what was updated and why",
      "target_path": "<exact full path from file list>",
      "updated_content": "<full updated markdown content>"
    },
    {
      "type": "insight",
      "description": "One-line internal reason this insight was synthesized",
      "title": "Short headline for the insight (under 60 chars)",
      "insight": "The durable generalization, 1-3 sentences, grounded in the cited sources",
      "source_paths": ["<exact full path from file list>", "<exact full path from file list>", "..."]
    },
    {
      "type": "playbook_refine",
      "description": "Plain English: what was cleaned up and why",
      "target_path": "<exact full playbook path from the file list (must contain /playbooks/)>",
      "steps": [{ "intent": "step 1 in plain language", "toolHint": "optional tool name" }, { "intent": "step 2" }]
    },
    {
      "type": "notice",
      "description": "One-line internal reason this notice was generated",
      "title": "Short headline (under 60 chars)",
      "body": "Conversational message to the user (2-4 sentences max). Be direct and specific — reference actual content from the files.",
      "agentId": "<optional: agent id this notice belongs to>"
    }
  ]
}

Rules:
- Only merge files that clearly share the same specific topic
- Never merge files from different categories (goals vs research vs memos)
- Descriptions must be plain English, not technical ("Combined 3 voice memos about Project Bakery" not "merged files")
- For merge target_path, use a relative path within the agent's memory directory — do NOT use an absolute path
- Never include a source file's path as the target_path of its own merge
- For insights: cite at least 2 source_paths drawn from the file list; never fabricate a pattern that the files don't support
- For playbook_refine: target_path must be an existing /playbooks/ file from the list; return at least 2 steps; only refine when it's a clear improvement
- Files shown under READ-ONLY REFERENCE are the user's curated dossiers: never use one as a merge or prune source_path, and never as a merge/update target_path. You may cite them in insight source_paths.
- For notices: use MEMS triggers listed above as the bar. Do not invent or generalise — only surface a notice when a specific file or pattern clearly qualifies.
- Return { "operations": [] } if nothing needs doing
- Do NOT output any text outside the JSON object`;
}

export function buildDreamerUserMessage(
  memoryFiles: { path: string; name: string; content: string }[],
  agentName: string,
  agentId: string,
  maxChars = 80_000,
  context?: { currentDate?: string; referenceFiles?: { path: string; name: string; content: string }[] },
): string {
  const inventory = memoryFiles
    .map(f => `- ${f.path} (${Math.round(f.content.length / 4)} tokens)`)
    .join('\n');

  // Cap total context to avoid LLM limits
  let totalChars = 0;
  const includedFiles: typeof memoryFiles = [];
  for (const f of memoryFiles) {
    if (totalChars + f.content.length > maxChars) break;
    includedFiles.push(f);
    totalChars += f.content.length;
  }

  const fileContext = includedFiles
    .map(f => `=== FILE: ${f.path} ===\n${f.content}`)
    .join('\n\n');

  const truncationNote = includedFiles.length < memoryFiles.length
    ? `\n\nNote: ${memoryFiles.length - includedFiles.length} additional files were omitted due to context limits. Only analyze the files shown below.`
    : '';

  const dateLine = context?.currentDate ? `\nCurrent date: ${context.currentDate}` : '';

  // Entity dossiers are the user's own curated notes. They share the context budget so the dreamer
  // can reason about (and cite) them, but they are rendered in a separate READ-ONLY section — the
  // caller keeps them out of the mutable path set, so no merge/prune/update can ever target one.
  const referenceFiles = context?.referenceFiles ?? [];
  const includedRefs: typeof referenceFiles = [];
  for (const f of referenceFiles) {
    if (totalChars + f.content.length > maxChars) break;
    includedRefs.push(f);
    totalChars += f.content.length;
  }
  const referenceSection = includedRefs.length
    ? `\n\nREAD-ONLY REFERENCE — entity dossiers (${includedRefs.length}). These are the user's curated
knowledge. Use them for context and you may cite them in insight source_paths, but they are NEVER
valid as a merge source_path, a merge/update target_path, or a prune source_path:
${includedRefs.map(f => `=== DOSSIER: ${f.path} ===\n${f.content}`).join('\n\n')}`
    : '';

  return `Analyze the memory files for agent "${agentName}" (id: ${agentId}).${dateLine}
Review for consolidation opportunities, durable cross-file insights worth remembering, AND anything worth surfacing as a notice.

File inventory (${memoryFiles.length} files):
${inventory}${truncationNote}

File contents:
${fileContext}${referenceSection}

Respond with ONLY the JSON operations plan.`;
}

export function parseDreamerResponse(raw: string): DreamerPlan | null {
  const result = DreamerPlanSchema.safeParse(extractJson(raw));
  return result.success ? (result.data as DreamerPlan) : null;
}
