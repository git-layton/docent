import re

# 1. useSettingsStore.ts
with open("src/store/useSettingsStore.ts", "r") as f:
    content = f.read()

content = re.sub(r"\s*memoryScopeEnabled\??:\s*boolean;", "", content)
content = re.sub(r"\s*memoryScopeEnabled:\s*false,", "", content)

with open("src/store/useSettingsStore.ts", "w") as f:
    f.write(content)


# 2. App.tsx
with open("src/App.tsx", "r") as f:
    content = f.read()

content = content.replace("appSettings.memoryScopeEnabled ? activeSpace : undefined", "activeSpace || undefined")
content = content.replace("_appSettings.memoryScopeEnabled ? activeSpaceId : undefined", "activeSpaceId || undefined")

with open("src/App.tsx", "w") as f:
    f.write(content)


# 3. SpotlightBar.tsx
with open("src/components/SpotlightBar.tsx", "r") as f:
    content = f.read()

content = content.replace("useSettingsStore.getState().appSettings.memoryScopeEnabled ? useSpaceStore.getState().activeSpaceId : undefined", "useSpaceStore.getState().activeSpaceId || undefined")

# Remove unused useSettingsStore import if it's no longer needed (might still be needed for other things, leave it for now)

with open("src/components/SpotlightBar.tsx", "w") as f:
    f.write(content)


# 4. appliedMemory.ts
with open("src/services/appliedMemory.ts", "r") as f:
    content = f.read()

# buildPlaybookRecord
content = content.replace("""  const scopeEnabled = useSettingsStore.getState().appSettings.memoryScopeEnabled;
  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = scopeEnabled
    ? `${input.rootPath}/memory/spaces/${spaceId}/playbooks/${trigger}.md`
    : `${input.rootPath}/memory/${agentId}/playbooks/${trigger}.md`;""",
"""  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = `${input.rootPath}/memory/spaces/${spaceId}/playbooks/${trigger}.md`;""")

# retrievePlaybooks
content = content.replace("""      spaceId: useSettingsStore.getState().appSettings.memoryScopeEnabled ? useSpaceStore.getState().activeSpaceId || null : null,""",
"""      spaceId: useSpaceStore.getState().activeSpaceId || null,""")

# listPlaybooks
content = content.replace("""    const scopeEnabled = useSettingsStore.getState().appSettings.memoryScopeEnabled;
    const spaceId = useSpaceStore.getState().activeSpaceId || null;
    const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', { agentId: aid, spaceId: scopeEnabled ? spaceId : undefined }).catch(() => ({ files: [] }));""",
"""    const spaceId = useSpaceStore.getState().activeSpaceId || null;
    const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', { agentId: aid, spaceId: spaceId || undefined }).catch(() => ({ files: [] }));""")

# reinforcePlaybook
content = content.replace("""  const scopeEnabled = useSettingsStore.getState().appSettings.memoryScopeEnabled;
  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = scopeEnabled
    ? `${rootPath}/memory/spaces/${spaceId}/playbooks/${slug}.md`
    : `${rootPath}/memory/${aid}/playbooks/${slug}.md`;""",
"""  const spaceId = useSpaceStore.getState().activeSpaceId || 'space-home';
  const path = `${rootPath}/memory/spaces/${spaceId}/playbooks/${slug}.md`;""")

with open("src/services/appliedMemory.ts", "w") as f:
    f.write(content)


# 5. memoryGatekeeper.ts
with open("src/services/memoryGatekeeper.ts", "r") as f:
    content = f.read()

content = re.sub(r"\s*memoryScopeEnabled\??:\s*boolean;", "", content)

content = content.replace("""  if (input.memoryScopeEnabled) {
    const scopeId = input.decision.scope === 'global' ? 'space-home' : (input.decision.scope || input.spaceId || 'space-home');
    basePath = input.decision.destination === 'library'
      ? `${input.rootPath}/library`
      : `${input.rootPath}/memory/spaces/${scopeId}/gatekeeper`;
  }""", """  const scopeId = input.decision.scope === 'global' ? 'space-home' : (input.decision.scope || input.spaceId || 'space-home');
  basePath = input.decision.destination === 'library'
    ? `${input.rootPath}/library`
    : `${input.rootPath}/memory/spaces/${scopeId}/gatekeeper`;""")

content = content.replace("""    (input.memoryScopeEnabled) ? `scope: ${yamlString(input.decision.scope)}` : null,""",
"""    `scope: ${yamlString(input.decision.scope)}`,""")

with open("src/services/memoryGatekeeper.ts", "w") as f:
    f.write(content)

