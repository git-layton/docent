// ─── Dream Cycle Service ──────────────────────────────────────────────────────
// Builds prompts for the Dreamer agent and parses its JSON response.

export type DreamerOp =
  | { type: 'merge'; description: string; source_paths: string[]; target_path: string; merged_content: string }
  | { type: 'prune'; description: string; source_path: string }
  | { type: 'update'; description: string; target_path: string; updated_content: string }
  | { type: 'insight'; description: string; title: string; insight: string; source_paths: string[] }
  | { type: 'notice'; description: string; title: string; body: string; agentId?: string };

export interface DreamerPlan {
  operations: DreamerOp[];
}

export function buildDreamerSystemPrompt(): string {
  return `You are the Dreamer — a background agent for Agent Forge that runs while the user is away.
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

NOTICE JOB:
5. NOTICE: Surface something the user should know or act on. Only generate a notice when a clear MEMS psychological trigger is present:

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
- For notices: use MEMS triggers listed above as the bar. Do not invent or generalise — only surface a notice when a specific file or pattern clearly qualifies.
- Return { "operations": [] } if nothing needs doing
- Do NOT output any text outside the JSON object`;
}

export function buildDreamerUserMessage(
  memoryFiles: { path: string; name: string; content: string }[],
  agentName: string,
  agentId: string,
  maxChars = 80_000,
  context?: { currentDate?: string },
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

  return `Analyze the memory files for agent "${agentName}" (id: ${agentId}).${dateLine}
Review for consolidation opportunities, durable cross-file insights worth remembering, AND anything worth surfacing as a notice.

File inventory (${memoryFiles.length} files):
${inventory}${truncationNote}

File contents:
${fileContext}

Respond with ONLY the JSON operations plan.`;
}

export function parseDreamerResponse(raw: string): DreamerPlan | null {
  let cleaned = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find JSON object bounds (handles preamble text)
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) return null;
  cleaned = cleaned.slice(jsonStart, jsonEnd + 1);

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.operations)) return null;
    return parsed as DreamerPlan;
  } catch {
    return null;
  }
}
