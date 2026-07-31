// Per-access-code daily spend caps (plan §5: "Existing paid deps get caps in Wave 0",
// plan §3: agent brains run "behind a per-access-code daily spend cap").
//
// Backed by the same Upstash Redis as /api/data (KV_REST_API_URL / KV_REST_API_TOKEN).
// Key shape: revital:spend:{code}:{yyyy-mm-dd}:{service} — INCR + TTL 48h.
//
// Semantics: checkAndCount INCRements first, then compares; the call is allowed while
// count <= limit, so the Nth call under a limit of N succeeds and call N+1 gets blocked.
// Graceful degradation: on any Redis failure (or missing env), FAIL OPEN — allow the
// call but mark the result with spendGuard:'unavailable' so callers can surface it.
//
// Key-building / limit-resolution logic is pure and unit-tested; Redis is injectable.

import { Redis } from '@upstash/redis';

export type SpendService = 'claude' | 'enrich' | 'gemini';

/** Sane defaults (calls/day) when SPEND_CAP_* env vars are unset. */
export const SPEND_DEFAULT_LIMITS: Record<SpendService, number> = {
  claude: 200,
  enrich: 40,
  gemini: 40,
};

export const SPEND_ENV_KEYS: Record<SpendService, string> = {
  claude: 'SPEND_CAP_CLAUDE',
  enrich: 'SPEND_CAP_ENRICH',
  gemini: 'SPEND_CAP_GEMINI',
};

/** 48h TTL: covers timezone skew around the UTC day boundary, then self-cleans. */
export const SPEND_TTL_SECONDS = 48 * 60 * 60;

type Env = Record<string, string | undefined>;

/** UTC day bucket, yyyy-mm-dd. UTC keeps serverless regions consistent. */
export function spendDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** revital:spend:{code}:{yyyy-mm-dd}:{service} */
export function spendKey(code: string, service: SpendService, now: Date = new Date()): string {
  return `revital:spend:${code}:${spendDateKey(now)}:${service}`;
}

/** Limit from env (SPEND_CAP_CLAUDE etc.), falling back to defaults on unset/invalid. */
export function resolveSpendLimit(service: SpendService, env: Env = process.env): number {
  const raw = env[SPEND_ENV_KEYS[service]];
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return SPEND_DEFAULT_LIMITS[service];
}

/** Minimal Redis surface used by the guard — injectable for tests. */
export interface SpendRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface SpendCheckResult {
  allowed: boolean;
  service: SpendService;
  /** Today's call count after this increment; null when the guard was unavailable. */
  count: number | null;
  limit: number;
  /** Calls left today (0 when at/over cap); null when the guard was unavailable. */
  remaining: number | null;
  /** Present only when Redis failed / is unconfigured and we failed open. */
  spendGuard?: 'unavailable';
}

let cachedRedis: SpendRedis | null | undefined;

function getDefaultRedis(): SpendRedis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

export interface SpendCheckDeps {
  /** Inject a mock (tests) or `null` to simulate an unconfigured store. */
  redis?: SpendRedis | null;
  now?: Date;
  env?: Env;
}

/**
 * Count one call for `code`×`service` today and decide whether it may proceed.
 * Never throws: Redis trouble means fail-open with spendGuard:'unavailable'.
 */
export async function checkAndCount(
  code: string,
  service: SpendService,
  limit?: number,
  deps: SpendCheckDeps = {},
): Promise<SpendCheckResult> {
  const effectiveLimit = limit ?? resolveSpendLimit(service, deps.env);
  const redis = deps.redis !== undefined ? deps.redis : getDefaultRedis();

  if (!redis) {
    return { allowed: true, service, count: null, limit: effectiveLimit, remaining: null, spendGuard: 'unavailable' };
  }

  try {
    const key = spendKey(code || 'default', service, deps.now);
    const count = await redis.incr(key);
    if (count === 1) {
      // First call of the day for this bucket — arm the TTL so keys self-clean.
      await redis.expire(key, SPEND_TTL_SECONDS);
    }
    return {
      allowed: count <= effectiveLimit,
      service,
      count,
      limit: effectiveLimit,
      remaining: Math.max(0, effectiveLimit - count),
    };
  } catch {
    return { allowed: true, service, count: null, limit: effectiveLimit, remaining: null, spendGuard: 'unavailable' };
  }
}
