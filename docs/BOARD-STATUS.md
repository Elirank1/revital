# V3 Board Status

**Wave:** 3 COMPLETE — final audit (2026-08-01; tag v3-wave3. Wave-3 baseline: typecheck clean, 852/852 unit, e2e 14 pass + 1 documented fixme, G4 gate 0. Rule-27 audit below: 34 MET / 5 UNMET + 1 hygiene at capture — post-audit closures same day lift it to 37 MET / 2 UNMET (③.3 kanban-ui D-059; ⑥.2/⑥.3 agents-engine D-057/D-058; unit now 889/889, e2e 15/15). Wave-2 checkpoint history: tag v3-wave2, 662/662, build green, money UI live-verified)
**Branch:** `v3-jump` (from main @5949b2a) · **No merge to main until G1.**
**Working copy:** `~/dev/revital` (local clone; Drive checkout is frozen, see DECISIONS D-001/D-003)

## Wave 0 goal (plan §6)
Contracts + safety: pipeline types with schemaVersion; Zustand slices; `/api/data` additive merge (tombstones, server-assigned versions, blob-size guard); snapshot script; audit-log module; spend guards (Claude + Enrich Layer + Gemini); preview-env guard; route + flag scaffold; `wa.me` composer with auto-log-contact; legacy smoke suite.
**Checkpoint:** schema sign-off (lead plan approval), legacy suite green, typecheck clean.

## Teammate states
| Role | State | Current |
|---|---|---|
| platform-data | C-seed done | progressive in-product seeding data layer (D-042): seeding slice `revital_v3_seeding` (markMandateSeeded audited+idempotent, isMandateSeeded, unseededMandates) + `mandateCalibrated` EXTENDED to seeded AND fee AND stage (fail-closed registry default — 3-arg callers enforce it unchanged; leak sweeps green) + `deriveBaseline` (nulls over fiction) + `asyncSeedingFormText` (Hebrew, BiDi-safe, no ₪, no LLM); 843/843 green (66 files, +20), typecheck clean, G4 gate 0; D-046/D-047 |
| agents-engine | Final gap-closing dispatch done (⑥.2 + ⑥.3) | Guarantee-window pass `src/agents/guarantee.ts` (ENDING ≤7d 'flag' + ENDED 'next_action'; MandateFee authority → synced Deal.fee fallback so the SERVER tick fires pre-G3; placement = Placed event → Paid event → stageEnteredAt) + invoice-reminder pass `src/agents/invoices.ts` (none/due ⇒ להוציא חשבונית past guarantee, sent+stale ⇒ תזכורת תשלום via dueAt-immediate or 14d-record basis, paid never; cross-pass guarantee_pending dedupe) — both pure + client on-load sweep (runGuaranteeSweepOnLoad/runInvoiceSweepOnLoad, injectable stores, flag-gated, wiring = kanban-ui/lead like the SLA sweep) + folded into the tick's pit_boss batch (response shape unchanged, cron inherits); deterministic episode ids, dismissals final, zero ₪ by construction; 889/889 (69 files, +37), typecheck clean, send-path gate exit 0; D-057/D-058. Prior: Wave 3B bench pass (D-038), Wave 2 tick/SLA/Pit Boss, Wave 0 audit+spend+guards |
| integrations | in progress | wa.me composer vs interface stub |
| kanban-ui | ③.3 gap closed (final) | rule-27 audit ③.3 (D-059): legacy V2 header made mobile-safe — `Header.tsx` nav strip scrolls internally at narrow widths (`min-w-0 overflow-x-auto` on the `<nav>` only + cross-engine hidden scrollbar via arbitrary Tailwind utilities, `shrink-0` logo/status/buttons; no new dependency, no redesign, RTL-safe logical layout, dark-mode untouched; desktop where the chrome fit before is byte-identical — measured 390:390/390, 768:768/768, 1280 nav fully fits); e2e fixme flipped to a live page-level `scrollWidth <= clientWidth` assertion (legacy dashboard + היום, 390px), verified to bite via revert⇒fail/restore⇒pass; typecheck clean, 852/852 unit, e2e 15/15 (0 fixme), G4 gate 0. Prior: C-seed seeding wizard (D-050/D-051), Wave 3B (D-044) |
| quality-gate | Wave 3 COMPLETE (final dispatch done) | Final dispatch: seeding-wizard e2e (`e2e/seeding-wizard.e2e.ts`, 3 tests, deterministic ×3 repeats) — D-042 pinned BOTH directions at e2e level (complete fee in the seed payload + no seeding record ⇒ chip visible AND zero ₪ anywhere; full in-browser wizard completion — FeeCapture fee, stage-picker→moveDeal, confirm, finish ⇒ ₪ lifts same-paint for that mandate ONLY, seeding/fee/audit records pinned in localStorage; dismiss ⇒ chip persists, board drag works with the panel open, picker mirrors the drag live); Wave-3 regression baseline + full rule-27 DONE audit recorded below (34 MET / 5 UNMET + 1 hygiene); D-055/D-056. Prior batch C: 12-test e2e suite, dependency audit, RUNBOOK §4–§8 (D-048/D-049). |

## Blockers
- None. Push RESOLVED 2026-07-31: gh device-flow authorized by Eliran via browser; v3-jump + v3-wave0 on GitHub, Vercel preview building.
- FIX(lead → kanban-ui or V2 owner) RESOLVED 2026-08-01 (kanban-ui, D-059): the legacy V2 header is now mobile-safe — at 390px the icon nav scrolls internally (`overflow-x` on the `<nav>` element only, scrollbar hidden, `shrink-0` logo/status/buttons) instead of pushing `document.scrollWidth` to ~547px; page-level horizontal scroll is gone on every view, legacy included. The parked `test.fixme` in `e2e/mobile-today.e2e.ts` is flipped to a live assertion and passing (suite 15/15, 0 fixme). Audit row ③.3 → MET. Original finding: header ~547px min-content at 390px, every view h-scrolled on phones; pre-existing V2 behavior.
- CONFIG (quality-gate → lead, OPTIONAL): add `test-results/` and `playwright-report/` to `.gitignore` (Playwright failure artifacts; the suite currently leaves nothing behind on green runs, and this batch's artifacts were cleaned). `.gitignore` is not quality-gate's file.
- NOTE (quality-gate, transient conflict OBSERVED+RESOLVED during Batch C): platform-data's C-seed landing briefly broke `src/views/Pipeline/MoneyBoard.test.tsx` (2 tests, mandateCalibrated now requiring seeding) mid-dispatch; platform-data adapted the suite in the same window — full suite back to 843/843 before this batch closed. No action needed; logged so the red in any interim CI capture is explained.
- FIX(platform-data) RESOLVED end-to-end (Wave 3): store absorbed `acceptSuggestion(id, opts?: { editedBody? })` in 3A (D-036); kanban-ui re-pointed both call sites (SuggestionsQueue, TodayView) and retired the `acceptDraft.ts` pre-patch to a `@deprecated` thin alias kept only for the Wave-2 test imports that pin the absorbed semantics (D-044).
- CONFIG (kanban-ui → lead, RESOLVED Wave 1): jsdom/@testing-library installed and Pipeline wiring applied — both honored at Wave-1 open (D-016).
- CONFIG (kanban-ui → lead, OPTIONAL — nothing blocked): standalone `'inbox'` / `'today'` view keys if wanted; Wave 1 ships both inside the board (inbox panel + היום tab). Contract in `src/views/Pipeline/README.md` + `src/views/Inbox/README.md`.
- CONFIG (integrations → agents-engine, OPTIONAL — nothing blocked): `src/i18n/he.ts` now carries READY-TO-ADOPT keys for your suggestion strings (`sla.evidence.lastContact`, `pitboss.title`, `pitboss.reason.*`, `pitboss.body.*`, `pitboss.action.*`, plus `bench.*` for the Wave-3B Bench Sourcer). Values are byte-identical to what sla.ts/pitboss.ts emit today (parity-pinned in `src/i18n/he.test.ts`), so adoption is a mechanical `t(key, params)` swap with zero output change — your files, your call, integrations does not edit them. Morning-digest strings for kanban-ui live under `digest.*` (title = the contract's "מה מחכה לך הבוקר").

## Flagged for Eliran review
- **`api/data.ts` v2 proposal ready for lead line-by-line review:** `docs/diffs/api-data-v2.ts` + `docs/diffs/api-data-v2-RATIONALE.md` (platform-data, Wave 0 task 4). Not applied; live file untouched.

## Stop protocol (desktop-app loop discipline — .claude hooks do not fire here)
A turn may end ONLY with one of: (a) background agents running AND a fallback wakeup armed; (b) a `GATE-WAIT: G<n> — <what>` line in this file; (c) `MISSION: DONE` per rule 27. Anything else = re-enter THE LOOP (rule 12).

## GATE-WAIT (Eliran decisions — none block build work)
- **G3 — restore cloud sync:** production Upstash Redis is GONE (D-041) — sync silently broken today. Needs: provision new KV/Upstash (free tier, Vercel Marketplace) + env update + redeploy. Prepared one-click at G1 ceremony; URGENT relative to other gates because V2 sync is down NOW.
- **G1 ceremony (one package):** main fast-forward to wip-fingerprint-drive (prod-identical except one newer prompt — D-040), Vercel Git connect, vercel.json crons entry (GET /api/agents/cron), KV env fix, then v3-jump merge when DONE checklist holds.
- **Async seeding form** (replaces the meeting — D-042): shareable text for Revital, built into Wave-3 scope; her Export-everything JSON doubles as the merge-rehearsal source.
- Previews: LIVE via CLI (non-prod) — current: https://revital-ik7ivjtf7-elirank512-1022s-projects.vercel.app

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

## Wave 3 baseline (quality-gate) — FINAL

Captured 2026-08-01 on `v3-jump` (HEAD 6109572 = tag `v3-wave3`, + this dispatch's `e2e/seeding-wizard.e2e.ts` uncommitted — lead commits), local clone `~/dev/revital`, node v22.22.2, vitest 3.2.7, Playwright chromium.

- `npm run typecheck` — clean (exit 0).
- `npm run test:unit` — green: **67 files, 852/852**, ~10.8s.
- `npm run test:e2e` — **15 tests across 10 specs: 14 passed + 1 documented fixme** (~6.7s). Delta this dispatch = `e2e/seeding-wizard.e2e.ts` (3 tests; deterministic under `--repeat-each=3`, 9/9). The fixme is the pre-existing 390px page-chrome scroll (legacy V2 header), unchanged — see Rule-27 audit U1.
- `./scripts/gate/check-no-send-paths.sh` — exit 0 on current `src/`.
- `./scripts/gate/tick-check.sh` — NOT runnable locally, by design: it validates a DEPLOYED `/api/agents/tick` and needs `TICK_URL` + that deployment's `CRON_SECRET`; vite serves no `api/*`, the CLI preview sits behind Vercel Authentication (D-043), and production's KV is dead (D-041). The protocol is pinned by `scripts/gate/tick-check.test.ts` (4 tests, inside the 852). Deployed run lands at the sync-restore/G1 ceremony (Rule-27 audit U2).
- Harness note (D-055): Playwright's hit-target interceptor can swallow the FIRST click dispatched immediately after a pointer-drag (harness artifact, ~≤1.2s window; app verified healthy). e2e discipline going forward: never assert via a click issued immediately after `dragTo` — assert renders, or interact before the drag. Encoded in the seeding-wizard spec.

## Rule-27 audit (quality-gate, 2026-08-01)

Every clause of the mission DONE checklist (rule 27) against actual repo state. Evidence = file/test/tag. **34 MET / 5 UNMET** (+1 out-of-checklist hygiene gap). UNMET items carry a task line (what / owner / size).

| # | Item | Verdict | Evidence / task |
|---|---|---|---|
| ①.1 | 9 columns + Bench rail behind flag | MET | `components/pipeline/stages.ts` (9 canonical ids), `BenchRail.tsx`; e2e `board-drag-undo`, `bench-restore`, `legacy-flag-off` |
| ①.2 | Card: match score | MET | `DealCard.tsx` score-chip; board-seams suite |
| ①.3 | Card: fee×probability EV | MET | `ev-chip` via `evRangeForDeal` (midpoint pinned to `dealEV`); money-seams suite; e2e fee-capture |
| ①.4 | Card: aging rings | MET | `AgingRing.tsx`, `aging.ts` (amber≥5/red≥10), DealCard tests |
| ①.5 | Card: audit-attribution chips | MET | Card-back trail rows carry agent attribution (`CardBack.tsx` — suggestion lifecycle + audit `agent` field, D-044(6)); chips render sourceType:sourceId |
| ①.6 | Card: next-action owner | MET | `DealCard.tsx` "הבא: … (רויטל/סוכן)" from `deal.nextAction` (D-019) |
| ①.7 | Card: wa.me button, BiDi-safe | MET | `wa-link` inert `<a href>`; D-017 BiDi policy; `dir="auto"` pinned in board-seams; e2e draft-accept-wame (href asserted, never navigated) |
| ①.8 | Drag semantics + undo | MET | `dragEnd.ts` (Rejected non-droppable per D-024), `UndoToast`; e2e board-drag-undo incl. reload-survival |
| ①.9 | Reply-capture chips (השיב/אין מענה/נקבעה שיחה) | MET | `DealCard.tsx` + `CardBack.tsx` (grep-verified strings); store `setReplyState` |
| ①.10 | Auto-logged wa.me contacts | MET | `composeAndLog` + `pipelineContactLogger`; hash === `suggestionMessageHash` pinned end-to-end (board-seams) |
| ②.1 | Person entity with dedupe | MET | `findDuplicatePerson` (exact vs name_only, never auto-merge, D-014/D-020); store tests |
| ②.2 | Stage-skip events | MET | creation StageEvents with `skippedStages` (D-020); reporter + metrics consume them (tests) |
| ③.1 | Per-mandate view | MET | Money Board is per-mandate lanes (`lane-<jobId>`, fee button per lane) + per-mandate Client Reporter; no separate drill-down view — lanes are the per-mandate surface |
| ③.2 | Money Board view | MET | `MoneyBoard.tsx`; calibration-adversarial suite; e2e |
| ③.3 | Mobile-responsive Today view | MET | V3 surfaces fit 390px inside `<main>` (e2e-asserted) AND page chrome fixed (D-059): `Header.tsx` nav is an internal horizontal scroll strip at narrow widths (`overflow-x` on the `<nav>` only, hidden scrollbar, `shrink-0` logo/status/buttons; desktop where it fit before is byte-identical); `test.fixme` in `e2e/mobile-today.e2e.ts` flipped to a live `scrollWidth <= clientWidth` assertion at 390px on legacy dashboard + היום tab, regression-verified to bite (revert⇒fail, restore⇒pass); e2e 15/15, 0 fixme |
| ③.4 | Qualified-pipeline headline + calibration mode | MET | `MoneyHeader` qualified-ev / calibration-hint; D-028+D-046 gate (seeded AND fee AND stage); e2e both directions |
| ③.5 | Priors-as-ranges, blend only n≥10 | MET | `effectiveProbabilityRange` (D-028); PriorsEditor; money tests |
| ④.1 | Minimal suggestions queue (Wave 1) | MET | `SuggestionsQueue` badge panel (kept alongside inbox, D-044(2)) |
| ④.2 | Full Approvals Inbox: batch, edit-rate, digest | MET | `ApprovalsInbox.tsx` (batch ops, edit-rate from `suggestionEditRate`, digest "מה מחכה לך הבוקר"); e2e approvals-batch |
| ⑤.1 | All 5 agents per plan §3 Act/Propose | MET | screener / sla / pitboss / benchSourcer (`src/agents/`) + client_reporter (`src/reporting/`); D-022/D-031/D-038/D-030 |
| ⑤.2 | Single-writer verified | MET | hostile-payload bridge test (agent write CANNOT reach card state), frozen-object board-seams tests, byte-identical rail in server→client loop test |
| ⑤.3 | Tick chunked + CRON_SECRET + preview guard | MET | `api/agents/tick.ts` (auth-before-preview, budget chunking, D-031); `api/agents/cron.ts` GET wrapper parity-tested (D-038(7)) — vercel.json crons entry deliberately G1 |
| ⑤.4 | Tick validated by direct HTTP (deployed) | **UNMET** (blocked) | `tick-check.sh` + 4 self-tests ready; never run against a live deployment (preview behind Vercel Auth D-043, prod KV dead D-041). TASK: at the sync-restore/G1 ceremony run `TICK_URL=<deployment> CRON_SECRET=<env> ./scripts/gate/tick-check.sh`. Owner: lead. Size S |
| ⑤.5 | Spend caps on all 3 external APIs | MET | `api/_lib/spend.ts` claude/enrich/gemini (200/40/40 defaults, D-008); bench transport shares the claude budget (D-038(6)); regression tests |
| ⑤.6 | Zero send paths (grep + G4 tested) | MET | gate exit 0 + 11 gate self-tests + e2e context-level block-all with outreach-shaped-attempt teardown FAIL |
| ⑥.1 | Fee ledger | MET | importer `fee_ledger` append-only, deterministic ids (D-029); `supabase/schema.sql` triggers; client current-state fees slice audited |
| ⑥.2 | Guarantee timers | MET | Closed 2026-08-01 (agents-engine, D-057): `src/agents/guarantee.ts` guarantee-window pass FIRES two milestones per placement — ENDING ≤7d ("תקופת אחריות מסתיימת בעוד X ימים", 'flag') + ENDED ("העמלה מובטחת" → invoice step, 'next_action') — as pit_boss Suggestions citing the fee record + placement date (Placed StageEvent → Paid-skip event → stageEnteredAt fallback), zero ₪; pure core + client on-load sweep (`runGuaranteeSweepOnLoad`, real `revital_v3_fees`) + tick fold-in (fires server-side from synced `Deal.fee` terms pre-G3); 19-test suite + 2 tick tests, deterministic episode ids, dismissals final. Suggestions render in the existing inbox/queue surfaces; the optional card/money CHIP remains kanban-ui polish, not a firing gap |
| ⑥.3 | Invoice reminders | MET | Closed 2026-08-01 (agents-engine, D-058): `src/agents/invoices.ts` invoice-reminder pass over MandateFee + deals — 'none'/'due' past guarantee ⇒ "להוציא חשבונית", 'sent' stale (past `invoiceDueAt` immediately, else >14d from the record) ⇒ "תזכורת תשלום", 'paid' never; fee completeness gates (feeAmount as GATE, never rendered — zero ₪), cross-pass guarantee_pending dedupe, per-mandate episodes; pure core + `runInvoiceSweepOnLoad` + tick fold-in (inbox rendering already existed); 16-test suite; 889/889 total |
| ⑥.4 | Cash forecast | MET | invoice-dated "צפוי החודש" (deliberately honest scope — no probability-timed fiction, D-032); money-seams tests |
| ⑥.5 | Client Reporter: Hebrew RTL evidence-cited | MET | `buildMandateReport` typed claim-lines, evidence == claim×refs proven globally (D-030); reporter-store-evidence suite |
| ⑥.6 | Boolean-string generator | MET | `booleanStrings` he/en + X-Ray + broad recall (D-030); tests |
| ⑦.1 | Backfill rehearsed on copied data | **UNMET** (blocked) | Dry-run+apply fully tested on synthetic data; rehearsal on HER real copied data impossible until the D-053 backup file exists (prod KV dead — localStorage is the only copy). Harness ready (`scripts/data/rehearse-restore.ts`, D-054 validated on planted defects). TASK: when the backup lands, run rehearse-restore + `backfillDryRun` over it, record counts here. Owner: lead (+Eliran's backup click). Size S |
| ⑦.2 | Importer dry-run passing | MET | `agentStoreImporter` dry-run-first + mock-enforced append-only (D-029); tests |
| ⑦.3 | Export-everything works | MET | `exportAll` + BoardTools download; e2e deletion-cascade proves the export gate end-to-end |
| ⑦.4 | Deletion cascade + retention setting | MET | `deletePersonCascade` all reference vectors incl. evidence (D-037); retention UTC purge; triple-gated UI; e2e |
| ⑦.5 | Legacy flows byte-identical flag-off | MET | flag-regression suite (key-namespace snapshot-diff, zero fetch); e2e legacy-flag-off |
| ⑧.1 | Baseline + leading-indicator instrumentation live | MET | `deriveBaseline` card in wizard (D-047/D-050), `computeLeadingIndicators`, `editedBeforeAccept` stamped on ALL accept paths (D-036/D-044) |
| ⑧.2 | Full e2e green | MET | 15 passed, 0 fixme (③.3 closed by D-059; failures 0); suite deterministic, G4 fixture on every test |
| ⑧.3 | RUNBOOK complete (env, deploy, restore) | MET | §1–§8 incl. env table, git-archive deploys, restore-from-backup, retention ops, G-gate map (D-049) |
| ⑧.4 | DECISIONS/BOARD-STATUS current | MET | D-001..D-056 appended; this section |
| ⑧.5 | v3-jump pushed with preview URL | MET | origin/v3-jump @6109572 (= local HEAD; this dispatch's e2e file awaits lead commit); preview URL in GATE-WAIT section |
| ⑧.6 | G1/G2/G3 unexecuted, packaged one-click | MET | G1 ceremony package (GATE-WAIT), sync-restore ceremony D-053/D-054 prepared (backup tool delivered; awaiting Eliran's backup file — a gate by design, not a build gap) |
| — | (out of checklist) repo-wide lint | **UNMET** (hygiene) | `npm run lint` is broken: eslint was never installed (no `eslint` in node_modules/.bin nor devDependencies) — pre-existing, predates V3. TASK: lead CONFIG — install eslint + config or remove the script; package.json is not quality-gate's file. Size S |

**Summary at capture (2026-08-01, quality-gate): 34 MET / 5 UNMET (U1 mobile chrome S · U2 deployed tick-check S/blocked · U3 guarantee timers M · U4 invoice reminders S · U5 real-data rehearsal S/blocked) + 1 hygiene (lint, S).**
**Post-audit closures (same day): U1 closed by kanban-ui (③.3, D-059) · U3/U4 closed by agents-engine (⑥.2/⑥.3, D-057/D-058) ⇒ current standing 37 MET / 2 UNMET + 1 hygiene.** The remaining U2 and U5 are externally blocked on the D-053 ceremony (Eliran's backup + KV restore) and fold into it; lint remains a lead CONFIG (package.json). Post-closure baseline: typecheck clean, unit 889/889 (69 files), e2e 15/15 (0 fixme), send-path gate exit 0.
