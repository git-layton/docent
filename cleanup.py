import re

with open("src/App.tsx", "r") as f:
    content = f.read()
content = content.replace("const appSettings = useSettingsStore.getState().appSettings;", "")
with open("src/App.tsx", "w") as f:
    f.write(content)

with open("src/components/SpotlightBar.tsx", "r") as f:
    content = f.read()
content = content.replace("import { useSettingsStore } from '../store/useSettingsStore';\n", "")
with open("src/components/SpotlightBar.tsx", "w") as f:
    f.write(content)

with open("src/services/appliedMemory.ts", "r") as f:
    content = f.read()
content = content.replace("import { useSettingsStore } from '../store/useSettingsStore';\n", "")
content = content.replace("  const agentId = String(input.agentId || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'default';\n", "")
content = content.replace("  const aid = String(agentId || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'default';\n", "")
with open("src/services/appliedMemory.ts", "w") as f:
    f.write(content)
