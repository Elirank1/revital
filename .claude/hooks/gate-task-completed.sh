#!/usr/bin/env bash
# Exit 2 => completion BLOCKED, stderr goes back to the agent as feedback.
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# No-op until Wave 0 bootstraps a typecheck script.
if ! node -e "const s=require('./package.json').scripts||{};process.exit(s.typecheck?0:1)" 2>/dev/null; then exit 0; fi
if ! npm run -s typecheck 2>&1 | tail -20 >&2; then
  echo "GATE: typecheck failed — fix before completing (rule 24). If the break is in another owner's mid-edit file, re-run once, then file a blocker to the lead." >&2
  exit 2
fi
if node -e "const s=require('./package.json').scripts||{};process.exit(s['test:unit']?0:1)" 2>/dev/null; then
  if ! npm run -s test:unit 2>&1 | tail -20 >&2; then
    echo "GATE: unit tests failed — fix before completing (rule 24)." >&2
    exit 2
  fi
fi
# quality-gate may add stricter checks here later:
[ -x scripts/gate/extra.sh ] && { scripts/gate/extra.sh || { echo "GATE: extra checks failed." >&2; exit 2; }; }
exit 0
