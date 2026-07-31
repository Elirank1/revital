#!/usr/bin/env bash
# ============================================================
# tick-check — validate a DEPLOYED /api/agents/tick endpoint
# (quality-gate; Wave 2 batch C. RUNBOOK §3 documents the protocol.)
#
# Usage:
#   TICK_URL=https://<deployment>/api/agents/tick \
#   CRON_SECRET=<the deployment's CRON_SECRET> \
#   ./scripts/gate/tick-check.sh
#
# What it asserts (all safe — the valid call sends codes:[] which is an
# honest no-op: no blob is read or written):
#   1. GET  + valid secret         → 405  (tick is POST-only; this is the
#      Vercel-cron-is-GET mismatch made visible — see RUNBOOK §3)
#   2. POST + WRONG secret         → 401  (both auth header forms)
#   3. POST + NO auth              → 401  (fail-closed)
#   4. POST + valid secret, {"codes":[]}
#                                  → 200 with {"ok":true,"ran":[],
#                                    "partial":false} (+ a note)
#
# NOT testable remotely, by design: the 503 fail-closed branch when the
# server has NO CRON_SECRET configured. You cannot unset a deployment's
# env from outside, and a deployment without the secret should never
# exist. That branch is pinned locally by api/_lib/guard.test.ts and
# api/agents/tick.test.ts ("fails CLOSED (503) when CRON_SECRET is
# unconfigured").
#
# Exit codes: 0 = all checks passed · 2 = at least one check failed
#             64 = usage error (missing env / curl)
# The secret is never echoed.
# ============================================================
set -u

usage() {
  cat >&2 <<'EOF'
tick-check: validate a deployed /api/agents/tick endpoint.

Required environment:
  TICK_URL     full URL of the tick endpoint
               (e.g. https://<preview>.vercel.app/api/agents/tick)
  CRON_SECRET  the CRON_SECRET configured on that deployment

Example:
  TICK_URL=https://revital-xyz.vercel.app/api/agents/tick \
  CRON_SECRET=... ./scripts/gate/tick-check.sh
EOF
}

if ! command -v curl >/dev/null 2>&1; then
  echo "tick-check: curl not found" >&2
  exit 64
fi
if [ -z "${TICK_URL:-}" ] || [ -z "${CRON_SECRET:-}" ]; then
  echo "tick-check: TICK_URL and CRON_SECRET must both be set" >&2
  usage
  exit 64
fi

failures=0
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

# run <label> <expected_status> <curl args...>
run() {
  local label="$1" expected="$2"
  shift 2
  local status
  status="$(curl -sS -o "$body_file" -w '%{http_code}' --max-time 30 "$@" 2>/dev/null)" || {
    echo "FAIL  ${label}: curl error (network/TLS)" >&2
    failures=$((failures + 1))
    return 1
  }
  if [ "$status" != "$expected" ]; then
    echo "FAIL  ${label}: expected HTTP ${expected}, got ${status}"
    failures=$((failures + 1))
    return 1
  fi
  echo "ok    ${label} → ${status}"
  return 0
}

# body_has <label> <fixed-string>
body_has() {
  local label="$1" needle="$2"
  if grep -qF "$needle" "$body_file"; then
    echo "ok    ${label}: body contains ${needle}"
  else
    echo "FAIL  ${label}: body missing ${needle} — got: $(head -c 300 "$body_file")"
    failures=$((failures + 1))
  fi
}

echo "tick-check → ${TICK_URL}"

# 1. GET with a VALID secret must still 405 — the endpoint is POST-only.
#    (A vercel.json cron would arrive exactly like this and bounce.)
run "GET is rejected (405, POST-only — the Vercel-cron GET mismatch)" 405 \
  -X GET -H "authorization: Bearer ${CRON_SECRET}" "$TICK_URL"

# 2. Wrong secret → 401, on both accepted header forms.
run "wrong Bearer secret → 401" 401 \
  -X POST -H "authorization: Bearer definitely-wrong-secret" \
  -H "content-type: application/json" -d '{"codes":[]}' "$TICK_URL"
run "wrong x-cron-secret → 401" 401 \
  -X POST -H "x-cron-secret: definitely-wrong-secret" \
  -H "content-type: application/json" -d '{"codes":[]}' "$TICK_URL"

# 3. No auth at all → 401 (fail-closed).
run "missing auth → 401" 401 \
  -X POST -H "content-type: application/json" -d '{"codes":[]}' "$TICK_URL"

# 4. Valid secret + empty codes → 200 and the exact no-op shape.
if run "valid secret, codes:[] → 200 (no-op, zero writes)" 200 \
  -X POST -H "x-cron-secret: ${CRON_SECRET}" \
  -H "content-type: application/json" -d '{"codes":[]}' "$TICK_URL"; then
  body_has "200 shape" '"ok":true'
  body_has "200 shape" '"ran":[]'
  body_has "200 shape" '"partial":false'
fi

echo
echo "NOTE: the 503 'CRON_SECRET not configured' fail-closed branch is not"
echo "remotely testable (the server env cannot be unset from outside); it is"
echo "pinned by api/_lib/guard.test.ts and api/agents/tick.test.ts."

if [ "$failures" -gt 0 ]; then
  echo "tick-check: ${failures} check(s) FAILED"
  exit 2
fi
echo "tick-check: all checks passed"
exit 0
