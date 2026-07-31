# Wave 2 — Money + Loop (task batches per role)

Contract: `docs/waves/wave2-contract.md` (binding). Plan §6 Wave 2. All ₪ display obeys calibration mode — no fiction, ever.

## platform-data (batch A)
1. `src/lib/money/` — MandateFee store slice (persist `revital_v3_fees`), `feeAmount`, `DEFAULT_STAGE_PRIORS` + priors persistence, `effectiveProbability` (blend at n≥10 from stageEvents), `dealEV`, `qualifiedPipeline(deals, fees, priors)` (Submitted+ Σ + early-range footnote data), calibration predicate `mandateCalibrated(jobId)`. Full unit tests incl. blend boundary (9 vs 10) and calibration gating.
2. `computeLeadingIndicators` metrics lib + tests (synthetic events).
3. `supabase/schema.sql` (events append-only, agent_runs, suggestions, fee ledger) + `src/lib/persistence/agentStoreImporter.ts` — flag-gated, dry-run-first, auto-backup, against `mockSupabaseStore`; tests.
4. CSV stage column in `src/utils/export.ts` (lead-granted) — legacy columns byte-identical, stage appended last; test.

## integrations (batch A)
1. `src/reporting/mandateReport.ts` — `buildMandateReport` per contract: Hebrew RTL HTML + text, funnel, submitted summaries, feedback-pending nudges, evidence ref on EVERY claim; BiDi-sanitized. Golden-file style tests on synthetic data (assert evidence coverage: no claim without ref).
2. `src/reporting/booleanStrings.ts` — deterministic boolean search-string generator from JD pillars/keywords (Hebrew+English variants, quoted phrases, OR-groups, site:linkedin.com/in variant); tests.
3. Optional `polishWithClaude` stub behind /api/analyze proxy, default OFF, injected fetch, test with mock only.

## agents-engine (batch B — after A lands)
1. `api/_lib/agentStore.ts` — `AgentStore` interface + `redisBridgeStore` (suggestions/agentRuns only, server-versioned via the same merge semantics as api/data v3, rotation ≤200 runs) + `mockSupabaseStore`; tests.
2. `src/agents/pitboss.ts` — `rankMoveTheMoney` per contract, pure, numeric evidence; tests (aging×EV ordering, feedback-overdue, silence, offer decay).
3. `src/agents/sla.ts` — silence sweep (3d in Outreach/InConversation without reply after contact) → suggestion inputs; client-side `runSlaSweepOnLoad` + server variant; tests.
4. `api/agents/tick.ts` — full implementation per tick protocol (chunked, cursor on agentRuns v, budgetMs, fail-closed auth, preview guard); handler-level tests with mocked Redis.
5. Spend-cap regression tests stay green (no LLM in tick).

## kanban-ui (batch B — after A lands)
1. Header money block: qualified-pipeline ₪ (Submitted+), expected-this-month, early-stage range footnote — rendered ONLY for calibrated mandates; priors editor (ranges, per-stage) in a settings popover.
2. EV on DealCard (calibrated mandates only) + per-column ΣEV replacing the `ΣEV —` placeholder.
3. `FeeCapture.tsx` — modal on drag→Placed (and mandate-level fee editor): kind/percent/salary/fixed/guarantee/invoice status → money slice.
4. `MoneyBoard.tsx` — unified view, swimlanes per mandate, same card component; view toggle in board tabs.
5. Today view upgrade: rank by Pit Boss `rankMoveTheMoney` (client call), each item with pre-drafted message link when a draft suggestion exists.
6. Export-everything button (calls exportAll) + backfill dry-run panel (report + confirm apply) in a board tools menu.
7. jsdom tests: calibration gating (no ₪ uncalibrated), fee capture flow, Money Board swimlanes, Today ranking.

## quality-gate (batch C — closes the wave)
1. Seam tests: fee→EV→header/card/column agreement; tick handler → bridge store → client pull → inbox surfacing; Pit Boss determinism (same inputs = same order); calibration NEVER leaks ₪ (uncalibrated sweep across all surfaces).
2. Direct-HTTP tick validation script `scripts/gate/tick-check.sh` (curl with CRON_SECRET against a local `vercel dev`-less harness or documented preview command) + RUNBOOK §3 (tick, caps, agent bridge, Supabase/G3 swap plan).
3. Full regression + send-path gate + BOARD-STATUS Wave-2 baseline.
