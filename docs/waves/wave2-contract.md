# Wave 2 — Money + Loop: binding contracts (lead-defined)

## Fee / EV model (platform-data implements; kanban-ui + agents-engine consume)
- `MandateFee` keyed by `jobId`: `{ jobId, kind: 'percent'|'fixed', percent?, expectedSalary?, fixedAmount?, currency:'ILS', guaranteeDays, invoiceStatus: 'none'|'due'|'sent'|'paid', invoiceDueAt?, updatedAt }`. `feeAmount(f): number|null` (percent×salary/100 or fixed; null if incomplete).
- Stage priors: `DEFAULT_STAGE_PRIORS: Record<PipelineStage, {lo:number, hi:number}>` (editable, stored per access-code under `revital_v3_priors`); `effectiveProbability(stage, observed)` = midpoint of prior range UNLESS ≥10 observed transitions for that stage → blend 50/50 with actuals. Display always as a range until blended.
- `dealEV(deal, fee, priors): number|null` — fee × effectiveProbability; null when fee incomplete (calibration).
- **Calibration mode (hard rule):** a mandate shows ₪/EV ONLY when `feeAmount != null` AND ≥1 of its deals is past Screened. Otherwise headers/cards show no ₪ for it. Qualified-pipeline headline = Σ EV over stages Submitted+ only; earlier stages appear only as a range footnote.
- Metrics lib: `computeLeadingIndicators(events, contacts, suggestions)` → `{ timeToFirstTouchDays, slaHitRate, clientFeedbackLatencyDays, suggestionAcceptRate, suggestionEditRate }` (nulls when insufficient data — never fake).

## Agent-side store bridge (pre-G3)
Supabase remains the Wave-2 target for events/agent_runs/suggestions (schema + flag-gated importer built against a mocked client; signup is G3, Eliran's click). Until G3 executes, the server tick uses the EXISTING Redis v3 section as its bounded bridge store: tick writes ONLY `suggestions` + `agentRuns` records (server-assigned versions, rotated ≤200 runs), NEVER persons/deals/events — single-writer preserved. The store access goes through an interface (`AgentStore`) with two impls: `redisBridgeStore` (live) and `mockSupabaseStore` (tests + future swap).

## Tick protocol (`api/agents/tick.ts`)
POST only; auth: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` (fail-closed, existing guard); preview guard applies. Body `{ codes?: string[], budgetMs?: number }`. The tick: for each access code (default: env `TICK_CODES` csv), load blob v3 once, run incremental agent passes (Pit Boss ranking, SLA sweep over contacts/replies) over NEW/CHANGED records only (cursor: `agentRuns` last processed `v`), write suggestions+agent_run, stop before `budgetMs` (default 8000ms) and return `{ok, ran:[{code, agent, produced, cursor}], partial}` for chunked continuation. No LLM calls in Wave-2 tick (Pit Boss is deterministic; Reporter is on-demand client-side) — spend caps stay untouched by cron.

## Pit Boss (deterministic, auditable)
`rankMoveTheMoney(deals, fees, priors, contacts, now)` → sorted `[{dealId, evAtRisk, reasons[]}]`: aging past stage-median × EV, overdue client feedback (>6d after Submitted+), follow-ups due (3d silence in Outreach/InConversation), offers decaying. Pure function in `src/agents/pitboss.ts`; used by Today view (client) AND tick (server). Every suggestion it emits cites its numeric inputs in `evidence`.

## Client Reporter (integrations)
`buildMandateReport(mandate, deals, events, contacts, opts)` → Hebrew RTL HTML string + plain-text: funnel counts, submitted candidates w/ short summaries, "feedback pending Xd" nudges, next steps. EVERY claim carries an evidence ref (dealId/eventId). No LLM in the deterministic core; optional `polishWithClaude(report)` behind the existing `/api/analyze` proxy + spend cap, OFF by default. Boolean-string generator: `booleanStrings(jd)` → deterministic queries from pillars/keywords (AND/OR/quotes, site: variants), pure.

## Ownership deltas for Wave 2 (lead grants)
- platform-data may edit `src/utils/export.ts` (add stage column to CSV; Export-everything button wiring stays kanban-ui→lib).
- agents-engine owns `src/agents/pitboss.ts`, `src/agents/sla.ts`, `api/agents/**`, `api/_lib/agentStore.ts`.
- integrations owns `src/reporting/**` (reporter + boolean strings live here or src/lib/outreach — their call).
- kanban-ui owns Money Board (`src/views/Pipeline/MoneyBoard.tsx`), fee-capture modal (`src/components/pipeline/FeeCapture.tsx`), header EV block, priors editor UI.
