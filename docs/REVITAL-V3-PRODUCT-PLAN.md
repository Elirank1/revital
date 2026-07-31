# Revital AI V3 — The Placement Operating System

**Status:** Approved plan for the agent-team build · **Date:** 2026-07-31
**Produced by:** 3-angle strategy panel (revenue-operator / AI-native architect / pragmatist devil's advocate) → synthesis → 2 adversarial audits. All audit must-fix items are incorporated below.
**This file is the contract.** The Claude Code agent team reads it before any work. Where this plan and the codebase conflict, this plan wins; deviations are logged in `docs/DECISIONS.md`.

---

## 1. Vision

Revital AI jumps from a CV-analyzer she operates to an AI-native Recruiting OS she manages: a live Kanban of candidate×role **deals**, worked continuously by a small roster of named agents that screen, re-match, draft, and report — while every outbound word stays behind her thumb. The screen always answers one question: **what moves the most money today?**

**Money equation optimized:** `Income = parallel mandates × fill rate × fee ÷ time-to-fill`, compounded by candidate reuse (Bench) and client repeat rate — all bounded by her hours. V3 attacks every term: the board raises fill rate (nothing stalls silently), agents raise parallel capacity, Bench mining cuts sourcing cost to zero, and client reports win the next mandate.

**The honest 30-day claim:** protect in-flight revenue (no deal dies of silence) and return ≥5 hours/week to calls. Placements 1→2+/month and mandates 4→8 are **90-day** metrics — placement cycles are multi-week; anything placed in the first 30 days was already in flight.

---

## 2. The Kanban (heart of V3)

**Card = deal (candidate×role), not a task.** A separate **Person** entity underlies cards: one human can appear on N deals across mandates; contact history, reply state, and Bench reuse attach to the Person, deals attach fee math. Dedupe by normalized name + phone/email. (Without this, Bench double-counts and outreach state fragments per card.)

**Columns:** Sourced → Screened → Outreach → In Conversation → Submitted → Client Interview → Offer → Placed → Paid. Guarantee timer lives on Placed/Paid cards. Side rail: **Bench** — every rejected/silver-medalist Person archives there as reusable capital, with reason. Stage-skips are legal (inbound candidate can enter at In Conversation) and are logged as skip-events so conversion stats don't corrupt.

**Views:**
- **Per-mandate board** (default, desktop-first).
- **Money Board** — unified view, swimlanes per mandate.
- **Today** — cross-role: approvals queue + at-risk deals, ranked by EV-at-risk. **Mobile-responsive from Wave 1** (390px): her comms arena is WhatsApp on a phone; Today, card quick-actions, and approvals must work there or she abandons in week 1. The full 9-column board stays desktop.

**Card anatomy:** name + role · match score/verdict (links to existing Results) · **fee ₪ × stage probability = EV ₪** · days-in-stage with amber/red decay ring · agent-attribution chips rendered from the audit log ("Screener 07:14 — scored 82"; no realtime presence/pulsing — that's theater and there's no realtime transport) · next action + owner (Revital / agent) · pending-suggestion badge · one-tap WhatsApp (`wa.me`) button. Card back: full activity trail, every claim linked to evidence.

**Reply-state capture — zero added keystrokes (audit must-fix; the whole agent loop depends on this):**
- Clicking any `wa.me`/`mailto` action auto-logs `contacted @ts` + message hash on the Person.
- Card front carries three one-tap chips: **השיב/ה · אין מענה · נקבעה שיחה** (replied / no reply / meeting set).
- Today-view items resolve with one tap.
- Wave 3: optional paste-a-WhatsApp-thread box → parsed into events.
If she has to do CRM homework, she abandons; agents must never nag about things that already happened.

**BiDi correctness is a Wave-1 acceptance criterion, not deferred i18n:** Hebrew names + English titles + ₪ amounts on one card line is the worst-case BiDi string. Every user-content field renders with `dir="auto"`; layout uses logical CSS properties; dnd-kit drag behavior sanity-checked under RTL content. Garbled candidate names = instant abandonment. (Full UI-chrome i18n stays Wave 3.)

**WIP signals:** per-column count + ΣEV in headers; staleness flags past stage-median age; per-mandate "days since client feedback" counter.

**Pipeline-value header:** the headline number is **qualified pipeline ₪ (Submitted and later)**; early stages show as a range footnote so 50 Sourced cards × 5% × fee can't fabricate a big fake number. Also: expected ₪ this month, placements YTD. **Calibration mode:** EV/₪ headers stay hidden for a mandate until it has a fee and ≥1 deal past Screened — day one must never show fiction.

**Drag semantics:** drag = stage event → EV recalc + conversion log + agent hook. →Submitted drafts the submission note; →Offer arms the decay clock; →Placed opens fee capture + guarantee timer + invoice reminder; drop to Rejected asks a reason and files the Person to Bench. Agent-triggered work always lands as suggestions, never as sends. Every move one-click undoable.

**Board seeding (Wave-1 human gate):** a facilitated 1–2h session with Revital — enter live mandates with fee terms, drag current deals to true stages, capture baseline metrics (candidates/day, follow-up latency, active mandates, in-flight deals). Backfill alone can only place cards in Screened; her real pipeline lives in her head/WhatsApp. No seeding → the Money header lies → trust never forms.

---

## 3. Product agent roster

All agent brains run through the existing `/api/analyze` proxy pattern (no new key surface), behind a per-access-code daily spend cap.

**Single-writer architecture (audit must-fix — resolves split-brain):** deal/card state has **exactly one writer**: the client path (Zustand → `/api/data`). Agents **never mutate card state**. Server-side agents write only to a `suggestions` / `agent_runs` store; the client pulls suggestions into the inbox/board; only Revital's acceptance mutates state, through the normal client path. Cron and browser can never fight over a card, deleted cards can't resurrect, her drags can't be lost.

| Agent | Autonomous (Act — internal, reversible) | Suggests (Propose — requires her tap) | Triggers |
|---|---|---|---|
| **Screener** | Scores new CVs, creates cards in Screened (client-side, event-driven) | Flag explanations | CV/LinkedIn added |
| **Bench Sourcer** | Incremental re-match of open roles vs pool (new/changed only); precision throttle: if accept-rate < ~1 in 5, volume auto-drops | Suggested cards with "why matched" evidence | Nightly tick + new JD |
| **Outreach Runner** | Tracks reply state from captured events; flags 3-day silence | Every Hebrew opener/follow-up — **Propose forever** | Card→Outreach; SLA sweep |
| **Client Reporter** | — | Weekly per-mandate Hebrew status report; every claim cited to card evidence | Friday tick + on-demand |
| **Pit Boss** | Computes "move the money" list — deterministic fee×aging, auditable, no LLM vibes | Suggested next actions per deal | Daily tick + app open |

**Suggestions need a home from the first wave an agent emits one (audit must-fix):** a minimal suggestions queue (list + accept/dismiss) ships in **Wave 1**; the full Approvals Inbox (batch approve/edit/reject, edit-rate tracking, morning digest) ships Wave 3. Nothing an agent produces is ever invisible.

**No send path exists, architecturally.** The app has no outbound-message capability — only human-clicked `wa.me`/`mailto` links. You cannot misfire what isn't built.

---

## 4. Revenue instrumentation

- **Fee ledger per mandate:** % or fixed ₪, guarantee period, invoice status, cash forecast by month/quarter.
- **Stage probabilities:** explicit, editable priors displayed as ranges; blended with actuals only after ≥10 observed transitions per stage. Don't promise learning she won't see — at 1–2 placements/month, Offer→Placed learning takes quarters; deterministic logic carries day one.
- **Forecast:** qualified pipeline ₪ + expected placements this month, always in the header (post-calibration).
- **"Today's Shekels":** Pit Boss ranks EV-at-risk — aging offers, overdue client feedback, follow-ups due, interviews to prep — each with a pre-drafted Hebrew message behind a `wa.me` link.
- **Client report generator:** funnel, submitted candidates with Manager-Version summaries, "feedback pending 6 days" nudges, market notes; branded Hebrew RTL PDF/link. This is the repeat-mandate machine.
- **Measurement (audit must-fix):** baseline captured at the seeding session; leading indicators instrumented from Wave 1 — time-to-first-touch, SLA hit rate, client-feedback latency, suggestion accept/edit-rate. 30-day vs 90-day framing per §1.

---

## 5. Architecture decision

**Evolve the existing repo. No rewrite, no new app.** Phased so Waves 0–1 add zero external services.

- **Waves 0–1 (client-first):** additive Zustand slices (`persons`, `deals`, `pipelineCards`, `suggestions`, `auditLog`, `schemaVersion`) + extend `/api/data` merge-by-id with tombstoned deletes and per-record `updatedAt` LWW using **server-assigned version counters** (client wall-clock LWW across devices loses edits/resurrects deletes). V3 board is scoped to **Revital's access code only** initially — colleagues stay on V2 views. Feature flag default-off; legacy views untouched; rollback = flag off.
- **Audit-log growth guard (audit must-fix):** the shared Redis blob must not grow unbounded (Upstash request-size + Vercel body limits would eventually break V2 sync too). Client keeps last-N events per entity (N≈500); `/api/data` gains a blob-size guard + alert threshold now; full history moves to Supabase `events` when it lands (Wave 2).
- **Wave 2 (server-side agents):** Supabase Postgres — `events` (append-only), `agent_runs`, `suggestions`, fee ledger — as the **agent-side** store alongside client state (single-writer rule per §3; Supabase is never the card-state writer). Flag-gated, dry-run-first importer with automatic pre-migration backup. Auth stays access-code (Supabase Auth deferred). Development against local Supabase (Docker) or mocked client until the **G3** signup gate.
- **Cron feasibility (audit must-fix — stated plainly):** Vercel Hobby ≈ 2 cron jobs, daily granularity, loose timing, short function timeouts. Therefore: **one** daily cron hits `/api/agents/tick`, which fans out **chunked, incremental** work (map-reduce over new/changed records only; a full-pool Claude-over-JSON pass fits neither one timeout nor one context window). SLA sweep folds into the daily tick **plus** a client-side sweep on app open, and a manual "run agents now" button — so autonomy works even on Hobby. If more crons / longer timeouts are needed → Vercel Pro (~$20/mo) is a **G3 decision for Eliran**, prepared but not executed. Explicit monthly token budget enforced by the existing spend cap. Vercel cron does not fire on preview deployments — tick is validated pre-G1 by direct HTTP invocation with `CRON_SECRET`.
- **Preview/prod data isolation (audit must-fix):** preview deployments share prod env vars by default → the new merge code could write to the LIVE blob from a preview with no gate. Guard in code: if `VERCEL_ENV === 'preview'` and `PREVIEW_DATA_OK` is unset, `/api/data` (new paths) and `/api/agents/*` respond read-only/503. `api/agents/tick` additionally requires a `CRON_SECRET` header.
- **Matching:** Claude-over-JSON on her pool (hundreds of records), incremental. pgvector is a one-day upgrade if the pool passes ~1k. No vector infra in V3.
- **Existing paid deps get caps in Wave 0**, same as Claude spend: Enrich Layer (LinkedIn fetch) and Gemini transcribe get per-day counters + graceful fallbacks.
- **Privacy (Israel, Amendment 13 — in force since Aug 2025):** a deliberately-hoarded candidate pool is plausibly a registrable recruitment database with security/retention duties. V3 ships: data minimization in prompts/logs (send only needed fields), a retention policy setting, and a per-Person deletion path that cascades (tombstones + Supabase + agent artifacts, no PII in build logs). **Eliran: verify registration obligations — this plan is not legal advice.**

---

## 6. Build waves (lead + 5 teammates)

Global gates every wave: merge cadence ≤ ~500 reviewed lines/evening for Eliran (waves are **scope-gated, not date-gated** — day counts below are estimates, not deadlines); a small deterministic smoke set (login, analyze, results, sync round-trip) gates every merge, full e2e runs nightly; feature branch + Vercel preview only — **no merge to main until G1**; `api/data.ts` + storage-key semantics require lead line-by-line review.

**File ownership is exclusive and disjoint** (final map — resolves audit overlaps):

| Owner | Exclusive paths |
|---|---|
| **kanban-ui** | `src/views/Pipeline/**` (all board UI incl. CardActions components), `src/views/Inbox/**`, `src/components/pipeline/**` |
| **platform-data** | `src/store/**`, `src/lib/persistence/**`, `src/lib/backfill.ts`, `supabase/**`, `api/import.ts`, `scripts/data/**`; authors `src/types/pipeline.ts` in Wave 0 then hands it to the lead |
| **agents-engine** | `src/agents/**` (screener, pitboss, sourcer), `api/agents/**`, `src/lib/audit.ts`; sole teammate allowed inside `api/analyze.ts` (spend guard) |
| **integrations** | `src/lib/outreach/**` (draft generation + `wa.me` composition; UI components import from here), `src/reporting/**` (Reporter brain + templates), `src/views/Reports/**`, `src/i18n/**` |
| **quality-gate** | `e2e/**`, `scripts/gate/**`, `docs/RUNBOOK.md`; may create new `*.test.ts` files anywhere but never edits source or another owner's existing tests |
| **lead only** | `src/types/**` (post-Wave-0), `api/data.ts`, router/app entry, `package.json` + lockfile, `vercel.json`, `tsconfig*`, `.claude/**`, `CLAUDE.md`, `docs/**` |

Dependency/config changes go through the lead via `CONFIG:` tasks (see mission prompt).

**Wave 0 — Foundations (~2 days).** Contracts + safety. Person/Deal/Event/Suggestion types with `schemaVersion`; Zustand slices; `/api/data` additive merge with tombstones + server-assigned versions + blob-size guard; Redis snapshot script; audit-log module; spend guards (Claude + Enrich Layer + Gemini); preview-env guard; route + flag scaffold; `wa.me` composer with auto-log-contact; legacy smoke suite. **Checkpoint:** schema sign-off (lead-approved plan), legacy suite green.

**Wave 1 — The Board (~3 days).** Revital drags real candidates Monday. dnd-kit board, columns, card front (BiDi-safe), aging rings, undo; reply-capture chips; minimal suggestions queue; backfill from existing analyses; stage-event logging; Screener auto-card hook (client-side); next-step drafts via existing Outreach Composer + copy/`wa.me`; Today view (mobile-responsive); CSV stage column; merge rehearsal on a **copy** of Revital's Redis blob; Export-everything button. **Checkpoint (human):** seeding session with Revital (fees + true stages + baseline); flag on for her code.

**Wave 2 — Money + Loop (~4 days).** Fee ledger + EV math + qualified-pipeline header + calibration mode; Money Board view; Supabase schema + suggestions/agent_runs + flag-gated importer (local/mocked until G3); `/api/agents/tick` + chunked fan-out + `CRON_SECRET`; Pit Boss + SLA sweep (tick + app-open); boolean-string generator (pulled forward from Wave 3 — it's her only NEW-candidate aid and it's cheap); Client Reporter + Hebrew RTL template; leading-indicator instrumentation; agent-run logging asserts; spend-cap tests; runbook page 1. **Checkpoint:** tick dry-run via direct HTTP on staging data; Revital pilots one real mandate (human).

**Wave 3 — Bench + Inbox (~4 days).** Bench Sourcer nightly incremental re-match + precision throttle; Bench rail + silver-medalist archive; full Approvals Inbox (batch, edit-rate, morning digest) + card-back trail; paste-a-thread parser; Hebrew polish on all agent output + i18n scaffold; per-Person deletion cascade + retention setting; full e2e; one-page runbook (env vars, deploy, restore-from-backup); dependency audit. **Checkpoint (human):** prod flip readiness review → G1/G2 packaged one-click for Eliran.

---

## 7. Cut list + safety rails

**Not in V3:** Buzz in-product · LinkedIn automation/scraping (her account is her livelihood) · paid sourcing APIs ($500–2,000/mo — permanently negative ROI at one user) · WhatsApp API sending, official or unofficial (her number is her business) · auto-send of anything · vector-DB infra · full UI i18n · multi-tenancy, billing, auth rewrite, client portal, mobile app, Chrome extension, voice · realtime presence / agent-identity theater beyond audit-log attribution chips.

**Rails:** no outbound send path exists architecturally; every agent output lands as a Suggestion until accepted; append-only audit log `{actor: human|ai, action, before, after, ts}` (rotated per §5) rendered in History; one-click undo on moves and acceptances; tombstoned deletes with server-assigned versions; automatic pre-migration backup + shadow run on copied data; per-code daily spend caps on all three external AI/data APIs; reports must cite card evidence; single-writer rule on card state; preview-env write guard; PII minimization + deletion cascade.

---

## 8. Buzz stance

The Kanban is owned core product — Revital's income will not be coupled to a platform that launched on 2026-07-21 with self-admittedly early git support, and Revital will never open a second surface. We steal Buzz's best patterns — named agents, per-card threads, activity trails — and implement them in our own board. Where Buzz is cheap and on-thesis: the **build swarm itself** may use a Buzz room as its coordination/status surface (posting wave summaries), strictly zero product hours, disposable if it breaks, and only if Eliran sets up the workspace (account signup = G3 territory). It honestly dogfoods the Deeplica thesis. Revisit as an optional chat surface onto our event store in 1–2 quarters.

---

## 9. Success metrics (Revital-facing)

**30 days (honest window):** admin/follow-up time → a 20-minute morning ritual; ≥5 hours/week returned to calls; zero follow-ups slipped past SLA; she checks the board Monday mornings unprompted; suggestion accept-rate ≥ 60% (edit-rate falling).
**90 days:** placements/month 1 → 2+ (≈₪400–500k/year swing at ₪30–60k/fee); parallel mandates 4 → 8 in the same hours; ≥1 placement from Bench reuse; ≥1 repeat mandate attributed to client reports.
**Baseline:** captured at the seeding session before flag-on; leading indicators (time-to-first-touch, SLA hit rate, feedback latency, accept/edit-rate) trend visibly in-product.

---

## 10. Top risks (from the adversarial audits)

1. **Trust collapse of the only user who matters** — one corrupted datum or one fake-precision number and the cockpit becomes an ignored todo list. → single-writer, calibration mode, priors-as-ranges, seeding session, undo everywhere.
2. **Reply-capture friction** — if logging replies feels like CRM homework, the loop starves. → zero-keystroke capture, one-tap chips, agents never nag about captured events.
3. **The swarm is the bus factor** — month-four codebase Eliran can't navigate, underpinning income Revital depends on. → diff budgets, boring dependencies, runbook, e2e, evening-readable merges.
4. **Split-brain data** — resolved by design (§3, §5); any deviation from single-writer is a `DECISIONS.md`-logged escalation.
5. **Quiet gate leaks** — preview writes to prod store, auto-promote on main, cron on previews. → env guards, no-main-until-G1, CRON_SECRET, G-gates packaged as explicit human clicks.
