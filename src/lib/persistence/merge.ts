// Revital V3 — merge/tombstone/version logic (pure, environment-free).
//
// LWW per-record on SERVER-ASSIGNED version counters (plan §5).
// One monotonic vCounter per blob; every accepted write stamps the record
// v = ++vCounter. Client wall-clocks are NEVER consulted.
//
// This module is the single source of truth for merge semantics:
// - the client pull-merge (pipelineStore) imports it directly;
// - the proposed api/data.ts replacement (docs/diffs/api-data-v2.ts) inlines
//   serverMergeCollection verbatim (kept in sync by unit tests + lead review).

import type { Versioned } from '../../types/pipeline';

export interface ServerMergeResult<T extends Versioned> {
  /** Merged collection (tombstones included — never physically removed). */
  records: T[];
  /** vCounter after stamping accepted writes. */
  vCounter: number;
  /** ids accepted (inserted or updated) in this merge. */
  accepted: string[];
  /** ids rejected as stale (incoming.v < existing.v) — server copy kept. */
  staleDropped: string[];
}

/**
 * Server-side merge of one incoming collection into the stored collection.
 *
 * Per incoming record:
 *  1. id unknown              → insert, stamp v = ++vCounter
 *  2. incoming.v >= stored.v  → client saw latest server state → apply, stamp
 *  3. incoming.v <  stored.v  → client stale → drop (server copy wins)
 *
 * Tombstones ride the same rules: a delete is an update with deleted: true,
 * so a stale live copy can never resurrect a newer tombstone; undelete
 * requires having seen the tombstone's v (one-click-undo path).
 */
export function serverMergeCollection<T extends Versioned>(
  stored: T[],
  incoming: T[],
  vCounter: number,
): ServerMergeResult<T> {
  const map = new Map<string, T>();
  for (const rec of stored) {
    if (rec && typeof rec.id === 'string') map.set(rec.id, rec);
  }
  const accepted: string[] = [];
  const staleDropped: string[] = [];
  let counter = Number.isFinite(vCounter) && vCounter > 0 ? vCounter : 0;

  for (const rec of incoming) {
    if (!rec || typeof rec.id !== 'string') continue;
    const existing = map.get(rec.id);
    const incomingV = typeof rec.v === 'number' && rec.v >= 0 ? rec.v : 0;
    if (existing && incomingV < existing.v) {
      staleDropped.push(rec.id);
      continue;
    }
    counter += 1;
    map.set(rec.id, { ...rec, v: counter });
    accepted.push(rec.id);
  }

  return {
    records: Array.from(map.values()),
    vCounter: counter,
    accepted,
    staleDropped,
  };
}

/**
 * Client-side pull merge (GET → local state).
 * Per record: remote.v > local.v → take remote; otherwise keep local.
 * At equal v the copies are either identical or the local one carries an
 * unsynced edit that will win the next POST — keeping local is correct in
 * both cases. Records only present on one side are kept.
 */
export function clientPullMerge<T extends Versioned>(
  local: T[],
  remote: T[],
): T[] {
  const map = new Map<string, T>();
  for (const rec of local) {
    if (rec && typeof rec.id === 'string') map.set(rec.id, rec);
  }
  for (const rec of remote) {
    if (!rec || typeof rec.id !== 'string') continue;
    const localRec = map.get(rec.id);
    if (!localRec || rec.v > localRec.v) {
      map.set(rec.id, rec);
    }
  }
  return Array.from(map.values());
}

/** Mark a record as tombstoned (never physically delete). */
export function tombstone<T extends Versioned>(rec: T, ts: string): T {
  return { ...rec, deleted: true as const, deletedAt: ts, updatedAt: ts };
}

/** Live (non-tombstoned) records only — for UI selectors. */
export function liveOnly<T extends Versioned>(records: T[]): T[] {
  return records.filter((r) => !r.deleted);
}
