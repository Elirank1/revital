// ============================================================
// Revital V3 — Redis blob snapshot (Wave 0, platform-data)
//
// Reads the sync blob via /api/data GET (additive read only — G2-safe:
// no write, no live-data mutation) and writes a timestamped JSON file
// to scripts/data/snapshots/.
//
// Usage (Node 22+, TS type-stripping):
//   REVITAL_ACCESS_CODE=xxx node --experimental-strip-types scripts/data/snapshot.ts
//
// Env:
//   REVITAL_ACCESS_CODE  (required) — access code, sent as X-Access-Code
//   REVITAL_DATA_URL     (optional) — full /api/data URL
//                        default: https://revital-three.vercel.app/api/data
//   REVITAL_SNAPSHOT_V3  (optional) — set to '1' to include the v3 section
//                        (sends X-Revital-V3: 1; still a pure GET)
// ============================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://revital-three.vercel.app/api/data';

async function main(): Promise<void> {
  const accessCode = process.env.REVITAL_ACCESS_CODE;
  if (!accessCode) {
    console.error('REVITAL_ACCESS_CODE env var is required (never hardcode it).');
    process.exit(1);
  }
  const url = process.env.REVITAL_DATA_URL || DEFAULT_URL;
  const includeV3 = process.env.REVITAL_SNAPSHOT_V3 === '1';

  const headers: Record<string, string> = { 'X-Access-Code': accessCode };
  if (includeV3) headers['X-Revital-V3'] = '1';

  console.log(`Snapshotting ${url} (v3 section: ${includeV3 ? 'yes' : 'no'}) ...`);
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    console.error(`GET failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const blob: unknown = await res.json();

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const outDir = join(scriptDir, 'snapshots');
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(outDir, `snapshot-${stamp}.json`);
  const payload = {
    takenAt: new Date().toISOString(),
    sourceUrl: url,
    includesV3: includeV3,
    blob,
  };
  const serialized = JSON.stringify(payload, null, 2);
  writeFileSync(outPath, serialized, 'utf8');

  const counts =
    blob && typeof blob === 'object'
      ? Object.entries(blob as Record<string, unknown>)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
          .join(' ')
      : '';
  console.log(`Wrote ${outPath} (${serialized.length} bytes) ${counts}`);
}

main().catch((err) => {
  console.error('Snapshot failed:', err);
  process.exit(1);
});
