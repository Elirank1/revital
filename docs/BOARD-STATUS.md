# V3 Board Status

**Wave:** 0 — Foundations (opened 2026-07-31)
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
- None. gh CLI auth invalid (PRs unavailable, push fine) — D-004.
- CONFIG (kanban-ui → lead): add dev deps `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` (and a vitest `environment: 'jsdom'` config for `*.test.tsx`) — needed for real DOM component tests from Wave 1 (dnd-kit board). Wave-0 tests pass via pure-logic invocation, not blocked.
- CONFIG (kanban-ui → lead): Pipeline wiring ready to apply — contract in `src/views/Pipeline/README.md` (`'pipeline'` in `AppView`, render branch in `App.tsx`, flag-gated header nav item).

## Flagged for Eliran review
- (none yet; `api/data.ts` diffs will be flagged here)

## Gates status
G1 ship / G2 live-data / G3 paid services / G4 real outreach — all untouched.
