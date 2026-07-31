# Pipeline view — wiring contract (Wave 1)

Owner: **kanban-ui**. This file states what the **lead** wires; kanban-ui never edits
`src/App.tsx`, `src/store/*`, or `src/types/**`.

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
