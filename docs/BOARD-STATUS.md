# V3 Board Status

**Wave:** 2 — Money + Loop (opened 2026-07-31; Wave 1 checkpoint green, tag v3-wave1: 407/407 tests, build green, send-path gate clean, board visually verified)
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
| kanban-ui | Wave 2B done | money header (qualified ₪ + this-month + early range) + priors editor + EV ranges on cards/columns + FeeCapture (drag→Placed + lane editor) + MoneyBoard swimlanes + "כסף" tab + Today ranked by LIVE pitboss (bridge flipped in-batch) + export/backfill tools menu + editedBeforeAccept stamping; 635/635 green, typecheck clean, G4 gate 0; D-032/D-033 |
| quality-gate | Wave 1 done | seam smoke suites (board+store+outreach, flag on/off) + extended G4 gate + gate self-test + RUNBOOK §2; 407/407 green |

## Blockers
- None. Push RESOLVED 2026-07-31: gh device-flow authorized by Eliran via browser; v3-jump + v3-wave0 on GitHub, Vercel preview building.
- FIX(platform-data), non-blocking: absorb the `editedBeforeAccept` stamp into `acceptSuggestion(id, opts?: { editedBody?: string })` — the store action takes no options today, so kanban-ui pre-patches the pending record via `src/views/Inbox/acceptDraft.ts` (D-033) before routing through `acceptSuggestion`; once the store owns it, delete the helper and re-point the two call sites (SuggestionsQueue, TodayView approvals).
- CONFIG (kanban-ui → lead, RESOLVED Wave 1): jsdom/@testing-library installed and Pipeline wiring applied — both honored at Wave-1 open (D-016).
- CONFIG (kanban-ui → lead, OPTIONAL — nothing blocked): standalone `'inbox'` / `'today'` view keys if wanted; Wave 1 ships both inside the board (inbox panel + היום tab). Contract in `src/views/Pipeline/README.md` + `src/views/Inbox/README.md`.

## Flagged for Eliran review
- **`api/data.ts` v2 proposal ready for lead line-by-line review:** `docs/diffs/api-data-v2.ts` + `docs/diffs/api-data-v2-RATIONALE.md` (platform-data, Wave 0 task 4). Not applied; live file untouched.

## Stop protocol (desktop-app loop discipline — .claude hooks do not fire here)
A turn may end ONLY with one of: (a) background agents running AND a fallback wakeup armed; (b) a `GATE-WAIT: G<n> — <what>` line in this file; (c) `MISSION: DONE` per rule 27. Anything else = re-enter THE LOOP (rule 12).

## GATE-WAIT (Eliran clicks — none block Wave-2 build work)
- **G1-lite — Vercel Git connect + main fast-forward:** Vercel project `revital` is NOT git-connected (CLI-deployed); production bundle CONTAINS the uncommitted fingerprint WIP, so GitHub main is BEHIND production. Package: (1) push `wip-fingerprint-drive` onto main (fast-forwards main to == production), (2) Vercel → revital → Settings → Git → Connect `Elirank1/revital` (production branch main → content no-op deploy), (3) previews for v3-jump start flowing. Until then: no cloud previews; local dev serves demos.
- **Seeding session with Revital** (Wave-1 human checkpoint): 1–2h — fees, true stages, baseline metrics. Board stays in calibration mode by design until then.
- **REVITAL_ACCESS_CODE** needed for the G2-safe snapshot + merge rehearsal on a COPY of her blob.

## Gates status
G1 ship / G2 live-data / G3 paid services / G4 real outreach — all untouched.

## Baseline (quality-gate)
Captured 2026-07-31 on `v3-jump`, local clone `~/dev/revital`, node v22.22.2, vitest 3.2.7.

- **Before Wave-0 test work:** `npm run typecheck` clean (exit 0) — including other teammates' in-flight untracked files under `src/`. `npm run test:unit` exited 1 with "No test files found" (zero tests existed in the repo; pre-existing condition, not a regression).
- **After legacy smoke suite:** typecheck clean (exit 0); `npm run test:unit` green — 10 files, 172 tests, 0 failures, ~0.7s (61 of those are quality-gate legacy-smoke tests: appStore 25, analyzer 11, parser 13, api/data 12; the rest belong to other Wave-0 owners and also pass).
- **Pre-existing warnings:** none surfaced by tsc or vitest. Known scope gap, not a warning: tsconfig `include` is `["src"]`, so `api/**` (and future `e2e/**`) are not covered by `npm run typecheck`.
- Send-path gate: `scripts/gate/check-no-send-paths.sh` exits 0 on current `src/` (verified to exit 2 with offending lines on a synthetic violation fixture).

## Wave 1 baseline (quality-gate)
Captured 2026-07-31 on `v3-jump` (HEAD 7d5ad09 + quality-gate Wave-1 files), local clone `~/dev/revital`, node v22.22.2, vitest 3.2.7.

- **Before quality-gate Wave-1 work:** typecheck clean; `npm run test:unit` green — 27 files, **378/378**.
- **After:** typecheck clean (exit 0); `npm run test:unit` green — **30 files, 407/407**, ~3.7s. Delta = 3 new quality-gate suites, +29 tests:
  - `src/views/Pipeline/quality-gate.board-seams.test.tsx` (10, jsdom) — cross-teammate seams: screener→store→board (Screened column + score chip from the read-only legacy subscription, Reject-verdict flag suggestion in the inbox, `agent:'screener'` audit attribution end-to-end); integrations→store→board (openerDraft→addSuggestion→human accept in the rendered queue→wa.me `<a href>` on BOTH queue and card carries the exact draft text; DOM click logs a contact whose hash === `suggestionMessageHash`; bare chat-opener logs `hashMessage('')`); undo across UI surfaces (accept next_action round-trip queue+card, reject→bench-rail→undo un-benches); single-writer proof (pre-click objects frozen and untouched, store swaps new objects, audit appended, v3 persistence updated); `dir="auto"` on every user-content node (card name/title, queue title/body/evidence, bench name/reason).
  - `src/views/Pipeline/quality-gate.flag-regression.test.tsx` (8, jsdom) — flag OFF: full legacy `<App/>` renders (no לוח nav), pipeline view renders nothing, legacy actions write only legacy `revital_*` keys, ALL v3 entry points inert (screener, `backfillApply` even with `confirm:true`, `pullV3`/`pushV3`/`syncV3OnLoad`) with zero `revital_v3_*` keys and zero fetch calls; `attachScreener` retry seam (analysis arriving flag-off cards on first event after flag-on). Flag ON: a full v3 mutation sweep changes ONLY `revital_v3_*` keys (legacy byte-identical, snapshot-diffed), legacy store state reference-untouched, לוח nav appears.
  - `scripts/gate/check-no-send-paths.test.ts` (11, node) — pins the G4 gate itself: exit 0 on the real repo; exit 2 naming the pattern on each violation class (src-wide wa.me `window.open`/`location.href=mailto`/`fetch` to wa.me + graph.facebook; strict any-arg `window.open(`, `location.href =`, `location.assign(`, `sendBeacon(` under `src/views/**` and `src/agents/**`); stays clean when patterns appear only in `*.test.*` or as inert href strings.
- **Send-path gate (extended):** `scripts/gate/check-no-send-paths.sh` now also greps `src/views/**` + `src/agents/**` for call-shaped navigation with ANY argument and `fetch` to `wa.me` src-wide; exits 0 on current `src/`.
- No pre-existing warnings surfaced. tsconfig scope gap unchanged from Wave 0 (`api/**`, `scripts/**` run under vitest but not `npm run typecheck`).

## Wave 2 baseline (quality-gate)
Captured 2026-07-31 on `v3-jump` (HEAD e47d9b7 + quality-gate batch-C files), local clone `~/dev/revital`, node v22.22.2, vitest 3.2.7.

- **Before quality-gate batch C:** typecheck clean; `npm run test:unit` green — 50 files, **635/635**.
- **After:** typecheck clean (exit 0); `npm run test:unit` green — **55 files, 662/662**, ~6.6s. Delta = 5 new quality-gate suites, +27 tests:
  - `src/views/Pipeline/quality-gate.money-seams.test.tsx` (5, jsdom) — fee→EV agreement across header/card/column/lane against HAND-COMPUTED numbers (not lib readback) + a conservation identity (lane midpoint == qualified Σ + early midpoint); Today's ₪-at-risk pinned to dealEV × exported-threshold weights; the FULL server→client loop: tick handler → real `redisBridgeStore` over in-memory Redis → simulated `/api/data` GET → `pullV3` → suggestions rendered in the board inbox (server-assigned versions, single-writer rail byte-identical, pull leaves nothing dirty, zero ₪ across the wire); re-tick idempotency through the real bridge.
  - `src/agents/quality-gate.pitboss-determinism.test.ts` (6, node) — 25 repeated calls byte-identical; input-order independence (deals AND contacts permuted); exact tiebreak order on crafted ties (evAtRisk desc → riskWeight desc → dealId asc); deterministic suggestion ids/inputs; uncalibrated items carry ev:null/evAtRisk:0 and zero ₪ while a calibrated item's suggestion DOES carry ₪ (sensitivity control); empty-fees (server reality) ranks everything money-free.
  - `src/views/Pipeline/quality-gate.calibration-adversarial.test.tsx` (6, jsdom) — eleven hostile uncalibrated shapes at once (no fee / percent-no-salary / salary 0 / fixed 0 / negative / NaN / Infinity / complete-fee-nothing-past-Screened / tombstoned past-Screened / Rejected journey / corrupt fee kind): zero ₪ on board+header+columns+cards, Money Board (all lanes ללא כיול), Today (real at-risk deals DROPPED, not ₪0), inbox rendering tick-path suggestions, and the Client Reporter (text/html/title/evidence); repair-one-fee control proves the sweep detects ₪.
  - `src/reporting/quality-gate.reporter-store-evidence.test.tsx` (6, jsdom) — reporter evidence coverage against STORE-PRODUCED records (addPerson/addDeal/moveDeal/logContact, real StageEvents incl. skip-events): every claim ref resolves to a real record of the right type, no dangling and no cross-mandate evidence; claim texts verbatim in the text rendering; evidence == Σ(claim × refs); frames smuggle no data; funnel counts match live stages; feedback nudge cites deal+person+entry event; no ₪.
  - `scripts/gate/tick-check.test.ts` (4, node) — self-test of the new deployed-tick gate script against a localhost stub: exit 64 usage, exit 0 on a conforming endpoint (secret never echoed), exit 2 on an auth hole or a GET-answering endpoint.
- **New gate script:** `scripts/gate/tick-check.sh` — validates a DEPLOYED `/api/agents/tick` with zero data movement (`codes:[]` no-op): GET+valid secret→405, wrong secret both header forms→401, missing auth→401, valid POST→200 `{"ok":true,"ran":[],"partial":false}`. The 503 no-CRON_SECRET branch is NOT remotely testable (documented in the script + RUNBOOK §3; pinned by unit tests).
- **RUNBOOK §3 added:** tick invocation + validation, agent bridge rails, G3 Supabase swap plan, spend-caps-untouched-by-cron verification (spend module imported only by analyze/transcribe/linkedin — grep-verified).
- **Send-path gate:** `./scripts/gate/check-no-send-paths.sh` exits 0 on current `src/`.
- **⚠ FLAG for lead (G1 packaging) — scheduled tick cannot ship as a naive vercel.json cron:** Vercel Cron invokes with **GET**; the tick is **POST-only** by Wave-2 contract → a `crons` entry would 405 forever and no scheduled tick would run. `vercel.json` has no `crons` today, so nothing is currently broken. Options written up in RUNBOOK §3: (1) GET-accepting wrapper route (`api/agents/cron.ts`, agents-engine/lead territory) running the same guards; (2) external POST scheduler (GitHub Actions cron / QStash) with `x-cron-secret`. `tick-check.sh` validates whichever lands.
- No new FIX lines this batch (all needed symbols were exported; no source gaps hit). Pre-existing open FIX(platform-data) on `editedBeforeAccept` absorption stands. tsconfig scope gap unchanged (`api/**`, `scripts/**` run under vitest but not `npm run typecheck`; the two api-importing jsdom seam suites DO pull `api/_lib/agentStore.ts` + `api/agents/tick.ts` into the `tsc` graph via imports, so those two files are now typechecked transitively).
