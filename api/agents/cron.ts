// ============================================================
// Revital V3 — GET cron wrapper (Wave 3B, agents-engine)
//
// BINDING contract: docs/waves/wave3-tasks.md §Cron wrapper —
// `api/agents/cron.ts`: GET-accepting, same fail-closed guards as the
// tick (CRON_SECRET required — 503 when unconfigured, 401 on mismatch;
// preview write guard ⇒ 503), internally invokes the tick logic with
// codes from env TICK_CODES and benchPass:true, so a `vercel.json`
// crons entry becomes possible at G1.
//
// G1 NOTE: adding the crons entry to vercel.json is the lead's gate-G1
// move — this file deliberately ships without it. Vercel cron invokes
// with GET and an `Authorization: Bearer <CRON_SECRET>` header, which
// requireCronSecret already accepts (x-cron-secret works too for
// manual invocation).
//
// Semantics: identical to POST /api/agents/tick with body
// {benchPass:true} and no codes override — nightly = deterministic
// passes (SLA, Pit Boss) + the spend-capped Bench Sourcer pass.
// Optional query ?budgetMs=<n> tunes the time budget (invalid values
// fall back to the default). No other input is read from the request —
// a cron URL cannot name codes or jobIds.
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { previewWriteBlocked, requireCronSecret } from '../_lib/guard';
import {
  executeTick,
  parseTickCodes,
  TICK_DEFAULT_BUDGET_MS,
  type TickDeps,
} from './tick';

/** Parse ?budgetMs= defensively — finite positive number or default. */
export function parseCronBudgetMs(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim() === '') {
    return TICK_DEFAULT_BUDGET_MS;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TICK_DEFAULT_BUDGET_MS;
}

export function createCronHandler(deps: TickDeps = {}) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const env = deps.env ?? process.env;

    // Wrapper contract: GET-accepting (Vercel cron convention).
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Same guards as the tick, same order: auth (fail-closed), preview.
    const auth = requireCronSecret(req, env);
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    if (previewWriteBlocked(env)) {
      return res.status(503).json({
        ok: false,
        error:
          'Preview environment: agent paths are read-only (set PREVIEW_DATA_OK to override)',
      });
    }

    const response = await executeTick(
      {
        codes: parseTickCodes(env.TICK_CODES),
        budgetMs: parseCronBudgetMs((req.query ?? {}).budgetMs),
        benchPass: true,
        newJdJobIds: [],
      },
      deps,
    );
    return res.status(200).json(response);
  };
}

export default createCronHandler();
