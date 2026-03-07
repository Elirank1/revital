// Vercel Serverless Function — syncs user data via Vercel KV
// Data is keyed by access code, enabling cross-device access

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const ACCESS_CODE = process.env.ACCESS_CODE || '';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');

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

  if (req.method === 'GET') {
    const data = await kv.get(key);
    return res.status(200).json(data || { analyses: [], savedJobs: [], log: [] });
  }

  if (req.method === 'POST') {
    const { analyses, savedJobs, log } = req.body;

    if (!analyses && !savedJobs && !log) {
      return res.status(400).json({ error: 'No data provided' });
    }

    // Merge: fetch existing, then update with incoming
    const existing = (await kv.get<any>(key)) || { analyses: [], savedJobs: [], log: [] };

    const merged = {
      analyses: mergeById(existing.analyses || [], analyses || [], 100),
      savedJobs: mergeById(existing.savedJobs || [], savedJobs || [], 50),
      log: mergeById(existing.log || [], log || [], 200),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(key, merged);
    return res.status(200).json({ ok: true, counts: {
      analyses: merged.analyses.length,
      savedJobs: merged.savedJobs.length,
      log: merged.log.length,
    }});
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
