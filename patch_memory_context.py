import re

with open("src/services/memoryContext.ts", "r") as f:
    content = f.read()

# Update loadMemorySummary signature
content = content.replace(
    "export async function loadMemorySummary(agentId: string | null | undefined): Promise<string> {",
    "export async function loadMemorySummary(agentId: string | null | undefined, spaceId?: string | null): Promise<string> {"
)

# Update _tier1 cache key
content = content.replace(
    "let _tier1: { agentId: string; at: number; text: string } | null = null;",
    "let _tier1: { agentId: string; spaceId: string | null; at: number; text: string } | null = null;"
)

content = content.replace(
    "  if (_tier1 && _tier1.agentId === agentId && _now() - _tier1.at < 120_000) return _tier1.text;",
    "  if (_tier1 && _tier1.agentId === agentId && _tier1.spaceId === (spaceId || null) && _now() - _tier1.at < 120_000) return _tier1.text;"
)

content = content.replace(
    "    const listed = await invoke<{ files: MemFile[] }>('list_agent_memory_files', { agentId });",
    "    const listed = await invoke<{ files: MemFile[] }>('list_agent_memory_files', { agentId, spaceId });"
)

content = content.replace(
    "    _tier1 = { agentId, at: _now(), text };",
    "    _tier1 = { agentId, spaceId: spaceId || null, at: _now(), text };"
)

# Update retrieveRelevantMemory signature
content = content.replace(
    "export async function retrieveRelevantMemory(query: string, agentId: string | null | undefined): Promise<{ text: string; hits: RagHit[] }> {",
    "export async function retrieveRelevantMemory(query: string, agentId: string | null | undefined, spaceId?: string | null): Promise<{ text: string; hits: RagHit[] }> {"
)

content = content.replace(
    "      query: q, agentId: agentId ?? null, maxResults: 8, snippetChars: 400,",
    "      query: q, agentId: agentId ?? null, spaceId: spaceId ?? null, maxResults: 8, snippetChars: 400,"
)

with open("src/services/memoryContext.ts", "w") as f:
    f.write(content)
