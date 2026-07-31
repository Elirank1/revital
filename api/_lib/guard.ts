// Preview-env write guard + cron auth helpers (plan §5 "Preview/prod data isolation").
//
// Preview deployments share prod env vars by default, so new data paths must be
// read-only/503 on previews unless PREVIEW_DATA_OK is explicitly set.
// `api/agents/tick` additionally requires CRON_SECRET.
//
// Pure and dependency-free so unit tests can pass plain objects.

type Env = Record<string, string | undefined>;

/** Minimal structural request type — matches VercelRequest.headers. */
export interface HeaderCarrier {
  headers: Record<string, string | string[] | undefined>;
}

function headerValue(req: HeaderCarrier, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * True when new data paths must refuse writes: VERCEL_ENV === 'preview'
 * and PREVIEW_DATA_OK is unset/empty. Callers respond read-only or 503.
 */
export function previewWriteBlocked(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'preview' && !env.PREVIEW_DATA_OK;
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Cron auth for `api/agents/tick`. Accepts the Vercel cron convention
 * (`Authorization: Bearer <CRON_SECRET>`) or an explicit `x-cron-secret` header.
 * Fails CLOSED (503) when CRON_SECRET is not configured — an unprotected tick
 * endpoint must never run.
 */
export function requireCronSecret(req: HeaderCarrier, env: Env = process.env): CronAuthResult {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return { ok: false, status: 503, error: 'CRON_SECRET not configured' };
  }
  const bearer = headerValue(req, 'authorization');
  const direct = headerValue(req, 'x-cron-secret');
  if (bearer === `Bearer ${secret}` || direct === secret) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: 'Invalid cron secret' };
}
