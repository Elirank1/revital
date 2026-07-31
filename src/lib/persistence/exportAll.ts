// ============================================================
// Revital V3 — Export everything (Wave 1)
//
// One JSON blob of ALL Revital localStorage state — legacy `revital_*`
// keys AND v3 `revital_v3_*` keys — for her own local backup.
// No network. No mutation. Pure read of localStorage.
// ============================================================

import { PIPELINE_SCHEMA_VERSION } from '../../types/pipeline';

export const EXPORT_KEY_PREFIX = 'revital_';

export interface ExportBlob {
  app: 'revital';
  exportedAt: string;
  schemaVersion: number;
  /** Every revital_* localStorage key → parsed JSON (raw string if unparsable). */
  keys: Record<string, unknown>;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Collect every revital_* key into one export blob. Read-only. */
export function buildExportBlob(now: () => Date = () => new Date()): ExportBlob {
  const keys: Record<string, unknown> = {};
  const s = storage();
  if (s) {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key || !key.startsWith(EXPORT_KEY_PREFIX)) continue;
      const raw = s.getItem(key);
      if (raw === null) continue;
      try {
        keys[key] = JSON.parse(raw);
      } catch {
        keys[key] = raw; // e.g. the bare 'on' flag value
      }
    }
  }
  return {
    app: 'revital',
    exportedAt: now().toISOString(),
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    keys,
  };
}

/** Pretty-printed JSON string of the export blob (download payload). */
export function exportAllJson(now: () => Date = () => new Date()): string {
  return JSON.stringify(buildExportBlob(now), null, 2);
}

/** Suggested download filename, e.g. revital-export-2026-07-31-1420.json */
export function exportFilename(now: () => Date = () => new Date()): string {
  const d = now();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `revital-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}
