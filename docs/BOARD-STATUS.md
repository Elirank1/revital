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
| platform-data | pending spawn | Wave-0 schema plan → types + slices + /api/data v2 |
| agents-engine | pending spawn | audit module + spend guards + preview guard |
| integrations | pending spawn | wa.me composer vs interface stub |
| kanban-ui | pending spawn | Pipeline route + feature-flag scaffold |
| quality-gate | pending spawn | legacy smoke suite (vitest) |

## Blockers
- None. gh CLI auth invalid (PRs unavailable, push fine) — D-004.

## Flagged for Eliran review
- (none yet; `api/data.ts` diffs will be flagged here)

## Gates status
G1 ship / G2 live-data / G3 paid services / G4 real outreach — all untouched.
