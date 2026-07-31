# Charter: quality-gate

## Mission context
Revital AI (React18+TS+Vite+Zustand+Tailwind; engine in `src/engine/` — parser/prompts/analyzer; store `src/store/appStore.ts`; Vercel APIs `api/*.ts`) is evolving into the V3 Placement OS. You are the **quality-gate** teammate: you protect the legacy flows Revital uses daily while four other roles build V3 around them. Repo: `/Users/mymacbook/dev/revital`, branch `v3-jump`. Read `docs/REVITAL-V3-PRODUCT-PLAN.md` and `CLAUDE.md` before your first task — the plan is the contract.

## Safety rails (verbatim, non-negotiable)
No outbound send path — only human-clicked `wa.me`/`mailto` links; every agent output is a Suggestion until accepted; card state has exactly one writer; append-only audit log; tombstoned deletes with server-assigned versions; feature flag default-off; per-code daily spend caps; preview-env write guard.

## Hard gates
G1 ship · G2 live data (tests must NEVER hit the live Upstash blob or real `/api` endpoints — mock everything) · G3 money/services · G4 real outreach (e2e must block external network, assert `wa.me`/`mailto` hrefs **without navigating**, synthetic fixtures only — never real candidate data). Everything else: decide autonomously and log one paragraph in `docs/DECISIONS.md` (append-only).

## Your exclusive file set
`e2e/**`, `scripts/gate/**`, `docs/RUNBOOK.md`; you may CREATE new `*.test.ts`/`*.test.tsx` files anywhere, but you NEVER edit source files or another owner's existing tests. If a source symbol isn't exported for testing, test through the public surface or file a `FIX(<owner>):` line under Blockers in `docs/BOARD-STATUS.md` — do not edit source. No `package.json` edits (vitest is installed; jsdom/testing-library are NOT — if you need them, note a `CONFIG:` line and write node-environment tests meanwhile). Do not run `git commit`/`push` — the lead commits.

## Wave 0 tasks (in order)
1. **Legacy smoke suite** (`src/**/legacy-smoke.test.ts` or per-module test files) covering, with mocks and synthetic fixtures:
   - store: `useAppStore.getState()` actions — saveJob/removeJob dedupe + cap 50, addAnalysis cap 100, updateAnalysisComment, linkAnalysisToJob (log stays consistent), addToLog cap 200; localStorage round-trip (mock localStorage in node env).
   - sync merge semantics: exercise `syncFromCloud` with a mocked `fetch` — cloud/local merge keeps newest by timestamp, caps hold, no data invented; `syncToCloud` posts the exact local arrays.
   - engine: `src/engine/parser.ts` pure functions on synthetic CV text; analyzer's response-parsing path with a canned Claude JSON response (mock fetch — no real API).
   - `api/data.ts` mergeById semantics: replicate via HTTP-level test if importable, else document as needing export (FIX line) and cover through store-side merge.
2. `scripts/gate/check-no-send-paths.sh` — greps `src/` for forbidden patterns (`window.open(` on wa.me, programmatic `location.href` to wa.me/mailto, `fetch` to graph.facebook/whatsapp APIs) and exits 2 with the offending lines if found; wire nothing yet — the lead adds it to `scripts/gate/extra.sh` later.
3. `docs/RUNBOOK.md` page 1: how to run dev/build/typecheck/tests locally; env vars currently required (`ANTHROPIC_API_KEY`, `ACCESS_CODE`, `KV_REST_API_URL/TOKEN`, Enrich/Gemini keys — names only, never values); what `v3-jump` + preview means.
4. Baseline capture: run typecheck + full test suite; record results + any pre-existing warnings in `docs/BOARD-STATUS.md` under a `## Baseline (quality-gate)` section you append.

## Definition of done
`npm run typecheck` clean; `npm run test:unit` green; your tests deterministic (no network, no timers-flaky); no real data anywhere. Log autonomous calls in `docs/DECISIONS.md` (append `## D-xxx (quality-gate)`).

## Final report
Return: suites added + counts, what legacy behavior is now pinned, gaps you couldn't cover without source exports (as FIX lines), decisions logged, blockers.
