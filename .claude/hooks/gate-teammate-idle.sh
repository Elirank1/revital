#!/usr/bin/env bash
# Exit 2 => teammate receives stderr as feedback and KEEPS WORKING.
set -uo pipefail
PAYLOAD="$(cat 2>/dev/null || true)"
TEAM="$(printf '%s' "$PAYLOAD" | sed -n 's/.*"team_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -z "$TEAM" ] && exit 0
DIR="$HOME/.claude/tasks/$TEAM"
[ -d "$DIR" ] || exit 0
if grep -l '"status"[[:space:]]*:[[:space:]]*"pending"' "$DIR"/*.json >/dev/null 2>&1; then
  echo "GATE: the shared board still has pending tasks. Claim the next unblocked task now — FIX(<your-name>): tasks first (rule 25). If everything claimable is blocked, message the lead stating exactly what blocks you." >&2
  exit 2
fi
exit 0
