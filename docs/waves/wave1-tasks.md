# Wave 1 — The Board (task batches per role)

Contract: plan §6 Wave 1. Store API: `docs/waves/wave1-store-contract.md` (binding). DOM tests: vitest + jsdom are installed — put `// @vitest-environment jsdom` at the top of DOM test files (global default stays node). dnd-kit is installed (@dnd-kit/core, sortable, utilities).

## platform-data
1. Implement the store contract exactly (moveDeal/undoLast/setReplyState/logContact/accept/dismiss/addPerson/addDeal/addSuggestion + selectors), with stage-events (incl. skip-events), undo snapshots, audit on every mutation. Unit tests for each action, incl. Rejected-requires-reason and undo round-trip.
2. `src/lib/backfill.ts` — flag-gated, dry-run-first backfill from legacy `analyses` → Person (deduped) + Deal in **Screened only** (plan §2: backfill can only place cards in Screened). `backfillDryRun()` returns a report (would-create/would-merge/skipped) without mutating; `backfillApply()` runs only when the v3 flag is on AND an explicit `confirm: true` arg is passed. Unit tests on synthetic analyses.
3. `src/lib/persistence/exportAll.ts` — Export-everything: one JSON blob of legacy + v3 localStorage state (for her own backup; no network). Unit test.
4. Wire `pipelineStore` sync payloads through `/api/data` v3 section (client side): push dirty records with `X-Revital-V3: 1`, pull+applyRemote on load when flag on. Mock-fetch tests.

## kanban-ui
1. Board: dnd-kit drag between columns calling `moveDeal`; columns from `stages.ts`; per-column count + ΣEV header placeholder (count only until Wave 2 fees; NO fake ₪ — calibration rule).
2. DealCard front: candidate name + role (`dir="auto"`, worst case Hebrew name + English title), match score/verdict chip, days-in-stage aging ring (amber ≥5d, red ≥10d — CSS ring, no lib), next-action line, pending-suggestion badge, one-tap wa.me button (from `src/lib/outreach` `composeAndLog` + store `logContact` — render as `<a href>`, NEVER window.open), three reply chips השיב/ה · אין מענה · נקבעה שיחה → `setReplyState`.
3. Undo toast: after any drag, a 6-second toast with כפתור ביטול → `undoLast()`.
4. `src/views/Inbox/SuggestionsQueue.tsx` — minimal list: suggestion title+evidence, accept/dismiss → store. Badge count into the board header.
5. Today view (`src/views/Pipeline/TodayView.tsx`): approvals queue + at-risk deals ranked by days-in-stage (EV ranking arrives Wave 2), mobile-responsive at 390px (test with class assertions), one-tap resolve.
6. DOM tests (jsdom) for card BiDi attrs, chips, undo toast, queue accept flow. Drag: test `moveDeal` wiring via component callbacks (skip full dnd simulation).

## agents-engine
1. `src/agents/screener.ts` — client-side, event-driven: `runScreener(analyses)` idempotently ensures Person (via `addPerson` dedupe) + Deal in Screened for each analysis not yet carded (track processed ids in the v3 store or by deterministic dealId); every action audit-attributed `agent:'screener'`; flag explanations become Suggestions (`addSuggestion`), never direct edits beyond the sanctioned card-creation Act. Subscribe helper `attachScreener(appStore, pipelineStore)` the lead wires later.
2. Unit tests: idempotency (run twice → no dupes), dedupe path, audit entries, suggestion emission.

## integrations
1. `src/lib/outreach/drafts.ts` — Hebrew next-step draft builders (pure, no LLM call in Wave 1): openerDraft(person, deal, analysis?) and followUpDraft(person, deal, daysSilent) returning `{ text, suggestionInput }` ready for `addSuggestion` + `composeAndLog`. BiDi-safe text (no direction-control injection), placeholders filled from real fields only — no invented facts.
2. Glue: `draftToSuggestion()` + `suggestionToWaHref()` so kanban-ui renders accepted drafts as wa.me links.
3. Unit tests: draft content fields, hash stability through the glue, G4 grep stays clean.

## quality-gate
1. DOM smoke (jsdom) for the board: columns render from store state, card shows dir="auto" on user content, reply chips dispatch, undo restores prior stage, suggestions queue accept mutates only via store.
2. Extend `scripts/gate/check-no-send-paths.sh` to cover new UI dirs; add a check that no file under src/views/Pipeline or src/views/Inbox calls `window.open`/`location.assign`.
3. Regression: full legacy suite still green with flag on AND off (run store tests under both flag states where relevant).
4. RUNBOOK §2: the flag, backfill dry-run, undo, and what Wave 1 does NOT include (fees/EV, server agents).
