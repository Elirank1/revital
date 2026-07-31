// ============================================================
// Revital V3 — Client sync through /api/data's v3 section (Wave 1)
//
// Talks to the LIVE v2 api/data.ts as-is:
//   - opt-in via the `X-Revital-V3: 1` header (legacy responses stay
//     byte-identical without it);
//   - push sends ONLY dirty records inside `{ v3: {...} }`;
//   - the POST response echoes server-stamped records
//     (`v3.records` per collection) which we adopt via applyRemote —
//     no extra GET needed (D-013);
//   - pull GETs the blob and merges `v3.*` via LWW clientPullMerge.
//
// Everything is a no-op while the revital_v3_flag is off (flag-off =
// store never touched). 413 (blob cap) and 503 (preview read-only)
// surface as structured results — never thrown into UI paths.
// ============================================================

import { usePipelineStore } from '../../store/pipelineStore';
import { isV3Enabled } from './keys';

export const API_DATA_PATH = '/api/data';

export interface SyncResult {
  ok: boolean;
  skipped?: 'flag_off' | 'nothing_dirty';
  status?: number;
  error?: string;
  /** Server warn-threshold message (~800KB), when present. */
  sizeWarning?: string;
  /** Server hard-cap alert (413), when present. */
  alert?: string;
  /** Preview-env read-only guard hit (503). */
  readOnly?: boolean;
  accepted?: string[];
  staleDropped?: string[];
}

type FetchLike = typeof fetch;

function headers(accessCode: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Access-Code': accessCode,
    'X-Revital-V3': '1',
  };
}

/** Pull the v3 section and LWW-merge it into the store. Flag-gated. */
export async function pullV3(
  accessCode: string,
  fetchFn: FetchLike = fetch,
): Promise<SyncResult> {
  if (!isV3Enabled()) return { ok: false, skipped: 'flag_off' };
  try {
    const res = await fetchFn(API_DATA_PATH, {
      method: 'GET',
      headers: headers(accessCode),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `GET ${res.status}` };
    }
    const body = await res.json();
    if (body?.v3) {
      usePipelineStore.getState().applyRemote({
        persons: body.v3.persons,
        deals: body.v3.deals,
        events: body.v3.events,
        suggestions: body.v3.suggestions,
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Push dirty records to the v3 section. Adopts server-stamped versions from
 * the response, then clears dirty ids via markSynced. Flag-gated.
 */
export async function pushV3(
  accessCode: string,
  fetchFn: FetchLike = fetch,
): Promise<SyncResult> {
  if (!isV3Enabled()) return { ok: false, skipped: 'flag_off' };
  const store = usePipelineStore.getState();
  const payload = store.buildPushPayload();
  const dirtyCount =
    payload.persons.length +
    payload.deals.length +
    payload.events.length +
    payload.suggestions.length;
  if (dirtyCount === 0) return { ok: true, skipped: 'nothing_dirty' };

  try {
    const res = await fetchFn(API_DATA_PATH, {
      method: 'POST',
      headers: headers(accessCode),
      body: JSON.stringify({ v3: payload }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.status === 413) {
      return { ok: false, status: 413, error: body?.error, alert: body?.alert };
    }
    if (res.status === 503) {
      return { ok: false, status: 503, error: body?.error, readOnly: true };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: body?.error ?? `POST ${res.status}` };
    }

    // Adopt server-assigned `v` counters so subsequent LWW rounds are exact.
    if (body?.v3?.records) {
      usePipelineStore.getState().applyRemote({
        persons: body.v3.records.persons,
        deals: body.v3.records.deals,
        events: body.v3.records.events,
        suggestions: body.v3.records.suggestions,
      });
    }
    // Note: clears ALL dirty ids — records dirtied mid-flight are re-marked
    // by their own mutations only if they happen after this line; Wave-1
    // sync runs are user-triggered and serialized, so this is acceptable.
    usePipelineStore.getState().markSynced();

    return {
      ok: true,
      accepted: body?.v3?.accepted,
      staleDropped: body?.v3?.staleDropped,
      ...(body?.sizeWarning ? { sizeWarning: body.sizeWarning } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Load-time sync: pull server state first, then push anything still dirty. */
export async function syncV3OnLoad(
  accessCode: string,
  fetchFn: FetchLike = fetch,
): Promise<{ pull: SyncResult; push: SyncResult }> {
  const pull = await pullV3(accessCode, fetchFn);
  const push = await pushV3(accessCode, fetchFn);
  return { pull, push };
}
