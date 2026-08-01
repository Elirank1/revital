# Inbox view — wiring contract (Wave 1 → Wave 3)

Owner: **kanban-ui**.

**Wave 3:** `ApprovalsInbox` (now the default export of `src/views/Inbox`) is the
full approvals surface: pending suggestions grouped by agent, multi-select batch
approve/dismiss, inline draft edit routed through `acceptSuggestion(id, { editedBody })`,
accept-rate + edit-rate display, and the morning digest mode ("מה מחכה לך הבוקר":
pending by agent + top-3 Pit Boss + overdue client feedback, one tap back into the
inbox). `SuggestionsQueue` remains the compact embedded panel behind the board's
"הצעות" badge (unchanged surface, Wave-1/2 tests keep passing).

**No wiring required today** — the Pipeline board hosts both:
the "הצעות" badge opens the embedded `SuggestionsQueue` panel, and the
"אישורים" tab renders the full `ApprovalsInbox` (digest reachable via its
"תקציר בוקר" toggle). Everything stays behind the v3 flag through the board.

**Optional (lead):**
- expose standalone as `'inbox'` in `AppView` + a flag-gated nav item, rendering
  `<ApprovalsInbox />`;
- a morning entry point can render `<ApprovalsInbox initialMode="digest" />` —
  same component, digest-first.
Both render fine flag-off (empty store ⇒ empty state) but should stay
unreachable while the flag is off, same as the board.
