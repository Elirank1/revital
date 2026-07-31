# Inbox view — wiring contract (Wave 1)

Owner: **kanban-ui**. `SuggestionsQueue` (default export of `src/views/Inbox`) is the
approvals inbox: pending suggestions with accept/dismiss (store single-writer path),
plus recently accepted drafts rendered as wa.me `<a href>` links (G4: no window.open).

**No wiring required today** — the Pipeline board embeds it behind the "הצעות" badge.

**Optional (lead):** expose standalone as `'inbox'` in `AppView` + a flag-gated nav
item, rendering `<SuggestionsQueue />`. It renders fine flag-off (empty store ⇒ empty
state) but should stay unreachable while the flag is off, same as the board.
