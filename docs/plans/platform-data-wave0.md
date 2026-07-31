# platform-data — Wave 0 Schema Plan

**Author:** platform-data · **Date:** 2026-07-31 · **Status:** submitted for lead sign-off
**Contract:** `docs/REVITAL-V3-PRODUCT-PLAN.md` §2, §3, §5. Charter: `docs/charters/platform-data.md`.

---

## 1. Entities

All v3 records extend a common `Versioned` envelope:

```ts
interface Versioned {
  id: string;          // client-generated UUID
  v: number;           // SERVER-assigned version counter (0 = never synced)
  updatedAt: string;   // ISO — informational only, NEVER used for conflict resolution
  deleted?: true;      // tombstone marker — records are never physically removed by merge
  deletedAt?: string;
}
```

### Person
One human. Can appear on N deals across mandates. Contact history, reply state,
and Bench reuse attach here; fee math attaches to Deals (plan §2).

Fields: `name`, `normalizedName` (derived, see dedupe §6), `phone?`, `email?`,
`linkedinUrl?`, `analysisIds[]` (links into legacy `analyses` — read-only reference,
never mutates legacy data), `contactEvents[]` (`{kind: contacted|replied|no_reply|meeting_set, ts, messageHash?}`),
`bench?: {reason, since}`, `notes?`.

### Deal (the Kanban card)
`candidateId × roleId` pair: `personId`, `jobId` (legacy `JobDescription.id`),
`jobTitle` (denormalized for display), `stage: DealStage`, `stageEnteredAt`,
`fee?: FeeTerms`, `probabilityOverride?`, `nextAction?: {label, owner: 'revital'|'agent'}`,
`rejection?: {reason, ts}` (required when stage = Rejected), `analysisId?`.

### DealStage
Nine pipeline stages + two rails:
`Sourced → Screened → Outreach → InConversation → Submitted → ClientInterview → Offer → Placed → Paid`,
plus `Bench` (side rail, reusable capital) and `Rejected` (requires reason; person files to Bench).

### StageEvent
Append-only move record: `dealId`, `from: DealStage | null` (null = card creation),
`to: DealStage`, `ts`, `actor: 'human' | 'agent' | 'system'`,
`skippedStages: DealStage[]` (non-empty ⇒ this is a skip-event; conversion stats
exclude skipped intervals — plan §2), `reason?` (mandatory when `to = Rejected`).

### Suggestion
The only thing agents ever produce (plan §3 single-writer):
`agent: AgentName`, `kind` (draft_message | new_card | flag | report | next_action | rematch),
`dealId?`, `personId?`, `title`, `body`, `evidence[]` (each claim cites a source record),
`status: pending | accepted | dismissed`, `resolvedAt?`. Acceptance mutates state
**only through the normal client path** and writes an AuditEvent.

### AgentRun
`agent`, `trigger` (cron | app_open | manual | event), `startedAt`, `finishedAt?`,
`itemsProcessed`, `suggestionsCreated`, `tokensUsed?`, `outcome: ok | error | capped`, `error?`.

### AuditEvent
Plan §7 shape, verbatim: `{actor: 'human' | 'ai', action, before, after, ts}` plus
`id` and optional `entityType/entityId` for filtering. Append-only; client keeps
last N≈500 (rotation §7 below). Undo is implemented by writing a compensating
event + reverting via the normal client path — the log itself is never rewritten.

### schemaVersion
`PIPELINE_SCHEMA_VERSION = 1` exported from `src/types/pipeline.ts`; persisted in
the v3 meta record locally and inside the `v3` blob section server-side.

---

## 2. Storage keys

**localStorage (client), all new — zero collision with legacy `revital_*` keys:**

| Key | Content |
|---|---|
| `revital_v3_flag` | `'on'` / absent. Feature flag, **default off**. |
| `revital_v3_persons` | `Person[]` |
| `revital_v3_deals` | `Deal[]` |
| `revital_v3_events` | `StageEvent[]` (last ≈500) |
| `revital_v3_suggestions` | `Suggestion[]` |
| `revital_v3_audit` | `AuditEvent[]` (last ≈500, client rotation) |
| `revital_v3_meta` | `{schemaVersion, lastSyncAt}` |

Legacy keys (`revital_settings`, `revital_analyses`, `revital_savedJobs`,
`revital_log`, `revital_outreach`, `revital_interviews`, `revital_profileIntel`)
are **not read or written by any v3 code path**.

**Redis blob (server):** same key `revital:data:${code}`. v3 data lives under a
single additive top-level field `v3`:

```
{ analyses, savedJobs, log, updatedAt,          // legacy — untouched shapes
  v3?: { schemaVersion, vCounter, persons, deals, events, suggestions, agentRuns } }
```

---

## 3. Merge semantics

**Server-assigned version counters, LWW per record.** The blob carries one
monotonic `vCounter`. Every accepted write stamps the record `v = ++vCounter`.
Client wall-clocks are never consulted.

**Server merge (POST, per record):**
1. Incoming id not in blob → insert, stamp new `v`.
2. Incoming id exists and `incoming.v >= existing.v` → the client has seen the
   latest server state; apply, stamp new `v`.
3. `incoming.v < existing.v` → client is stale; **server copy wins**, incoming
   dropped. Client converges on next GET.

**Tombstones ride the same rules.** Delete = update with `deleted: true`, stamped
with a new `v`. A stale client re-POSTing the live record carries a lower `v` and
loses ⇒ **deletes cannot resurrect**. A client that has *seen* the tombstone and
POSTs an undeleted copy at tombstone-`v` intentionally undeletes — that is the
one-click-undo path, and it is auditable.

**Client merge (GET):** per record, `remote.v > local.v` → take remote;
`remote.v === local.v` and local is dirty (unsynced edit) → keep local (it will
win the next POST); otherwise keep local. Dirty tracking is a client-only flag,
never serialized to the server.

---

## 4. `/api/data` v2 — strictly additive

Delivered as a **proposed replacement** at `docs/diffs/api-data-v2.ts` (lead
applies after line-by-line review — I never touch `api/data.ts`).

- Legacy POST body (`analyses`/`savedJobs`/`log`) handled by the byte-identical
  existing code path, same `mergeById`, same caps (100/50/200), same response shape.
- v3 payload is read from an additive `v3` field on the same POST; absent ⇒ the
  handler behaves exactly as today.
- GET returns the legacy blob fields exactly as today; the `v3` section is
  included **only** when the client sends `X-Revital-V3: 1` — a legacy client's
  GET response is byte-identical to current production.
- Blob-size guard: serialized blob > **800 KB** ⇒ response gains `sizeWarning`;
  > **1.5 MB** ⇒ v3 write rejected `413` with `alert` field (legacy write path
  is never blocked — guard applies to the new paths only, so V2 sync cannot break).
- Preview guard: `VERCEL_ENV === 'preview'` && `!PREVIEW_DATA_OK` ⇒ v3 write
  paths return 503 read-only (plan §5).

---

## 5. Importer / backfill (Wave 1 code, contract fixed now)

`src/lib/backfill.ts` (Wave 1) maps legacy `analyses` → Persons + Deals in
**Screened only** (plan §2 seeding note). Contract: (1) runs only behind
`revital_v3_flag`; (2) **dry-run first** — returns a preview diff, writes nothing
until explicitly confirmed; (3) automatic backup precedes any write: snapshot via
`scripts/data/snapshot.ts` + localStorage export; (4) never mutates legacy keys;
(5) any run against the live blob is **G2 — stops for Eliran**, rehearsed on a
copy first.

---

## 6. Person dedupe (cross-mandate)

`normalizedName` = NFKC → lowercase → strip niqqud/punctuation → collapse
whitespace. Phones normalize to digits with `+972`/leading-0 unified. Emails
lowercase-trimmed. A candidate matches an existing Person iff
`normalizedName` matches **and** (normalized phone or email matches), or
phone/email alone matches exactly (contact identifiers are globally unique).
Name-only collisions are **flagged as a merge Suggestion**, never auto-merged.

---

## 7. Rotation, migration, rollback

- **Audit/events rotation:** client persists last ≈500 AuditEvents and ≈500
  StageEvents (blob-growth guard, plan §5); full history moves to Supabase
  `events` in Wave 2.
- **Migration note (schemaVersion):** every persisted v3 payload carries
  `schemaVersion`. On load, `schemaVersion < current` ⇒ run pure migration
  steps (`migrations[n] : payload(n) → payload(n+1)`) before hydration;
  `schemaVersion > current` (older client, newer data) ⇒ client goes read-only
  for v3 and prompts refresh — never writes a downgraded shape. v1 has no
  predecessor; the migration table starts empty but the seam ships now.
- **Rollback = flag off, nothing else.** With `revital_v3_flag` absent, no v3
  code path reads/writes storage or network; legacy behavior byte-identical.
  v3 keys may linger in localStorage/blob — inert and additive by design.

---

## 8. Self-verification against charter criteria

- **(a) Strictly additive `/api/data`** — legacy fields handled by unchanged code;
  v3 under a new `v3` field; GET without opt-in header returns the current
  production shape byte-identical. ✅ (§2, §4; asserted by unit tests on the
  extracted merge module.)
- **(b) Every delete is a tombstone** — no code path physically removes a v3
  record; `deleted: true` + `deletedAt` + new `v`. ✅ (§3; tested.)
- **(c) LWW per-record on server-assigned versions** — single blob `vCounter`,
  compare-and-stamp rules in §3; client clocks never consulted (`updatedAt` is
  display-only). ✅ (tested: stale-write loses, delete cannot resurrect.)
- **(d) schemaVersion + migration note** — const in types, persisted both sides,
  forward/backward behavior defined in §7. ✅
- **(e) Importer flag-gated, dry-run-first, automatic backup** — contract in §5;
  backfill lands Wave 1 under it. ✅
- **(f) Rollback = flag off, nothing else** — §7; flag-off leaves zero active v3
  code paths. ✅
- **(g) Person separate from deal-cards + cross-mandate dedupe** — distinct
  entity (§1) referenced by `Deal.personId`; dedupe on normalized name +
  phone/email (§6), ambiguous matches become Suggestions. ✅
