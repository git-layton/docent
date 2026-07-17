import re

with open("src/App.tsx", "r") as f:
    content = f.read()

# find:
#       const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', {
#         agentId: activeAgent.id,
#       });

old_list = """      const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', {
        agentId: activeAgent.id,
      });"""

new_list = """      const activeSpaceId = useSpaceStore.getState().activeSpaceId;
      const listed = await invoke<{ files: Array<{ path: string; name: string }> }>('list_agent_memory_files', {
        agentId: activeAgent.id,
        spaceId: _appSettings.memoryScopeEnabled ? activeSpaceId : undefined,
      });"""

content = content.replace(old_list, new_list)

with open("src/App.tsx", "w") as f:
    f.write(content)
