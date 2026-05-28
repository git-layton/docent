#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PLIST="$HOME/Library/LaunchAgents/com.agentforge.relay.plist"
ENV_FILE="$HOME/.agent-forge-relay.env"
LOG_DIR="$HOME/Library/Logs/AgentForge"

if [[ -z "${NODE_BIN}" ]]; then
  echo "Node.js is required. Set NODE_BIN=/path/to/node if it is not on PATH." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

if [[ ! -f "$ENV_FILE" ]]; then
  PRIMARY_TOKEN="$(openssl rand -hex 24)"
  SHARED_TOKEN="$(openssl rand -hex 24)"
  ADMIN_TOKEN="$(openssl rand -hex 24)"
  INSTANCE_ID="agent-forge-$(hostname | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g')"
  cat > "$ENV_FILE" <<EOF
FORGE_RELAY_HOST=0.0.0.0
FORGE_RELAY_PORT=8765
FORGE_RELAY_ROOT=$HOME/AgentForge
FORGE_RELAY_INSTANCE_ID=$INSTANCE_ID
# Token routes use ownerId:Owner Label:token:instanceId:shareId
# Rename owner IDs/labels for your household or workspace before building Shortcuts.
FORGE_RELAY_TOKENS=primary:Primary:$PRIMARY_TOKEN:$INSTANCE_ID:primary-shortcut,shared:Shared:$SHARED_TOKEN:$INSTANCE_ID:shared-shortcut
FORGE_RELAY_ADMIN_TOKEN=$ADMIN_TOKEN
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE with new primary, shared, and admin tokens."
else
  echo "Using existing $ENV_FILE."
fi

NODE_BIN_XML="$(xml_escape "$NODE_BIN")"
RELAY_SCRIPT_XML="$(xml_escape "$ROOT_DIR/scripts/forge-relay.mjs")"
LOG_OUT_XML="$(xml_escape "$LOG_DIR/forge-relay.out.log")"
LOG_ERR_XML="$(xml_escape "$LOG_DIR/forge-relay.err.log")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agentforge.relay</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN_XML</string>
    <string>$RELAY_SCRIPT_XML</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
$(while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    printf '    <key>%s</key>\n    <string>%s</string>\n' "$(xml_escape "$key")" "$(xml_escape "$value")"
  done < "$ENV_FILE")
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_OUT_XML</string>
  <key>StandardErrorPath</key>
  <string>$LOG_ERR_XML</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

echo "Forge Relay installed and started."
echo "Plist: $PLIST"
echo "Env:   $ENV_FILE"
echo "Logs:  $LOG_DIR/forge-relay.out.log"
