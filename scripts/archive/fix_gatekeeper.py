with open("src/services/memoryGatekeeper.ts", "r") as f:
    content = f.read()

content = content.replace("input.provenance?.source === 'web' || input.provenance?.source === 'mixed' || ", "")

with open("src/services/memoryGatekeeper.ts", "w") as f:
    f.write(content)

with open("src/tests/services/memoryGatekeeper.test.ts", "r") as f:
    content = f.read()

# Replace missing scope in test mocks by just adding scope: 'global' to any returned decision in the test
content = content.replace("shouldSave: true,", "shouldSave: true, scope: 'global',")
content = content.replace("shouldSave: false,", "shouldSave: false, scope: 'global',")

with open("src/tests/services/memoryGatekeeper.test.ts", "w") as f:
    f.write(content)
