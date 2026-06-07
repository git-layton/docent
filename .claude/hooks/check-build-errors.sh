#!/bin/bash
# PostToolUse hook — after every Bash call, check if it was a build that produced errors.
# If so, inject a context reminder so Claude reads and fixes them automatically.

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only care about build / type-check commands
if ! echo "$CMD" | grep -qE 'run (build|typecheck|check|tauri)|cargo (build|test)|npx tsc'; then
  exit 0
fi

# Extract output — Bash tool_response shape varies; try several fields
OUTPUT=$(echo "$INPUT" | jq -r \
  'if (.tool_response | type) == "string" then .tool_response
   elif (.tool_response.output | type) == "string" then .tool_response.output
   elif (.tool_response.stdout | type) == "string" then .tool_response.stdout
   else "" end')

# Detect build error patterns (TypeScript, Vite, Rust/Cargo, generic)
if ! echo "$OUTPUT" | grep -qiE 'error TS[0-9]+|error\[E[0-9]+\]|Build failed|failed to compile|FAILED|[0-9]+ error'; then
  exit 0
fi

# Extract up to 40 error-bearing lines so context stays concise
ERRORS=$(echo "$OUTPUT" | grep -iE 'error|FAILED' | head -40)

# Inject context so Claude sees the errors and fixes them
jq -n --arg cmd "$CMD" --arg errs "$ERRORS" \
  '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":("Build errors in [" + $cmd + "] -- please fix now:\n\n" + $errs)}}'
