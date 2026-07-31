import { describe, it, expect, vi } from 'vitest';
import {
  SPEND_DEFAULT_LIMITS,
  SPEND_TTL_SECONDS,
  checkAndCount,
  resolveSpendLimit,
  spendDateKey,
  spendKey,
  type SpendRedis,
} from './spend';

const NOW = new Date('2026-07-31T10:30:00.000Z');

/** In-memory Redis mock implementing the SpendRedis surface. */
function mockRedis(initial: Record<string, number> = {}) {
  const store = new Map<string, number>(Object.entries(initial));
  const expired: Array<{ key: string; seconds: number }> = [];
  const redis: SpendRedis = {
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      expired.push({ key, seconds });
      return 1;
    }),
  };
  return { redis, store, expired };
}

describe('spendKey / spendDateKey', () => {
  it('buckets by UTC day', () => {
    expect(spendDateKey(NOW)).toBe('2026-07-31');
    // 23:59 UTC is still the same bucket; 00:01 next day rolls over
    expect(spendDateKey(new Date('2026-07-31T23:59:59.000Z'))).toBe('2026-07-31');
    expect(spendDateKey(new Date('2026-08-01T00:01:00.000Z'))).toBe('2026-08-01');
  });

  it('matches the contract key shape revital:spend:{code}:{yyyy-mm-dd}:{service}', () => {
    expect(spendKey('rev123', 'claude', NOW)).toBe('revital:spend:rev123:2026-07-31:claude');
    expect(spendKey('rev123', 'enrich', NOW)).toBe('revital:spend:rev123:2026-07-31:enrich');
    expect(spendKey('rev123', 'gemini', NOW)).toBe('revital:spend:rev123:2026-07-31:gemini');
  });
});

describe('resolveSpendLimit', () => {
  it('uses sane defaults when env is unset (200/40/40)', () => {
    expect(resolveSpendLimit('claude', {})).toBe(200);
    expect(resolveSpendLimit('enrich', {})).toBe(40);
    expect(resolveSpendLimit('gemini', {})).toBe(40);
    expect(SPEND_DEFAULT_LIMITS).toEqual({ claude: 200, enrich: 40, gemini: 40 });
  });

  it('reads SPEND_CAP_* env vars', () => {
    const env = { SPEND_CAP_CLAUDE: '500', SPEND_CAP_ENRICH: '10', SPEND_CAP_GEMINI: '25' };
    expect(resolveSpendLimit('claude', env)).toBe(500);
    expect(resolveSpendLimit('enrich', env)).toBe(10);
    expect(resolveSpendLimit('gemini', env)).toBe(25);
  });

  it('falls back to defaults on invalid or non-positive values', () => {
    expect(resolveSpendLimit('claude', { SPEND_CAP_CLAUDE: 'abc' })).toBe(200);
    expect(resolveSpendLimit('claude', { SPEND_CAP_CLAUDE: '0' })).toBe(200);
    expect(resolveSpendLimit('claude', { SPEND_CAP_CLAUDE: '-5' })).toBe(200);
    expect(resolveSpendLimit('claude', { SPEND_CAP_CLAUDE: '2.5' })).toBe(200);
    expect(resolveSpendLimit('claude', { SPEND_CAP_CLAUDE: '' })).toBe(200);
  });
});

describe('checkAndCount', () => {
  it('allows under the limit and reports count/remaining', () => {
    const { redis } = mockRedis();
    return checkAndCount('rev123', 'claude', 5, { redis, now: NOW }).then((r) => {
      expect(r).toEqual({ allowed: true, service: 'claude', count: 1, limit: 5, remaining: 4 });
      expect(r.spendGuard).toBeUndefined();
    });
  });

  it('allows exactly at the limit and blocks the call after it', async () => {
    const { redis } = mockRedis();
    let last;
    for (let i = 0; i < 3; i++) last = await checkAndCount('rev123', 'enrich', 3, { redis, now: NOW });
    expect(last!.allowed).toBe(true); // 3rd call under limit 3 still allowed
    expect(last!.remaining).toBe(0);

    const over = await checkAndCount('rev123', 'enrich', 3, { redis, now: NOW });
    expect(over.allowed).toBe(false); // 4th call blocked
    expect(over.count).toBe(4);
    expect(over.remaining).toBe(0);
  });

  it('sets the 48h TTL only on the first call of the day', async () => {
    const { redis, expired } = mockRedis();
    await checkAndCount('rev123', 'gemini', 10, { redis, now: NOW });
    await checkAndCount('rev123', 'gemini', 10, { redis, now: NOW });
    await checkAndCount('rev123', 'gemini', 10, { redis, now: NOW });
    expect(expired).toEqual([
      { key: 'revital:spend:rev123:2026-07-31:gemini', seconds: SPEND_TTL_SECONDS },
    ]);
    expect(SPEND_TTL_SECONDS).toBe(48 * 60 * 60);
  });

  it('counts per code, per day, per service independently', async () => {
    const { redis, store } = mockRedis();
    await checkAndCount('codeA', 'claude', 10, { redis, now: NOW });
    await checkAndCount('codeB', 'claude', 10, { redis, now: NOW });
    await checkAndCount('codeA', 'gemini', 10, { redis, now: NOW });
    await checkAndCount('codeA', 'claude', 10, { redis, now: new Date('2026-08-01T05:00:00.000Z') });
    expect(store.get('revital:spend:codeA:2026-07-31:claude')).toBe(1);
    expect(store.get('revital:spend:codeB:2026-07-31:claude')).toBe(1);
    expect(store.get('revital:spend:codeA:2026-07-31:gemini')).toBe(1);
    expect(store.get('revital:spend:codeA:2026-08-01:claude')).toBe(1);
  });

  it('resolves the limit from env when not passed explicitly', async () => {
    const { redis } = mockRedis();
    const r = await checkAndCount('rev123', 'claude', undefined, {
      redis,
      now: NOW,
      env: { SPEND_CAP_CLAUDE: '1' },
    });
    expect(r.limit).toBe(1);
    const r2 = await checkAndCount('rev123', 'claude', undefined, {
      redis,
      now: NOW,
      env: { SPEND_CAP_CLAUDE: '1' },
    });
    expect(r2.allowed).toBe(false);
  });

  it('fails OPEN with spendGuard:"unavailable" when Redis throws', async () => {
    const redis: SpendRedis = {
      incr: vi.fn(async () => {
        throw new Error('redis down');
      }),
      expire: vi.fn(async () => 1),
    };
    const r = await checkAndCount('rev123', 'claude', 5, { redis, now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.spendGuard).toBe('unavailable');
    expect(r.count).toBeNull();
    expect(r.remaining).toBeNull();
    expect(r.limit).toBe(5);
  });

  it('fails OPEN when Redis is unconfigured (null)', async () => {
    const r = await checkAndCount('rev123', 'gemini', undefined, { redis: null, now: NOW, env: {} });
    expect(r.allowed).toBe(true);
    expect(r.spendGuard).toBe('unavailable');
    expect(r.limit).toBe(40);
  });

  it('falls back to the "default" bucket for an empty code', async () => {
    const { redis, store } = mockRedis();
    await checkAndCount('', 'claude', 10, { redis, now: NOW });
    expect(store.get('revital:spend:default:2026-07-31:claude')).toBe(1);
  });
});
