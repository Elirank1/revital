# Pipeline view — wiring contract (Wave 0)

Owner: **kanban-ui**. This file states what the **lead** wires; kanban-ui never edits
`src/App.tsx`, `src/store/appStore.ts`, or `src/types/**`.

## What the lead applies

1. **View key** — add `'pipeline'` to `AppView` in `src/types/index.ts`:
   `export type AppView = 'dashboard' | ... | 'settings' | 'pipeline';`
2. **Render branch** — in `src/App.tsx`:
   ```tsx
   import PipelineView from './views/Pipeline';
   // in the currentView switch/branches:
   {currentView === 'pipeline' && <PipelineView />}
   ```
3. **Header nav item** — a "Pipeline / לוח" nav entry that calls `setView('pipeline')`,
   rendered **only when the flag is on**:
   ```tsx
   import { isV3Enabled } from './components/pipeline/flags';
   {isV3Enabled() && <button onClick={() => setView('pipeline')}>…</button>}
   ```

## Guarantees kanban-ui provides

- Flag off (default): `<PipelineView />` renders `null` — safe to mount unconditionally;
  with the nav item also flag-gated, flag-off behavior is byte-identical to V2.
- Flag helper: `isV3Enabled()` / `setV3Flag(on)` from `src/components/pipeline/flags.ts`
  (`localStorage['revital_v3_flag'] === 'on'`, default OFF). Platform-data's store may
  supersede this helper later; the lead owns that swap.
- No store, type, or API dependencies in Wave 0 — the view is self-contained.

## Toggling for manual testing

In the browser console: `localStorage.setItem('revital_v3_flag', 'on')` then reload
(scaffold reads the flag at render; no live re-render on flag change in Wave 0).
