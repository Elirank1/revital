# api/data.ts v2 — rationale for lead review

**From:** platform-data · **Wave 0 task 4** · Proposed file: `docs/diffs/api-data-v2.ts`
Schema contract: `docs/plans/platform-data-wave0.md` §3–§4. **Do not apply without line-by-line review.**

## What changed vs current `api/data.ts` (~92 lines → ~200)

1. **Legacy paths byte-identical.** `authenticate`, key derivation, OPTIONS, 401/400/405,
   legacy merge (`mergeById`, caps 100/50/200), and the legacy POST response shape
   (`{ok, counts}`) are copied verbatim. A legacy POST also carries the stored `v3`
   section forward untouched, so V2 sync can never wipe v3 data.
2. **GET stays byte-identical for legacy clients.** The `v3` blob field is *stripped*
   from GET responses unless the client opts in with `X-Revital-V3: 1` (or `?v3=1`).
   Round-trip of `analyses`/`savedJobs`/`log` is unchanged in both directions.
3. **Additive v3 POST section** (`body.v3`): collections `persons/deals/events/
   suggestions/agentRuns`. Merge is LWW on a single blob-level `vCounter` —
   **server-assigned**, monotonic; client clocks never consulted. Per record:
   unknown id → insert+stamp; `incoming.v >= stored.v` → apply+stamp;
   `incoming.v < stored.v` → drop as stale (server wins). Tombstones
   (`deleted: true`) ride the same rules, so a stale live copy can never
   resurrect a newer delete. The identical algorithm lives (unit-tested) in
   `src/lib/persistence/merge.ts#serverMergeCollection`; it is inlined here to
   keep the serverless function dependency-free — the `KEEP IN SYNC` comment
   marks the block.
4. **POST response `v3` field** returns `{vCounter, accepted, staleDropped, records}`
   so the client can immediately adopt server-stamped versions (convergence
   without an extra GET).
5. **Blob-size guard.** After merge, `JSON.stringify` length: > **800 KB** adds
   `sizeWarning` to the response (visible to both paths); > **1.5 MB** rejects the
   write with **413 + `alert`** — but *only when the POST contains v3 data*. The
   legacy write path is never blocked, so this guard cannot break existing V2 sync
   (it protects it: v3 growth is the only new pressure on the shared blob).
6. **Preview-env write guard** (plan §5): `VERCEL_ENV === 'preview'` without
   `PREVIEW_DATA_OK` → v3 writes return **503 read-only**. Legacy behavior on
   previews is unchanged (as today). GET remains allowed (additive read).
7. **CORS header list** gains `X-Revital-V3` — additive, required for the GET opt-in.

## Autonomous calls the lead should sanity-check

- **Hard cap value 1.5 MB** — chosen below Upstash/Vercel practical limits with
  headroom above the 800 KB warn line. Easy to tune; single constant.
- **v3 lives inside the same blob** rather than a second Redis key: keeps
  snapshot/restore and auth single-keyed and the change additive; the size guard
  bounds the growth. Split to `revital:data:v3:${code}` later if the blob nears
  the cap (that migration is trivially additive too).
- **GET strips `v3` for legacy clients** — strictly stronger than "legacy clients
  ignore extra fields": the wire response is byte-identical to today's, which is
  what charter criterion (a) demands.
- **`schemaVersion` echo:** server stores whatever the client sends (client is
  the migration authority in Waves 0–1); server-side validation tightens when
  Supabase lands (Wave 2).

## Test coverage

`src/lib/persistence/merge.test.ts` covers: insert-stamp, LWW accept, stale-drop,
tombstone no-resurrection, undelete-after-seen-tombstone, vCounter monotonicity,
and client pull-merge convergence. Blob-guard thresholds are constants; guard
behavior is exercised in review by inspection (no live Redis in unit tests — G2).
