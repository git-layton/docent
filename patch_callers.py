import re

with open("src/App.tsx", "r") as f:
    content = f.read()

# In App.tsx:
# const _memorySummary = await loadMemorySummary(_activeAssistant?.id);
# and
# const { text: _relevantMemory, hits: _memoryHits } = await retrieveRelevantMemory(chatQuery, _activeAssistant?.id);

# We need to get memoryScopeEnabled and the activeSpace id.
# App.tsx has useSettingsStore() and useSpaceStore() hooks ?
# Let's check how activeSpace is fetched in App.tsx.

content = content.replace(
    "const _memorySummary = await loadMemorySummary(_activeAssistant?.id);",
    "const appSettings = useSettingsStore.getState().appSettings;\n      const activeSpace = useSpaceStore.getState().activeSpaceId;\n      const _memorySummary = await loadMemorySummary(_activeAssistant?.id, appSettings.memoryScopeEnabled ? activeSpace : undefined);"
)

content = content.replace(
    "const { text: _relevantMemory, hits: _memoryHits } = await retrieveRelevantMemory(chatQuery, _activeAssistant?.id);",
    "const { text: _relevantMemory, hits: _memoryHits } = await retrieveRelevantMemory(chatQuery, _activeAssistant?.id, appSettings.memoryScopeEnabled ? activeSpace : undefined);"
)

with open("src/App.tsx", "w") as f:
    f.write(content)

with open("src/components/SpotlightBar.tsx", "r") as f:
    content = f.read()

# In SpotlightBar.tsx
# loadMemorySummary(selectedAgent?.id),
# retrieveRelevantMemory(lastUserText, selectedAgent?.id)

content = content.replace(
    "loadMemorySummary(selectedAgent?.id),",
    "loadMemorySummary(selectedAgent?.id, useSettingsStore.getState().appSettings.memoryScopeEnabled ? useSpaceStore.getState().activeSpaceId : undefined),"
)

content = content.replace(
    "retrieveRelevantMemory(lastUserText, selectedAgent?.id)",
    "retrieveRelevantMemory(lastUserText, selectedAgent?.id, useSettingsStore.getState().appSettings.memoryScopeEnabled ? useSpaceStore.getState().activeSpaceId : undefined)"
)

# Might need to import useSpaceStore in SpotlightBar.tsx if it isn't there
if "useSpaceStore" not in content:
    content = content.replace("import { useSettingsStore }", "import { useSpaceStore } from '../store/useSpaceStore';\nimport { useSettingsStore }")

with open("src/components/SpotlightBar.tsx", "w") as f:
    f.write(content)
