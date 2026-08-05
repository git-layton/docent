import re

with open("src/services/appliedMemory.ts", "r") as f:
    content = f.read()

# Imports
if "useSettingsStore" not in content:
    content = content.replace(
        "import { invoke } from '@tauri-apps/api/core';",
        "import { invoke } from '@tauri-apps/api/core';\nimport { useSettingsStore } from '../store/useSettingsStore';\nimport { useSpaceStore } from '../store/useSpaceStore';"
    )

# 1. buildPlaybookRecord
content = content.replace(
    "  const agentId = String(input.agentId || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'default';",
    """  const agentId = String(input.agentId || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'default';
  const scopeEnabled = useSettingsStore.getState().appSettings.memoryScopeEnabled;
  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = scopeEnabled
    ? `${input.rootPath}/memory/spaces/${spaceId}/playbooks/${trigger}.md`
    : `${input.rootPath}/memory/${agentId}/playbooks/${trigger}.md`;"""
)
content = content.replace(
    "  const path = `${input.rootPath}/memory/${agentId}/playbooks/${trigger}.md`;",
    ""
)

# 2. retrievePlaybooks
content = content.replace(
    "      query: q, agentId: agentId ?? null, maxResults: 6, snippetChars: 60,",
    """      query: q, agentId: agentId ?? null,
      spaceId: useSettingsStore.getState().appSettings.memoryScopeEnabled ? useSpaceStore.getState().activeSpaceId || null : null,
      maxResults: 6, snippetChars: 60,"""
)

# 3. listPlaybooks
content = content.replace(
    "    const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', { agentId: aid }).catch(() => ({ files: [] }));",
    """    const scopeEnabled = useSettingsStore.getState().appSettings.memoryScopeEnabled;
    const spaceId = useSpaceStore.getState().activeSpaceId || null;
    const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', { agentId: aid, spaceId: scopeEnabled ? spaceId : undefined }).catch(() => ({ files: [] }));"""
)

# 4. reinforcePlaybook
content = content.replace(
    "  const aid = String(agentId || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'default';",
    """  const aid = String(agentId || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'default';
  const scopeEnabled = useSettingsStore.getState().appSettings.memoryScopeEnabled;
  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = scopeEnabled
    ? `${rootPath}/memory/spaces/${spaceId}/playbooks/${slug}.md`
    : `${rootPath}/memory/${aid}/playbooks/${slug}.md`;"""
)
content = content.replace(
    "  const path = `${rootPath}/memory/${aid}/playbooks/${slug}.md`;",
    ""
)

with open("src/services/appliedMemory.ts", "w") as f:
    f.write(content)
