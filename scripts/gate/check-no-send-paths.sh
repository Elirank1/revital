#!/usr/bin/env bash
# ============================================================
# Gate G4 guard — no programmatic outbound send paths in src/
# (quality-gate, Wave 0 task 2)
#
# The only legal outreach surface is a human-clicked wa.me/mailto
# <a href>. This script fails (exit 2) if src/ grows any of:
#   1. window.open(...) on a wa.me URL
#   2. programmatic location.href assignment to wa.me or mailto:
#   3. fetch() against graph.facebook / WhatsApp APIs
#
# Standalone by design — the lead wires it into scripts/gate/extra.sh.
# Exit codes: 0 = clean, 2 = violations found (printed to stdout).
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
  found="$("${GREP[@]}" "$pattern" "$SRC_DIR" 2>/dev/null || true)"
  if [ -n "$found" ]; then
    violations="${violations}--- ${label} ---
${found}
"
  fi
}

# 1. window.open on a wa.me URL (programmatic navigation = send path)
collect "window.open(...wa.me...)" 'window\.open\([^)]*wa\.me'

# 2. programmatic location.href (or location.assign/replace) to wa.me / mailto:
collect "location.href = ...wa.me|mailto..." \
  '(location\.href[[:space:]]*=|location\.(assign|replace)\()[^;]*(wa\.me|mailto:)'

# 3. fetch against WhatsApp / Graph APIs (no API sending, plan cut list)
collect "fetch(...graph.facebook|whatsapp API...)" \
  'fetch\([^)]*(graph\.facebook|api\.whatsapp\.com|whatsapp\.com/v[0-9])'

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
