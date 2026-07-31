# Charter: kanban-ui

## Mission context
Revital AI (React18+TS+Vite+Zustand+Tailwind, view switching via `currentView` in `src/store/appStore.ts` + `src/App.tsx`, no router lib) is evolving into the V3 Placement OS: a 9-column deal Kanban + Bench rail, worked by propose-only agents. You are the **kanban-ui** teammate. Repo: `/Users/mymacbook/dev/revital`, branch `v3-jump`. Read `docs/REVITAL-V3-PRODUCT-PLAN.md` and `CLAUDE.md` before your first task — the plan is the contract.

## Safety rails (verbatim, non-negotiable)
No outbound send path — only human-clicked `wa.me`/`mailto` links; every agent output is a Suggestion until accepted; card state has exactly one writer (client path); append-only audit log; one-click undo; feature flag default-off; BiDi-safe UI (`dir="auto"` on all user content, logical CSS properties — Hebrew names + English titles + ₪ on one line is the worst case).

## Cut list (verbatim)
No realtime presence theater (agent-attribution chips from the audit log only), no full UI i18n in this wave, no vector DB, no auto-send, no WhatsApp API.

## Hard gates
G1 ship · G2 live data · G3 money/services · G4 real outreach. Everything else: decide autonomously and log one paragraph in `docs/DECISIONS.md` (append-only).

## Your exclusive file set
`src/views/Pipeline/**`, `src/views/Inbox/**`, `src/components/pipeline/**`. **Never edit any other path** — NOT `src/App.tsx`, NOT `appStore.ts`, NOT `types/`. The lead wires your view into App.tsx; platform-data owns the store. If you need a dependency (dnd-kit comes in Wave 1, not now) or wiring, add a `CONFIG:` line under Blockers in `docs/BOARD-STATUS.md`. Do not run `git commit`/`push` — the lead commits.

## Wave 0 tasks (in order)
1. `src/components/pipeline/flags.ts` — feature-flag helper: `isV3Enabled()` reading `localStorage['revital_v3_flag'] === 'on'` (default OFF), plus `setV3Flag`. Tiny, dependency-free; platform-data's store may supersede it later.
2. `src/views/Pipeline/PipelineView.tsx` — scaffold only: renders nothing (null) when flag is off; when on, shows a BiDi-safe placeholder board frame: header with the 9 stage columns' names in Hebrew+English (מקורות Sourced · סוננו Screened · פנייה Outreach · בשיחה In Conversation · הוגשו Submitted · ראיון לקוח Client Interview · הצעה Offer · הושמו Placed · שולם Paid) + Bench rail placeholder, `dir="auto"` on content nodes, logical CSS (`ps-`/`pe-`/`ms-`/`me-` Tailwind utilities, no `pl-`/`pr-` on content), desktop-first. No dnd yet — Wave 1.
3. `src/views/Pipeline/index.ts` barrel exporting `PipelineView`.
4. A short `src/views/Pipeline/README.md` stating the wiring contract you expect from the lead (view key `'pipeline'` added to `AppView`, header nav item behind the flag) — the lead applies it.
5. Component test (`src/views/Pipeline/PipelineView.test.tsx`) — flag off ⇒ renders nothing; flag on ⇒ column headers present. If a DOM test lib is missing, test the pure logic (flags helper + column model) instead and note the CONFIG need.

## Definition of done
`npm run typecheck` clean; `npm run test:unit` green; zero console errors; flag-off behavior byte-identical (view renders null and is not reachable); BiDi-safe per above. Log autonomous calls in `docs/DECISIONS.md` (append `## D-xxx (kanban-ui)`).

## Final report
Return: files built, wiring contract for the lead, test results, decisions logged, blockers.
