# Charter: agents-engine

## Mission context
Revital AI (React18+TS+Vite+Zustand+Tailwind, Vercel serverless: `api/analyze.ts` Claude proxy, `api/linkedin.ts` Enrich Layer, `api/transcribe.ts` Gemini, `api/data.ts` Upstash sync) is evolving into the V3 Placement OS: deal Kanban + propose-only product agents (Screener, Bench Sourcer, Outreach Runner, Client Reporter, Pit Boss). You are the **agents-engine** teammate. Repo: `/Users/mymacbook/dev/revital`, branch `v3-jump`. Read `docs/REVITAL-V3-PRODUCT-PLAN.md` and `CLAUDE.md` before your first task — the plan is the contract.

## Safety rails (verbatim, non-negotiable)
No outbound send path exists architecturally — only human-clicked `wa.me`/`mailto` links; every agent output lands as a Suggestion until Revital accepts it; **card state has exactly one writer** (client path; agents write only to suggestions/agent_runs — plan §3); append-only audit log with rotation; one-click undo; tombstoned deletes with server-assigned versions; feature flag default-off; per-code daily spend caps on Claude, Enrich Layer, and Gemini; preview-env write guard (`VERCEL_ENV === 'preview'` without `PREVIEW_DATA_OK` ⇒ new data paths read-only/503); `api/agents/tick` requires `CRON_SECRET`.

## Cut list (verbatim)
No LinkedIn automation, no paid sourcing APIs, no WhatsApp API sending, no auto-send, no vector DB, no full UI i18n, no auth rewrite, no multi-tenancy, no Buzz in-product, no realtime presence theater.

## Hard gates (verbatim)
G1 ship · G2 live data (live Upstash blob / her localStorage: additive reads only) · G3 money/services (no signups; mock/local only) · G4 real outreach (structurally impossible). Everything else: decide autonomously and log one paragraph in `docs/DECISIONS.md` (append-only).

## Your exclusive file set
`src/agents/**`, `api/agents/**`, `src/lib/audit.ts`; you are the sole teammate allowed inside `api/analyze.ts` (spend guard), and for Wave 0 also `api/linkedin.ts` + `api/transcribe.ts` (spend caps only — minimal diffs) and the new shared `api/_lib/**`. **Never edit any other path.** No `package.json`/config edits. Do not run `git commit`/`push` — the lead commits.

## Wave 0 tasks (in order)
1. `src/lib/audit.ts` — append-only audit-log module: `AuditEvent {id, actor: 'human'|'ai', agent?, action, entityType, entityId, before, after, ts}`, creation helpers, client-side rotation (keep last N≈500 per entity), pure functions + unit tests. Import types from `src/types/pipeline.ts` if it exists yet; if not, define local types in `src/lib/audit.ts` marked `// TODO(lead): unify with types/pipeline.ts` and keep them structurally minimal.
2. `api/_lib/guard.ts` — preview-env write guard helper: `previewWriteBlocked()` returns true when `process.env.VERCEL_ENV === 'preview'` and `!process.env.PREVIEW_DATA_OK`; plus `requireCronSecret(req)` helper for future `api/agents/tick`.
3. `api/_lib/spend.ts` — per-access-code daily spend caps backed by the same Upstash Redis (key `revital:spend:{code}:{yyyy-mm-dd}:{service}`, INCR + TTL 48h): `checkAndCount(code, service, limit)` for services `claude` | `enrich` | `gemini`. Limits from env (`SPEND_CAP_CLAUDE` etc.) with sane defaults (e.g. 200/40/40 calls/day). Graceful: on Redis failure, allow the call (fail-open) but include a `spendGuard:'unavailable'` field.
4. Wire the guard into `api/analyze.ts`, `api/linkedin.ts`, `api/transcribe.ts` — minimal diff: after auth, `checkAndCount`; over cap ⇒ 429 with a clear Hebrew-friendly error message field. No behavior change otherwise.
5. `api/agents/tick.ts` — Wave-0 stub only: requires `CRON_SECRET` header, respects preview guard, returns `{ok:true, ran:[]}`. No agent logic yet.
6. Unit tests for audit rotation + spend-key logic (pure parts; mock Redis).

## Definition of done
`npm run typecheck` clean; `npm run test:unit` green; zero new console errors; agent actions write audit entries; no new send paths. Log autonomous calls in `docs/DECISIONS.md` (append `## D-xxx (agents-engine)`).

## Final report
Return: files built, how caps behave at/over limit, test results, decisions logged, blockers.
