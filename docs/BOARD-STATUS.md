# V3 Board Status

**Wave:** 1 — The Board (opened 2026-07-31; Wave 0 checkpoint green, tag v3-wave0)
**Branch:** `v3-jump` (from main @5949b2a) · **No merge to main until G1.**
**Working copy:** `~/dev/revital` (local clone; Drive checkout is frozen, see DECISIONS D-001/D-003)

## Wave 0 goal (plan §6)
Contracts + safety: pipeline types with schemaVersion; Zustand slices; `/api/data` additive merge (tombstones, server-assigned versions, blob-size guard); snapshot script; audit-log module; spend guards (Claude + Enrich Layer + Gemini); preview-env guard; route + flag scaffold; `wa.me` composer with auto-log-contact; legacy smoke suite.
**Checkpoint:** schema sign-off (lead plan approval), legacy suite green, typecheck clean.

## Teammate states
| Role | State | Current |
|---|---|---|
| platform-data | in progress | Wave-0 schema plan → types + slices + /api/data v2 |
| agents-engine | in progress | audit module + spend guards + preview guard |
| integrations | in progress | wa.me composer vs interface stub |
| kanban-ui | Wave 0 done | flags + stages model + PipelineView scaffold + tests green; awaiting lead wiring (see Blockers CONFIG) |
| quality-gate | in progress | legacy smoke suite (vitest) |

## Blockers
- None. Push RESOLVED 2026-07-31: gh device-flow authorized by Eliran via browser; v3-jump + v3-wave0 on GitHub, Vercel preview building.
- CONFIG (kanban-ui → lead): add dev deps `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` (and a vitest `environment: 'jsdom'` config for `*.test.tsx`) — needed for real DOM component tests from Wave 1 (dnd-kit board). Wave-0 tests pass via pure-logic invocation, not blocked.
- CONFIG (kanban-ui → lead): Pipeline wiring ready to apply — contract in `src/views/Pipeline/README.md` (`'pipeline'` in `AppView`, render branch in `App.tsx`, flag-gated header nav item).

## Flagged for Eliran review
- **`api/data.ts` v2 proposal ready for lead line-by-line review:** `docs/diffs/api-data-v2.ts` + `docs/diffs/api-data-v2-RATIONALE.md` (platform-data, Wave 0 task 4). Not applied; live file untouched.

## Stop protocol (desktop-app loop discipline — .claude hooks do not fire here)
A turn may end ONLY with one of: (a) background agents running AND a fallback wakeup armed; (b) a `GATE-WAIT: G<n> — <what>` line in this file; (c) `MISSION: DONE` per rule 27. Anything else = re-enter THE LOOP (rule 12).

## Gates status
G1 ship / G2 live-data / G3 paid services / G4 real outreach — all untouched.

## Baseline (quality-gate)
Captured 2026-07-31 on `v3-jump`, local clone `~/dev/revital`, node v22.22.2, vitest 3.2.7.

- **Before Wave-0 test work:** `npm run typecheck` clean (exit 0) — including other teammates' in-flight untracked files under `src/`. `npm run test:unit` exited 1 with "No test files found" (zero tests existed in the repo; pre-existing condition, not a regression).
- **After legacy smoke suite:** typecheck clean (exit 0); `npm run test:unit` green — 10 files, 172 tests, 0 failures, ~0.7s (61 of those are quality-gate legacy-smoke tests: appStore 25, analyzer 11, parser 13, api/data 12; the rest belong to other Wave-0 owners and also pass).
- **Pre-existing warnings:** none surfaced by tsc or vitest. Known scope gap, not a warning: tsconfig `include` is `["src"]`, so `api/**` (and future `e2e/**`) are not covered by `npm run typecheck`.
- Send-path gate: `scripts/gate/check-no-send-paths.sh` exits 0 on current `src/` (verified to exit 2 with offending lines on a synthetic violation fixture).
