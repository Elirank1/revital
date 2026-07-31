# Revital — CLAUDE.md

React 18 + TypeScript + Vite + Zustand + Tailwind CV-analyzer evolving into the V3 Placement OS.
Vercel serverless APIs: `api/analyze.ts` (Claude proxy), `api/data.ts` (Upstash sync), `api/linkedin.ts` (Enrich Layer), `api/transcribe.ts` (Gemini).
Contract for all V3 work: `docs/REVITAL-V3-PRODUCT-PLAN.md`. Where plan and codebase conflict, the plan wins; deviations go to `docs/DECISIONS.md`.

---

# V3 Build Rules

## Safety rails (non-negotiable — mission rule 2)
No outbound send path exists architecturally — only human-clicked `wa.me`/`mailto` links. Every agent output lands as a Suggestion until Revital accepts it. **Card state has exactly one writer** (client path; agents write only to suggestions/agent_runs — plan §3). Append-only audit log with rotation; one-click undo; tombstoned deletes with server-assigned versions; feature flag default-off; per-code daily spend caps on Claude, Enrich Layer, and Gemini; preview-env write guard (`VERCEL_ENV === 'preview'` without `PREVIEW_DATA_OK` ⇒ new data paths read-only/503); `api/agents/tick` requires `CRON_SECRET`.

## Cut list is law (plan §7 — mission rule 3)
No LinkedIn automation, no paid sourcing APIs, no WhatsApp API sending, no auto-send, no vector DB, no full UI i18n (Hebrew **outputs** + BiDi-safe board from Wave 1; chrome i18n scaffold only in Wave 3), no auth rewrite, no multi-tenancy, no Buzz in-product, no realtime presence theater.

## Hard gates (mission rule 6) — only these stop for Eliran
- **G1 — Ship:** merging to main, promoting to production, activating Vercel cron.
- **G2 — Live data:** any operation on the live Upstash blob or Revital's localStorage beyond additive reads. Migration/importer code runs dry-run + flag-gated only; rehearse on a **copy**.
- **G3 — Money/services:** signing up for or paying anything (Supabase project, Vercel Pro, Buzz). Build against local/mocked services and stop at the signup step.
- **G4 — Real outreach:** no message reaches a real human. Structurally impossible + tested: e2e blocks external network, asserts `wa.me`/`mailto` hrefs without navigating, synthetic fixtures only.
Everything else is autonomous; log the call in `docs/DECISIONS.md`.

## File ownership (exclusive and disjoint — plan §6)
| Owner | Exclusive paths |
|---|---|
| kanban-ui | `src/views/Pipeline/**`, `src/views/Inbox/**`, `src/components/pipeline/**` |
| platform-data | `src/store/**`, `src/lib/persistence/**`, `src/lib/backfill.ts`, `supabase/**`, `api/import.ts`, `scripts/data/**`; authors `src/types/pipeline.ts` in Wave 0 then hands to lead |
| agents-engine | `src/agents/**`, `api/agents/**`, `src/lib/audit.ts`; sole teammate allowed inside `api/analyze.ts` (spend guard) |
| integrations | `src/lib/outreach/**`, `src/reporting/**`, `src/views/Reports/**`, `src/i18n/**` |
| quality-gate | `e2e/**`, `scripts/gate/**`, `docs/RUNBOOK.md`; may create new `*.test.ts` files anywhere but never edits source or another owner's existing tests |
| lead only | `src/types/**` (post-Wave-0), `api/data.ts`, router/app entry (`src/App.tsx`, `src/main.tsx`), `package.json` + lockfile, `vercel.json`, `tsconfig*`, `.claude/**`, `CLAUDE.md`, `docs/**` |

Never edit outside your set. Need a change elsewhere → file a task for the owner or a `CONFIG:` request to the lead. `api/data.ts` and storage-key changes go to the lead as a diff for line-by-line review.

## Task hygiene (mission rule 13)
Claim one task at a time; mark complete immediately when done — the completion gate must pass; report blockage the moment it happens, stating exactly what blocks you; commit small and often to `v3-jump`; never edit outside your file set; `FIX(<owner>):` tasks outrank feature tasks.

## Definition of done (mission rule 24)
Typecheck clean; unit tests for store/engine/agent logic; zero new console errors; UI BiDi-safe (`dir="auto"` on user content, logical CSS) and Today/quick-actions responsive at 390px from Wave 1; flag-off behavior byte-identical; agent actions write audit entries; no new send paths.

## Branch discipline
All work on `v3-jump`. **Never merge to main** — Vercel auto-promotes main to production; both are gate G1.
