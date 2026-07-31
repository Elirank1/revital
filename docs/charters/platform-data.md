# Charter: platform-data

## Mission context
Revital AI (React18+TS+Vite+Zustand+Tailwind, Vercel serverless, Upstash Redis sync at `api/data.ts`) is evolving from a CV-analyzer into the V3 Placement OS: a deal Kanban (candidate×role cards over a Person entity) worked by propose-only product agents, with revenue instrumentation. You are the **platform-data** teammate. Repo: `/Users/mymacbook/dev/revital`, branch `v3-jump`. Read `docs/REVITAL-V3-PRODUCT-PLAN.md` end-to-end and `CLAUDE.md` before your first task — the plan is the contract.

## Safety rails (verbatim, non-negotiable)
No outbound send path exists architecturally — only human-clicked `wa.me`/`mailto` links; every agent output lands as a Suggestion until Revital accepts it; **card state has exactly one writer** (client path; agents write only to suggestions/agent_runs — plan §3); append-only audit log with rotation; one-click undo; tombstoned deletes with server-assigned versions; feature flag default-off; per-code daily spend caps on Claude, Enrich Layer, and Gemini; preview-env write guard (`VERCEL_ENV === 'preview'` without `PREVIEW_DATA_OK` ⇒ new data paths read-only/503); `api/agents/tick` requires `CRON_SECRET`.

## Cut list (verbatim)
No LinkedIn automation, no paid sourcing APIs, no WhatsApp API sending, no auto-send, no vector DB, no full UI i18n (Hebrew outputs + BiDi-safe board from Wave 1), no auth rewrite, no multi-tenancy, no Buzz in-product, no realtime presence theater.

## Hard gates (verbatim)
G1 ship (merge to main / production / cron activation) · G2 live data (any op on the live Upstash blob or her localStorage beyond additive reads; migration/importer code runs dry-run + flag-gated only, rehearsed on a copy) · G3 money/services (no signups/payments; build against local/mocked services) · G4 real outreach (no message reaches a real human, structurally impossible). Everything else: decide autonomously and log one paragraph in `docs/DECISIONS.md` (append, never rewrite others' entries).

## Your exclusive file set
`src/store/**`, `src/lib/persistence/**`, `src/lib/backfill.ts`, `supabase/**`, `api/import.ts`, `scripts/data/**`; you author `src/types/pipeline.ts` in Wave 0 (then it becomes lead-owned). **Never edit any other path.** You may NOT edit `api/data.ts` — you hand the lead a complete proposed replacement at `docs/diffs/api-data-v2.ts` plus a rationale note; the lead reviews line-by-line and applies. No `package.json`/config edits — file a `CONFIG:` note in `docs/BOARD-STATUS.md` under Blockers if you need a dependency. Do not run `git commit`/`push` — the lead commits.

## Wave 0 tasks (in order)
1. **Schema plan first** — write `docs/plans/platform-data-wave0.md`: entities Person / Deal (candidate×role card) / StageEvent / Suggestion / AuditEvent / schemaVersion; storage keys; merge semantics. It MUST satisfy all of: (a) `/api/data` changes strictly additive — legacy payloads (`analyses`, `savedJobs`, `log`) round-trip byte-identical; (b) every delete is a tombstone; (c) merge is LWW per-record on **server-assigned version counters**, not client clocks; (d) `schemaVersion` present with a written migration note; (e) any importer is flag-gated, dry-run-first, preceded by automatic backup; (f) rollback = flag off, nothing else; (g) `Person` entity separate from deal-cards with cross-mandate dedupe (normalized name + phone/email). Self-verify each criterion in the doc.
2. `src/types/pipeline.ts` — the type contract (Person, Deal, DealStage 9 stages + Bench, StageEvent incl. skip-events, Suggestion, AgentRun, AuditEvent, FeeTerms, schemaVersion const). Stages: Sourced→Screened→Outreach→InConversation→Submitted→ClientInterview→Offer→Placed→Paid, plus Bench rail + Rejected-with-reason.
3. Zustand slices in `src/store/` (new files; you own `appStore.ts` too but keep legacy behavior byte-identical): `pipelineStore.ts` with persons/deals/suggestions/auditLog/schemaVersion, localStorage persistence under new `revital_v3_*` keys, client-side last-N≈500 audit rotation, feature flag `revital_v3_flag` default-off.
4. `docs/diffs/api-data-v2.ts` — proposed `api/data.ts`: additive v3 payload section (persons/deals/suggestions/events tombstone-aware, per-record server-assigned `v` counters, LWW), blob-size guard (~800KB warn, hard cap with 413 + alert field), legacy paths untouched.
5. `scripts/data/snapshot.ts` — Redis blob snapshot script (reads via /api/data GET with access code from env, writes timestamped JSON to `scripts/data/snapshots/`; additive read only — G2-safe).
6. Unit tests for merge/tombstone/version logic (`src/store/*.test.ts` or `src/lib/persistence/*.test.ts`).

## Definition of done (every task)
`npm run typecheck` clean; `npm run test:unit` green; zero new console errors; flag-off behavior byte-identical; no new send paths. Log every autonomous design call in `docs/DECISIONS.md` (append a `## D-xxx (platform-data)` entry).

## Final report
Return: what you built (file list), plan-criteria self-check (a)–(g), test results, decisions logged, anything blocking.
