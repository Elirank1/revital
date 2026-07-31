# Revital V3 — Runbook

Owner: quality-gate. Page 1 — local dev, env, branch model.

## Run it locally

All commands from the repo root (`~/dev/revital`, branch `v3-jump`):

| What | Command | Notes |
|---|---|---|
| Dev server | `npm run dev` | Vite on `http://localhost:5173`. `localhost` counts as proxy mode, so the app will try `/api/*` — without `vercel dev` those calls fail gracefully (sync shows `error`, analysis needs a key). |
| Build | `npm run build` | `tsc && vite build` → `dist/`. Build fails on type errors by design. |
| Typecheck only | `npm run typecheck` | `tsc --noEmit`. Scope is `"include": ["src"]` — `api/` and `e2e/` are not typechecked by this command. |
| Unit tests | `npm run test:unit` | `vitest run`, node environment, no config file — picks up every `*.test.ts(x)` outside `node_modules`. Tests mock `fetch`/`localStorage`/Upstash: they must never hit real endpoints (gate G2). |
| Watch mode | `npm run test:watch` | Same suite, interactive. |
| Lint | `npm run lint` | ESLint, zero-warning budget. |
| Send-path gate | `./scripts/gate/check-no-send-paths.sh` | Exits 2 if `src/` grows a programmatic wa.me/mailto/WhatsApp-API send path (gate G4). |

## Environment variables (names only — values live in Vercel, never in the repo)

Required by the serverless APIs (`api/*.ts`):

- `ANTHROPIC_API_KEY` — Claude proxy (`api/analyze.ts`)
- `ACCESS_CODE` — shared auth code checked via `X-Access-Code` header (`api/analyze.ts`, `api/data.ts`)
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — Upstash Redis blob for cross-device sync (`api/data.ts`)
- Enrich Layer key — LinkedIn enrichment (`api/linkedin.ts`)
- Gemini key — transcription (`api/transcribe.ts`)

None of these are needed to run the client or the unit tests: the client works in direct mode with a user-supplied key, and every test mocks its dependencies. Do not put values in `.env` files inside the repo.

## Branch model: what `v3-jump` + preview means

- **`main` = production.** Vercel auto-promotes `main` to the production deployment used daily. Merging to `main` is gate **G1** — lead + Eliran only.
- **`v3-jump` = the V3 build branch.** All Wave work lands here in small commits (lead commits; teammates never `git commit`/`push`). Pushing `v3-jump` produces a **Vercel preview deployment** — a separate URL, same env vars, safe to demo.
- **Preview write guard:** on preview deployments (`VERCEL_ENV === 'preview'`) new data paths are read-only/503 unless `PREVIEW_DATA_OK` is set — a preview must never mutate the live Upstash blob (gate G2).
- Live-data operations of any kind (migrations, imports, deletes against the real blob or Revital's localStorage) are gate G2: dry-run and flag-gated only, rehearsed on a copy.

---

# §2 — Operating the V3 board (Wave 1)

## The v3 flag

- One flag: localStorage key `revital_v3_flag`, value `'on'`. **Default OFF.**
- On: the לוח nav entry appears, `PipelineView` renders the live board. In-app, `usePipelineStore.getState().setV3Flag(true)` flips it reactively (no reload); from DevTools, `localStorage.setItem('revital_v3_flag','on')` + reload.
- Off: the board renders `null`, the nav entry disappears, and **every** v3 entry point (Screener, backfill even with `confirm:true`, `pullV3`/`pushV3`) is a no-op — zero `revital_v3_*` keys are written and no network call fires. Pinned by `src/views/Pipeline/quality-gate.flag-regression.test.tsx`.
- **Rollback = flag off, nothing else.** All v3 data lives under `revital_v3_*` keys; legacy `revital_*` keys are never touched by v3 flows (byte-identical, test-pinned).

## Backfill (dry-run FIRST — gate G2 discipline)

- `backfillDryRun(analyses)` (`src/lib/backfill.ts`) returns a report — `wouldCreatePersons / wouldAttachPersons / wouldFlagMergePersons / wouldCreateDeals / skipped / items` — and mutates **nothing**. Read it before any apply.
- `backfillApply(analyses, { confirm: true })` runs only when the flag is on AND `confirm: true` is passed explicitly; anything else returns the dry-run report untouched (`reason: 'flag_off' | 'not_confirmed'`).
- Apply takes an automatic backup of all v3 collections to `revital_v3_backfill_backup` (latest run only) before mutating. Cards land in **Screened only** (plan §2). Deterministic ids (`p_bf_*`/`d_bf_*`) make re-runs no-ops; the Screener's cards block backfill duplicates and vice versa.
- Rehearse on a preview deployment / copy first — never first-run against Revital's live localStorage.

## Undo

- Moves (drag or `moveDeal`) and suggestion **accepts** push an in-memory undo snapshot — stack cap 20, same-session only, deliberately not persisted. Dismissals are not undoable (re-filing a suggestion is non-destructive).
- After a drag the UI shows a 6-second toast with כפתור ביטול → `undoLast()`.
- `undoLast()` restores the prior stage / bench state / suggestion status / `nextAction`, keeps the record's current server `v` (so an undo after sync is an ordinary LWW edit, never a stale write), and appends a compensating StageEvent (`actor:'system'`, `reason:'undo'`) — history stays append-only.

## Sync behavior (v3 section of /api/data)

- Client wiring in `src/lib/persistence/sync.ts`: requests opt in via the `X-Revital-V3: 1` header; without it the legacy wire response stays byte-identical (legacy V2 sync untouched).
- `pushV3` sends **only dirty records** (`buildPushPayload`), adopts server-stamped versions straight from the POST echo, then clears dirty ids (`markSynced`). `pullV3` GETs the blob and LWW-merges `v3.*` into the store. `syncV3OnLoad` = pull then push.
- Flag off ⇒ both return `{ ok:false, skipped:'flag_off' }` without calling `fetch` (test-pinned).
- Structured failure surfaces (never thrown into UI paths): `413` = blob hard cap (`alert`), `503` = preview-env read-only guard (`readOnly: true`), `sizeWarning` at the ~800KB warn threshold.

## What Wave 1 deliberately does NOT include

- **Fees / EV ₪** — column headers show a count and the literal `ΣEV —` placeholder. No ₪ figure appears anywhere on the board (calibration rule, test-pinned). Fees/EV arrive Wave 2.
- **Server-side agents** — the Screener is client-side and event-driven only; `api/agents/tick.ts` is a guarded stub with no scheduled logic.
- **Bench sourcing** — the Bench rail exists (Rejected/Bench moves file the person there) but there is no `bench_sourcer` agent re-surfacing benched candidates yet.
- **Reject-with-reason via drag** — the Rejected column is not a droppable target (a drag gesture cannot carry the mandatory reason); rejection flows through a dedicated UI in a later wave.
- **merge_person application** — accepting a merge suggestion records the decision only; the actual person-merge flow ships with Wave 2's dedicated merge UI.

## Wave-1 verification surface (quality-gate)

- Cross-teammate seam suites: `src/views/Pipeline/quality-gate.board-seams.test.tsx` (screener→store→board, drafts→accept→wa.me hash stability, undo across UI, single-writer, `dir="auto"`) and `quality-gate.flag-regression.test.tsx` (flag on/off inertia + key hygiene).
- Send-path gate: `./scripts/gate/check-no-send-paths.sh` — Wave 1 adds strict call-shaped patterns (`window.open(`, `location.href =`, `location.assign(`/`replace(`, `sendBeacon(`) under `src/views/**` and `src/agents/**`, plus `fetch` to `wa.me`. The gate itself is pinned by `scripts/gate/check-no-send-paths.test.ts` (must exit 0 on the repo, 2 on each violation class).

---

# §3 — The agent tick, the bridge, and money-loop operations (Wave 2)

## Invoking the tick (`/api/agents/tick`)

- **POST only.** The Wave-0 stub's GET allowance is gone; GET returns 405 by contract.
- **Auth (fail-closed):** either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`. Wrong secret → 401. If the deployment has **no** `CRON_SECRET` configured, every call → 503 — an unprotected tick never runs.
- **Preview guard:** on preview deployments (`VERCEL_ENV=preview`) without `PREVIEW_DATA_OK` the tick returns 503 — a preview must never write the live blob (G2).
- **Body:** `{ "codes"?: string[], "budgetMs"?: number }`. Omitted `codes` falls back to env `TICK_CODES` (csv). No codes anywhere → honest 200 no-op (`ran: []`, a `note`, zero reads/writes). `budgetMs` defaults to 8000; the loop always finishes the first code, then stops before the budget and returns `partial: true` — the caller re-invokes for the rest (chunked continuation; the per-run `cursor` is the blob vCounter at processing time).
- **Response:** `{ ok, ran: [{code, agent, produced, cursor, error?}], partial }`. Per-code failures are isolated into `error` entries — one broken blob cannot sink the fan-out.
- **What it runs:** two deterministic passes per code — SLA silence sweep (`outreach_runner`, 3-day rule) and Pit Boss ranking (`pit_boss`). **No LLM calls, ever, in the tick.** Deterministic per-episode suggestion ids + LWW staleness make the daily re-run idempotent: an episode already filed or dismissed is dropped, never duplicated or resurrected.
- **Server money honesty:** MandateFees and edited priors are client-local in Wave 2 (`revital_v3_fees` / `revital_v3_priors`, not in the sync payload), so the server tick ranks with empty fees + default priors — its suggestions carry day-count evidence and **no ₪** (calibration-safe by construction; seam-tested). ₪-ranked "Today" lives client-side where the fees exist.

### Validating a deployed tick

```
TICK_URL=https://<deployment>/api/agents/tick CRON_SECRET=... ./scripts/gate/tick-check.sh
```

Asserts, without touching any data (`codes: []` is a no-op): GET+valid secret → 405; wrong secret (both header forms) → 401; missing auth → 401; valid POST → 200 with `{"ok":true,"ran":[],"partial":false}`. **Not remotely testable:** the 503 fail-closed branch when the server has no `CRON_SECRET` — a deployment's env cannot be unset from outside; that branch is pinned locally by `api/_lib/guard.test.ts` and `api/agents/tick.test.ts`. The script itself is self-tested against a local stub (`scripts/gate/tick-check.test.ts`).

## ⚠ Scheduling mismatch — FLAG FOR LEAD (G1 packaging)

**Vercel Cron invokes its target with GET** (sending `Authorization: Bearer <CRON_SECRET>`), but the Wave-2 contract makes the tick **POST-only** — so a naive `crons` entry in `vercel.json` would bounce off the 405 forever and **no scheduled tick would ever run**. `vercel.json` currently has **no** `crons` entry, so nothing is silently broken today — but G1 packaging must pick one of:

1. **GET-accepting wrapper** — a thin `api/agents/cron.ts` that (a) runs the same `requireCronSecret` + preview guard, (b) invokes the tick logic (`createTickHandler` internals or a shared function) with no body (env `TICK_CODES` + default budget), for Vercel Cron to call via GET. Keeps scheduling inside Vercel; the POST contract endpoint stays as-is for manual/scripted invocation.
2. **External POST scheduler** — GitHub Actions cron / Upstash QStash / any scheduler POSTing with `x-cron-secret`. No new endpoint, but the schedule lives outside Vercel and the secret lives in a second system.

Either way, `scripts/gate/tick-check.sh` validates the deployed endpoint after packaging (its GET→405 check would need updating if option 1 makes GET meaningful on the *wrapper* — the tick endpoint itself stays POST-only).

## Agent bridge rails (`api/_lib/agentStore.ts`)

Until G3, the tick persists through the **existing Redis v3 blob** (`revital:data:{code}`) via the `AgentStore` interface. The rails are enforced in code, not promised:

- **Single writer:** `write()` accepts ONLY `suggestions` + `agentRuns`; `persons`/`deals`/`events` are carried forward from a fresh read taken immediately before the set — there is no code path by which an agent can write card state. (Seam-tested end-to-end: after a tick, persons/deals/events and all legacy blob sections are byte-identical.)
- **Server-assigned versions:** the same `serverMergeCollection` the client sync uses stamps `v` server-side; deterministic suggestion ids means a re-emitted episode is dropped as stale (dismissals stay final).
- **Bounded blob:** `agentRuns` rotated to ≤200 (newest by `v`); any write that would push the blob past the 1.5MB hard cap (same limit as `api/data.ts`) throws instead of writing.
- **Fail-closed:** no Redis configured ⇒ `load`/`write` throw and the tick records the per-code error — the write path never silently no-ops.

## G3 Supabase swap plan

- The tick depends only on the `AgentStore` interface. `supabaseAgentStore(client)` is the second impl, already written against `SupabaseAgentClient` — the in-memory mock today, `supabase-js` (service-role key) after G3 signup (Eliran's click). `supabase/schema.sql` (events append-only, agent_runs, suggestions, fee ledger) is in the repo.
- The importer (`src/lib/persistence/agentStoreImporter.ts`) is flag-gated, dry-run-first, auto-backup — G2 discipline applies: rehearse on a copy.
- Post-G3 the fee ledger gives the server real fees: `rankMoveTheMoney` already takes fees as input, so server-side ₪ ranking activates with **zero tick code changes** — calibration gating continues to apply unchanged.

## Spend caps: untouched by cron (verified)

The per-code daily spend caps (`api/_lib/spend.ts` `checkAndCount`) are imported by exactly three endpoints: `api/analyze.ts` (Claude), `api/transcribe.ts` (Gemini), `api/linkedin.ts` (Enrich). Neither `api/agents/tick.ts` nor `api/_lib/agentStore.ts` imports the spend module or any LLM client — the tick is deterministic and consumes no paid quota. Pinned by `api/agents/tick.test.ts` ("tick spend rail") and re-verified by grep for this runbook. The caps' behavior is unchanged from Wave 0; the Reporter's optional `polishWithClaude` remains client-triggered, default OFF, and routes through `/api/analyze`'s existing cap when enabled.
