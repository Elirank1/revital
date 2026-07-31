// Daily agent tick — Wave-0 STUB (plan §5 cron feasibility).
//
// No agent logic yet. This endpoint only establishes the safety contract:
//   1. CRON_SECRET required (Vercel cron `Authorization: Bearer <secret>` or
//      `x-cron-secret`); fails closed with 503 when the secret is unconfigured.
//   2. Preview-env write guard: on preview deployments without PREVIEW_DATA_OK,
//      agent paths are read-only → 503.
// Wave 2 adds the chunked, incremental fan-out over new/changed records.
// Agents write ONLY to suggestions/agent_runs — never to card state (plan §3).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { previewWriteBlocked, requireCronSecret } from '../_lib/guard';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const auth = requireCronSecret(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  if (previewWriteBlocked()) {
    return res.status(503).json({
      ok: false,
      error: 'Preview environment: agent paths are read-only (set PREVIEW_DATA_OK to override)',
    });
  }

  return res.status(200).json({ ok: true, ran: [] });
}
