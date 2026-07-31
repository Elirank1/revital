// ============================================================
// PROPOSED replacement for api/data.ts — v2 (Wave 0, platform-data)
// NOT LIVE. The lead reviews line-by-line and applies (charter rule).
// Rationale: docs/diffs/api-data-v2-RATIONALE.md
//
// Contract (plan §5 + charter task 4):
//   - Legacy paths byte-identical: analyses/savedJobs/log merge, caps,
//     response shapes unchanged. A legacy client cannot tell the difference.
//   - Additive v3 section: persons/deals/events/suggestions/agentRuns,
//     tombstone-aware, per-record SERVER-assigned `v` counters, LWW.
//   - Blob-size guard: ~800KB warn field, 1.5MB hard cap → 413 + alert
//     (v3 writes only — the legacy write path is never blocked).
//   - Preview guard: VERCEL_ENV==='preview' && !PREVIEW_DATA_OK ⇒ v3
//     writes 503 read-only (plan §5).
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const ACCESS_CODE = process.env.ACCESS_CODE || '';

// --- v3 constants -------------------------------------------------
const BLOB_WARN_BYTES = 800_000; // ~800KB — warn threshold (plan §5)
const BLOB_HARD_CAP_BYTES = 1_500_000; // hard cap — reject v3 writes with 413
const V3_COLLECTIONS = ['persons', 'deals', 'events', 'suggestions', 'agentRuns'] as const;
type V3Collection = (typeof V3_COLLECTIONS)[number];

interface VersionedRecord {
  id: string;
  v: number;
  deleted?: true;
  [key: string]: unknown;
}

interface V3Section {
  schemaVersion: number;
  vCounter: number;
  persons: VersionedRecord[];
  deals: VersionedRecord[];
  events: VersionedRecord[];
  suggestions: VersionedRecord[];
  agentRuns: VersionedRecord[];
}

function emptyV3(): V3Section {
  return {
    schemaVersion: 1,
    vCounter: 0,
    persons: [],
    deals: [],
    events: [],
    suggestions: [],
    agentRuns: [],
  };
}

/** Preview-env write guard (plan §5): new data paths read-only on previews. */
function previewWriteBlocked(): boolean {
  return process.env.VERCEL_ENV === 'preview' && !process.env.PREVIEW_DATA_OK;
}

function getDataKey(code: string): string {
  return `revital:data:${code}`;
}

function authenticate(req: VercelRequest): string | null {
  if (!ACCESS_CODE) return null;
  const provided = req.headers['x-access-code'] as string;
  if (provided !== ACCESS_CODE) return null;
  return provided;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code, X-Revital-V3');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Auth
  if (ACCESS_CODE) {
    const code = authenticate(req);
    if (!code) {
      return res.status(401).json({ error: 'Invalid access code' });
    }
  }

  const accessCode = (req.headers['x-access-code'] as string) || 'default';
  const key = getDataKey(accessCode);
  const wantsV3 = req.headers['x-revital-v3'] === '1' || req.query?.v3 === '1';

  if (req.method === 'GET') {
    const data = await kv.get<any>(key);
    const blob = data || { analyses: [], savedJobs: [], log: [] };
    if (!wantsV3) {
      // Legacy client: response byte-identical to v1 — v3 section stripped.
      const { v3: _v3, ...legacy } = blob;
      return res.status(200).json(legacy);
    }
    return res.status(200).json({ ...blob, v3: blob.v3 || emptyV3() });
  }

  if (req.method === 'POST') {
    const { analyses, savedJobs, log, v3 } = req.body || {};

    if (!analyses && !savedJobs && !log && !v3) {
      return res.status(400).json({ error: 'No data provided' });
    }

    // Merge: fetch existing, then update with incoming
    const existing = (await kv.get<any>(key)) || { analyses: [], savedJobs: [], log: [] };

    // --- Legacy section: identical semantics to v1 (same merge, same caps) ---
    const merged: any = {
      analyses: mergeById(existing.analyses || [], analyses || [], 100),
      savedJobs: mergeById(existing.savedJobs || [], savedJobs || [], 50),
      log: mergeById(existing.log || [], log || [], 200),
      updatedAt: new Date().toISOString(),
    };
    // Carry the stored v3 section forward untouched by legacy-only writes.
    if (existing.v3) merged.v3 = existing.v3;

    // --- v3 section: additive, tombstone-aware, server-assigned LWW ---
    let v3Result:
      | { vCounter: number; accepted: string[]; staleDropped: string[]; records: Partial<Record<V3Collection, VersionedRecord[]>> }
      | undefined;

    if (v3) {
      if (previewWriteBlocked()) {
        return res.status(503).json({
          error: 'Preview environment is read-only for v3 data paths',
          readOnly: true,
        });
      }

      const stored: V3Section = existing.v3 || emptyV3();
      let vCounter = stored.vCounter || 0;
      const accepted: string[] = [];
      const staleDropped: string[] = [];
      const records: Partial<Record<V3Collection, VersionedRecord[]>> = {};

      for (const col of V3_COLLECTIONS) {
        const incoming: VersionedRecord[] = Array.isArray(v3[col]) ? v3[col] : [];
        if (!incoming.length) continue;
        // KEEP IN SYNC with src/lib/persistence/merge.ts#serverMergeCollection
        // (unit-tested there; inlined here so this function stays self-contained).
        const map = new Map<string, VersionedRecord>();
        for (const rec of stored[col] || []) {
          if (rec && typeof rec.id === 'string') map.set(rec.id, rec);
        }
        for (const rec of incoming) {
          if (!rec || typeof rec.id !== 'string') continue;
          const current = map.get(rec.id);
          const incomingV = typeof rec.v === 'number' && rec.v >= 0 ? rec.v : 0;
          if (current && incomingV < current.v) {
            staleDropped.push(rec.id); // stale write loses; tombstones never resurrect
            continue;
          }
          vCounter += 1;
          map.set(rec.id, { ...rec, v: vCounter });
          accepted.push(rec.id);
        }
        stored[col] = Array.from(map.values());
        records[col] = stored[col];
      }

      stored.vCounter = vCounter;
      stored.schemaVersion = typeof v3.schemaVersion === 'number' ? v3.schemaVersion : stored.schemaVersion;
      merged.v3 = stored;
      v3Result = { vCounter, accepted, staleDropped, records };
    }

    // --- Blob-size guard (plan §5) ---
    const serialized = JSON.stringify(merged);
    const blobBytes = serialized.length;
    if (v3 && blobBytes > BLOB_HARD_CAP_BYTES) {
      // Hard cap applies to NEW (v3) writes only — legacy sync is never blocked.
      return res.status(413).json({
        error: 'Data blob exceeds hard cap',
        alert: `Blob size ${blobBytes} bytes exceeds hard cap ${BLOB_HARD_CAP_BYTES}. v3 write rejected; rotate events/audit or migrate history (plan §5).`,
        blobBytes,
      });
    }

    await kv.set(key, merged);

    const response: any = {
      ok: true,
      counts: {
        analyses: merged.analyses.length,
        savedJobs: merged.savedJobs.length,
        log: merged.log.length,
      },
    };
    if (v3Result) response.v3 = v3Result;
    if (blobBytes > BLOB_WARN_BYTES) {
      response.sizeWarning = `Blob size ${blobBytes} bytes exceeds warn threshold ${BLOB_WARN_BYTES}`;
    }
    return res.status(200).json(response);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/** Merge two arrays by id, newest first, capped at maxItems */
function mergeById(existing: any[], incoming: any[], maxItems: number): any[] {
  const map = new Map<string, any>();
  // Existing first, then incoming overwrites
  for (const item of existing) {
    if (item?.id) map.set(item.id, item);
  }
  for (const item of incoming) {
    if (item?.id) map.set(item.id, item);
  }
  return Array.from(map.values())
    .sort((a, b) => (b.timestamp || b.createdAt || '').localeCompare(a.timestamp || a.createdAt || ''))
    .slice(0, maxItems);
}
