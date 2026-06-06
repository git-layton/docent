// ─── Dream Cycle Service ──────────────────────────────────────────────────────
// Builds prompts for the Dreamer agent and parses its JSON response.

export type DreamerOp =
  | { type: 'merge'; description: string; source_paths: string[]; target_path: string; merged_content: string }
  | { type: 'prune'; description: string; source_path: string }
  | { type: 'update'; description: string; target_path: string; updated_content: string }
  | { type: 'notice'; description: string; title: string; body: string; agentId?: string };

export interface DreamerPlan {
  operations: DreamerOp[];
}

export function buildDreamerSystemPrompt(): string {
  return `You are the Dreamer — a background agent for Agent Forge that runs while the user is away.
You have two jobs: consolidate memory and surface proactive insights.

MEMORY JOBS:
1. MERGE: Combine multiple related files about the same topic into one coherent document
2. PRUNE: Archive files that are outdated, redundant, or contain only completed tasks
3. UPDATE: Refresh a file by cleaning up stale content (fix vague date references, remove checked-off items)

NOTICE JOB:
4. NOTICE: Surface something the user should know or act on — an unresolved thread, a pattern across notes, a follow-up that seems overdue, a connection between two things. Write as if you are the agent speaking directly to the user in a short, conversational message. Only create notices for things genuinely worth the user's attention.

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
- For notices: only surface things that are genuinely actionable or surprising. Do not invent notices if nothing stands out.
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
Review for consolidation opportunities AND anything worth surfacing as a notice.

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
