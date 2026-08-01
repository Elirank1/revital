// ============================================================
// Revital — sync-restore merge rehearsal (incident D-041 / owner
// decision: backup-first restore ceremony, separate from G1).
//
// Takes a revital-localStorage-backup JSON (the one-click backup tool's
// output) and rehearses the FULL empty-server restore path using the
// EXACT semantics of the deployed V2 code (wip-fingerprint-drive
// appStore.ts + api/data.ts, which the mini-ceremony redeploys
// content-identically):
//
//   1. boot:   client GET  -> empty-server shape {analyses:[],savedJobs:[],log:[]}
//              (syncFromCloud skips merge on empty arrays — verified no-op)
//   2. push:   client POST {analyses, savedJobs, log} -> server mergeById
//              into empty blob, caps 100/50/200, newest-first by
//              timestamp||createdAt
//   3. pull:   second browser GET -> mergeById into ITS empty local state
//   4. verify: second browser's synced sets == first browser's (by id),
//              and every local item survived (no dedupe/tombstone/cap loss)
//
// Also audits what the server NEVER carries: outreach / interviews /
// profileIntel / fingerprints / settings live only in localStorage —
// they restore by importing the backup locally, not via sync.
//
// Usage (Node 22+):
//   node --experimental-strip-types scripts/data/rehearse-restore.ts <backup.json>
//
// Exit 0 = clean rehearsal; exit 1 = findings that need a decision.
// Read-only: touches no network, no live data (G2-safe by construction).
// ============================================================

import { readFileSync } from 'node:fs';

// ---- exact copies of the deployed V2 merge (api/data.ts + appStore.ts) ----

type AnyRec = Record<string, unknown> & { id?: string; timestamp?: string; createdAt?: string };

function mergeById(existing: AnyRec[], incoming: AnyRec[], maxItems: number): AnyRec[] {
  const map = new Map<string, AnyRec>();
  for (const item of existing) if (item?.id) map.set(item.id as string, item);
  for (const item of incoming) if (item?.id) map.set(item.id as string, item);
  return Array.from(map.values())
    .sort((a, b) => String(b.timestamp || b.createdAt || '').localeCompare(String(a.timestamp || a.createdAt || '')))
    .slice(0, maxItems);
}

const SYNCED: Array<{ lsKey: string; blobKey: 'analyses' | 'savedJobs' | 'log'; cap: number }> = [
  { lsKey: 'revital_analyses', blobKey: 'analyses', cap: 100 },
  { lsKey: 'revital_savedJobs', blobKey: 'savedJobs', cap: 50 },
  { lsKey: 'revital_log', blobKey: 'log', cap: 200 },
];

const LOCAL_ONLY = ['revital_settings', 'revital_outreach', 'revital_interviews', 'revital_profileIntel', 'revital_fingerprints'];
const SENSITIVE_KEYS = ['revital_settings']; // contains the access code — never print contents

const path = process.argv[2];
if (!path) {
  console.error('usage: node --experimental-strip-types scripts/data/rehearse-restore.ts <backup.json>');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(path, 'utf8'));
if (backup.tool !== 'revital-localStorage-backup' || !backup.data) {
  console.error('not a revital-localStorage-backup file (missing tool/data fields)');
  process.exit(1);
}

const findings: string[] = [];
const notes: string[] = [];
const raw: Record<string, string> = backup.data;

console.log(`backup: origin=${backup.origin} exportedAt=${backup.exportedAt}`);
console.log(`keys: ${backup.keyCount} total, ${backup.revitalKeyCount} revital_*, ${Math.round((backup.totalChars || 0) / 1024)}KB chars\n`);

// ---- per-key parse + inventory ----
const parsed: Record<string, unknown> = {};
for (const [k, v] of Object.entries(raw)) {
  if (!k.startsWith('revital')) continue;
  try {
    parsed[k] = JSON.parse(v);
    const val = parsed[k];
    const n = Array.isArray(val) ? `${val.length} items` : typeof val;
    const secret = SENSITIVE_KEYS.includes(k) ? ' [contents withheld — sensitive]' : '';
    console.log(`  ${k}: ${n}, ${Math.round(v.length / 1024)}KB${secret}`);
  } catch {
    findings.push(`${k}: value is NOT valid JSON (${v.length} chars) — would be silently ignored by the app's loadFromStorage fallback`);
  }
}

// ---- rehearse the sync path ----
console.log('\n--- rehearsal: empty server, full localStorage ---');
const server: { analyses: AnyRec[]; savedJobs: AnyRec[]; log: AnyRec[] } = { analyses: [], savedJobs: [], log: [] };

for (const { lsKey, blobKey, cap } of SYNCED) {
  const local = (parsed[lsKey] as AnyRec[]) ?? [];
  if (!Array.isArray(local)) {
    findings.push(`${lsKey}: not an array — sync would push nothing for ${blobKey}`);
    continue;
  }

  // step 1: boot pull — empty arrays skip the client merge entirely (verified in appStore)
  // step 2: push — server merge into empty
  const noId = local.filter((it) => !it || !it.id);
  const ids = local.filter((it) => it?.id).map((it) => it.id as string);
  const dupIds = ids.length - new Set(ids).size;
  const afterServer = mergeById(server[blobKey], local, cap);
  server[blobKey] = afterServer;

  // step 3: second-browser pull into empty local
  const secondBrowser = mergeById([], afterServer, cap);

  // step 4: verify
  const localIdSet = new Set(ids);
  const roundTrip = new Set(secondBrowser.map((it) => it.id as string));
  const lost = [...localIdSet].filter((id) => !roundTrip.has(id));

  console.log(`  ${blobKey}: local=${local.length} -> server=${afterServer.length} -> secondBrowser=${secondBrowser.length} (cap ${cap})`);
  if (noId.length) findings.push(`${blobKey}: ${noId.length} item(s) WITHOUT id — mergeById DROPS them (never reach the server)`);
  if (dupIds > 0) findings.push(`${blobKey}: ${dupIds} duplicate id(s) — collapsed to one (last occurrence wins)`);
  if (lost.length) findings.push(`${blobKey}: ${lost.length} id(s) lost in round-trip (cap overflow) — e.g. ${lost.slice(0, 3).join(', ')}`);
  if (local.length === cap) notes.push(`${blobKey}: local count sits exactly at the cap (${cap}) — older items may already have rotated out historically (not a restore loss)`);
}

// ---- payload size vs transport limits ----
const postBody = JSON.stringify({
  analyses: server.analyses, savedJobs: server.savedJobs, log: server.log,
});
const kb = Math.round(postBody.length / 1024);
console.log(`\n  POST payload: ${kb}KB (Vercel fn body limit ~4.5MB; Upstash free request limit ~1MB)`);
if (postBody.length > 900 * 1024) findings.push(`POST payload ${kb}KB exceeds the safe Upstash request budget (~900KB) — restore needs chunking or a paid tier`);

// ---- local-only modules ----
console.log('\n--- local-only modules (NEVER carried by the server; restore = import backup into localStorage) ---');
for (const k of LOCAL_ONLY) {
  const v = parsed[k];
  const n = Array.isArray(v) ? `${v.length} items` : v === undefined ? 'absent' : typeof v;
  console.log(`  ${k}: ${n}`);
}

// ---- verdict ----
console.log('\n=== findings ===');
if (findings.length === 0) console.log('  none — clean rehearsal: fresh KV + this backup round-trips with zero loss.');
for (const f of findings) console.log(`  FINDING: ${f}`);
for (const n of notes) console.log(`  note: ${n}`);
process.exit(findings.length === 0 ? 0 : 1);
