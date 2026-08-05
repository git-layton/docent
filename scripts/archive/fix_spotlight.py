with open("src/components/SpotlightBar.tsx", "r") as f:
    content = f.read()

if "useSettingsStore" not in content and "useSpaceStore" not in content:
    content = "import { useSettingsStore } from '../store/useSettingsStore';\nimport { useSpaceStore } from '../store/useSpaceStore';\n" + content

with open("src/components/SpotlightBar.tsx", "w") as f:
    f.write(content)
