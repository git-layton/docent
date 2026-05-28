// ─── Dream Cycle Service ──────────────────────────────────────────────────────
// Builds prompts for the Dreamer agent and parses its JSON response.

export type DreamerOp =
  | { type: 'merge'; description: string; source_paths: string[]; target_path: string; merged_content: string }
  | { type: 'prune'; description: string; source_path: string }
  | { type: 'update'; description: string; target_path: string; updated_content: string };

export interface DreamerPlan {
  operations: DreamerOp[];
}

export function buildDreamerSystemPrompt(memoryPrefix = 'memory/<agent-id>/'): string {
  return `You are the Dreamer — a memory consolidation agent for Agent Forge.
Your job is to analyze a set of memory files and identify opportunities to:
1. MERGE: Combine multiple related files about the same topic into a single coherent document
2. PRUNE: Archive files that are outdated, redundant, or contain only completed tasks
3. UPDATE: Refresh a file by cleaning up stale content (fix vague date references, remove checked-off items)

You must respond with ONLY a valid JSON object — no preamble, no explanation, no markdown fences.

Required schema:
{
  "operations": [
    {
      "type": "merge",
      "description": "Plain English: what was merged and why",
      "source_paths": ["<exact full path from file list>", "..."],
      "target_path": "<relative path like ${memoryPrefix}memos/<slug>.md>",
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
    }
  ]
}

Rules:
- Only merge files that clearly share the same specific topic
- Never merge files from different categories (goals vs research vs memos)
- Preserve grounding. Do not remove or invent source_urls, source_paths, raw_path, capture_id, evidence_state, verification, confidence, or derived_from metadata.
- Merged or updated markdown must include a Grounding section that carries forward the original source paths and explains whether the result is user-provided, source-backed, capture-backed, agent-inferred, mixed, or unverified.
- Never upgrade verification or confidence unless the source text itself justifies it. If evidence conflicts, keep the conflict in an "Open Questions / Conflicts" section.
- Prune only when the durable information is already preserved in another file or is clearly obsolete.
- Descriptions must be plain English, not technical ("Combined 3 voice memos about Project Bakery" not "merged files")
- For merge target_path, use a relative path inside ${memoryPrefix} — do NOT use an absolute path
- Never include a source file's path as the target_path of its own merge
- Return { "operations": [] } if no consolidation is needed
- Do NOT output any text outside the JSON object`;
}

export function buildDreamerUserMessage(
  memoryFiles: { path: string; name: string; content: string }[],
  agentName: string,
  maxChars = 80_000,
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

  const context = includedFiles
    .map(f => `=== FILE: ${f.path} ===\n${f.content}`)
    .join('\n\n');

  const truncationNote = includedFiles.length < memoryFiles.length
    ? `\n\nNote: ${memoryFiles.length - includedFiles.length} additional files were omitted due to context limits. Only analyze the files shown below.`
    : '';

  return `Analyze the memory files for agent "${agentName}" and suggest consolidations.

File inventory (${memoryFiles.length} files):
${inventory}${truncationNote}

File contents:
${context}

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
