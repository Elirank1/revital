# Pipeline view — wiring contract (Wave 1 + 2)

Owner: **kanban-ui**. This file states what the **lead** wires; kanban-ui never edits
`src/App.tsx`, `src/store/*`, or `src/types/**`.

## What changed in Wave 2 (informational — ZERO new wiring needed)

- **Money surfaces live inside the board**: money header (qualified ₪ / expected-this-month /
  early range + priors popover), EV ranges on cards and column headers, the "כסף" MoneyBoard
  tab, FeeCapture on drag→Placed, and a "כלים" menu (export-everything + backfill dry-run).
  All calibration-gated — an uncalibrated mandate renders no ₪ anywhere
  (swept by `calibration-sweep.test.tsx`).
- **Today ranks by the LIVE Pit Boss** through `pitbossBridge.ts` — the bridge was flipped
  to `src/agents/pitboss.ts` in-batch when agents-engine landed it. If the ranker's
  signature ever changes, TS flags it at that single seam.
- **Accepts stamp `editedBeforeAccept`** via `src/views/Inbox/acceptDraft.ts`
  (D-029 handoff, D-033) — see the FIX(platform-data) note in BOARD-STATUS for the
  planned absorption into `acceptSuggestion`.
- New money-store dependency: `useMoneyStore` from `src/lib/money` (platform-data, Wave 2A).

## Already wired (Wave 0 — no action needed)

- `'pipeline'` in `AppView`, render branch in `App.tsx`, flag-gated "לוח" nav item.
  `<PipelineView />` stays safe to mount unconditionally: flag off ⇒ renders `null`.

## What changed in Wave 1 (informational)

- **Flag is now reactive**: `PipelineView` reads `v3Enabled` from `usePipelineStore`,
  so `usePipelineStore.getState().setV3Flag(true)` re-renders live (no reload).
  The dependency-free `src/components/pipeline/flags.ts` helper still exists and reads
  the same `revital_v3_flag` key — the App nav can keep using either.
- **Read-only legacy dependency**: the board subscribes to `useAppStore((s) => s.analyses)`
  to render match-score/verdict chips (`Deal.analysisId` → `CandidateAnalysis`).
  kanban-ui reads the legacy store; it never writes it.
- **Board contains** the Today tab ("היום") and an inbox panel (embedded
  `SuggestionsQueue`) — both work with zero additional wiring.

## Optional wiring (lead's call, not required)

1. **Inbox as a standalone view** — `src/views/Inbox` default-exports `SuggestionsQueue`:
   add `'inbox'` to `AppView`, render `{currentView === 'inbox' && <SuggestionsQueue />}`,
   nav item flag-gated like the board's. Until then the board's "הצעות" badge panel
   covers the flow.
2. **Today as a standalone view** — `TodayView` is exported from `src/views/Pipeline`
   (mobile-first at 390px); same pattern with a `'today'` key. Until then it is the
   board's "היום" tab.

## Store surface consumed (wave1-store-contract.md, binding)

`moveDeal` (drag), `undoLast` (toast ביטול), `setReplyState` (three chips),
`acceptSuggestion`/`dismissSuggestion` (queue), `logContact` via
`pipelineContactLogger` + `composeAndLog` (wa.me click auto-log), plus
`deals`/`persons`/`suggestions` subscriptions. Rejection is NOT draggable —
`'Rejected'` requires a reason, so it is excluded from droppable targets
(`src/components/pipeline/dragEnd.ts`); the reject-with-reason UI is a later wave.

## Toggling for manual testing

Console: `localStorage.setItem('revital_v3_flag', 'on')` then reload (or call the
store's `setV3Flag(true)` for a live flip).
