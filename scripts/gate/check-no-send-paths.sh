#!/usr/bin/env bash
# ============================================================
# Gate G4 guard — no programmatic outbound send paths in src/
# (quality-gate; Wave 0 task 2, extended Wave 1)
#
# The only legal outreach surface is a human-clicked wa.me/mailto
# <a href>. Two layers of checks:
#
#  A. src/-wide (Wave 0): outreach-shaped violations anywhere:
#     1. window.open(...) on a wa.me URL
#     2. programmatic location.href/assign/replace to wa.me or mailto:
#     3. fetch() against wa.me / graph.facebook / WhatsApp APIs
#
#  B. strict dirs (Wave 1): under src/views/ and src/agents/ ANY
#     call-shaped navigation or beacon primitive is forbidden, wa.me
#     or not — UI and agent code must never navigate programmatically:
#     window.open(, location.href =, location.assign(,
#     location.replace(, sendBeacon(
#
# Standalone by design — the lead wires it into scripts/gate/extra.sh.
# Exit codes: 0 = clean, 2 = violations found (printed to stdout),
#             1 = src/ missing.
# ============================================================
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$ROOT/src"

if [ ! -d "$SRC_DIR" ]; then
  echo "check-no-send-paths: src/ not found at $SRC_DIR" >&2
  exit 1
fi

# grep args: recursive, line numbers, extended regex, source files only,
# skip test files (tests may quote forbidden patterns as fixtures).
GREP=(grep -rnE --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx')

violations=""

collect() {
  local label="$1" pattern="$2" found
  shift 2
  local dirs=("$@")
  local existing=()
  for d in "${dirs[@]}"; do
    [ -d "$d" ] && existing+=("$d")
  done
  [ "${#existing[@]}" -eq 0 ] && return 0
  found="$("${GREP[@]}" "$pattern" "${existing[@]}" 2>/dev/null || true)"
  if [ -n "$found" ]; then
    violations="${violations}--- ${label} ---
${found}
"
  fi
}

# ---------- A. src/-wide outreach-shaped patterns (Wave 0) ----------

# 1. window.open on a wa.me URL (programmatic navigation = send path)
collect "window.open(...wa.me...)" 'window\.open\([^)]*wa\.me' "$SRC_DIR"

# 2. programmatic location.href (or location.assign/replace) to wa.me / mailto:
collect "location.href = ...wa.me|mailto..." \
  '(location\.href[[:space:]]*=|location\.(assign|replace)\()[^;]*(wa\.me|mailto:)' \
  "$SRC_DIR"

# 3. fetch against wa.me / WhatsApp / Graph APIs (no API sending, plan cut list)
collect "fetch(...wa.me|graph.facebook|whatsapp API...)" \
  'fetch\([^)]*(wa\.me|graph\.facebook|api\.whatsapp\.com|whatsapp\.com/v[0-9])' \
  "$SRC_DIR"

# ---------- B. strict call-shaped patterns in UI + agent dirs (Wave 1) ----------
# Under src/views/ and src/agents/ these calls are forbidden with ANY
# argument: navigation belongs exclusively to human-clicked <a href>.

STRICT_DIRS=("$SRC_DIR/views" "$SRC_DIR/agents")

collect "STRICT src/views|src/agents: window.open(" \
  'window\.open\(' "${STRICT_DIRS[@]}"

collect "STRICT src/views|src/agents: location.href =" \
  '(window\.|document\.)?location\.href[[:space:]]*=' "${STRICT_DIRS[@]}"

collect "STRICT src/views|src/agents: location.assign(/replace(" \
  'location\.(assign|replace)\(' "${STRICT_DIRS[@]}"

collect "STRICT src/views|src/agents: sendBeacon(" \
  'sendBeacon\(' "${STRICT_DIRS[@]}"

if [ -n "$violations" ]; then
  echo "FORBIDDEN SEND PATHS FOUND in src/ (gate G4):"
  echo ""
  printf '%s' "$violations"
  echo ""
  echo "Outreach must be a human-clicked wa.me/mailto href. Remove the code above."
  exit 2
fi

echo "check-no-send-paths: OK — no programmatic send paths in src/."
exit 0
