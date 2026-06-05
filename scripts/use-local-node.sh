#!/usr/bin/env sh

# Optional helper for local development. Source this from the repo root.
# If a bundled Node runtime exists under .node, prefer it; otherwise use PATH.
PROJECT_ROOT="${AGENT_FORGE_ROOT:-$PWD}"
LOCAL_NODE_BIN="$(find "$PROJECT_ROOT/.node" -maxdepth 2 -type f -name node -perm -111 2>/dev/null | head -n 1)"

if [ -n "$LOCAL_NODE_BIN" ]; then
  export PATH="$(dirname "$LOCAL_NODE_BIN"):$PATH"
fi

echo "Node: $(node --version)"
echo "npm:  $(npm --version)"
