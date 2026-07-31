// ============================================================
// Legacy smoke suite — api/data.ts (quality-gate, Wave 0)
// HTTP-level pinning of mergeById semantics + auth + method
// handling. @upstash/redis is mocked with an in-memory map —
// the live Upstash blob is NEVER touched (gate G2).
// NOTE: api/ is outside tsconfig "include", so this file is
// exercised by vitest but not by `npm run typecheck` — matching
// how api/*.ts itself is treated today.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ kvStore: new Map<string, unknown>() }));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(_cfg: unknown) {}
    async get(key: string) {
      return h.kvStore.has(key) ? h.kvStore.get(key) : null;
    }
    async set(key: string, value: unknown) {
      h.kvStore.set(key, value);
      return 'OK';
    }
  },
}));

// Env must be set BEFORE the module loads (ACCESS_CODE is read at import).
process.env.KV_REST_API_URL = 'https://synthetic.upstash.local';
process.env.KV_REST_API_TOKEN = 'synthetic-token';
process.env.ACCESS_CODE = 'synthetic-code';

const { default: handler } = await import('./data');

// ---- minimal Vercel req/res fakes ----

function makeReq(method: string, opts: { code?: string; body?: unknown } = {}) {
  return {
    method,
    headers: opts.code !== undefined ? { 'x-access-code': opts.code } : {},
    body: opts.body,
  } as any;
}

function makeRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as unknown,
    ended: false,
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

const DATA_KEY = 'revital:data:synthetic-code';

function item(id: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return { id, timestamp, ...extra };
}

beforeEach(() => {
  h.kvStore.clear();
});

describe('api/data — auth and methods', () => {
  it('OPTIONS returns 200 with CORS headers', async () => {
    const res = makeRes();
    await handler(makeReq('OPTIONS'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['Access-Control-Allow-Headers']).toContain('X-Access-Code');
  });

  it('rejects a wrong access code with 401', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { code: 'wrong-code' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid access code' });
  });

  it('rejects a missing access code with 401 when ACCESS_CODE is configured', async () => {
    const res = makeRes();
    await handler(makeReq('GET'), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 405 for unsupported methods', async () => {
    const res = makeRes();
    await handler(makeReq('DELETE', { code: 'synthetic-code' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('GET with no stored blob returns the empty shape', async () => {
    const res = makeRes();
    await handler(makeReq('GET', { code: 'synthetic-code' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ analyses: [], savedJobs: [], log: [] });
  });

  it('POST with no data arrays returns 400', async () => {
    const res = makeRes();
    await handler(makeReq('POST', { code: 'synthetic-code', body: {} }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('api/data — POST mergeById semantics', () => {
  it('merges by id: incoming overwrites existing, union is kept, newest-first by timestamp', async () => {
    h.kvStore.set(DATA_KEY, {
      analyses: [
        item('shared', '2026-01-01T00:00:00.000Z', { note: 'existing' }),
        item('existing-only', '2026-01-05T00:00:00.000Z'),
      ],
      savedJobs: [],
      log: [],
    });
    const res = makeRes();
    await handler(
      makeReq('POST', {
        code: 'synthetic-code',
        body: {
          analyses: [
            item('shared', '2026-01-03T00:00:00.000Z', { note: 'incoming' }),
            item('incoming-only', '2026-01-04T00:00:00.000Z'),
          ],
        },
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, counts: { analyses: 3, savedJobs: 0, log: 0 } });
    const blob = h.kvStore.get(DATA_KEY) as any;
    // Union only — nothing invented, incoming wins the id conflict
    expect(blob.analyses.map((a: any) => a.id)).toEqual(['existing-only', 'incoming-only', 'shared']);
    expect(blob.analyses.find((a: any) => a.id === 'shared').note).toBe('incoming');
    expect(blob.updatedAt).toBeTruthy();
  });

  it('preserves untouched collections when only one array is posted', async () => {
    h.kvStore.set(DATA_KEY, {
      analyses: [item('a1', '2026-01-01T00:00:00.000Z')],
      savedJobs: [{ id: 'j1', createdAt: '2026-01-01T00:00:00.000Z' }],
      log: [item('l1', '2026-01-01T00:00:00.000Z')],
    });
    const res = makeRes();
    await handler(
      makeReq('POST', {
        code: 'synthetic-code',
        body: { analyses: [item('a2', '2026-01-02T00:00:00.000Z')] },
      }),
      res
    );
    const blob = h.kvStore.get(DATA_KEY) as any;
    expect(blob.analyses.map((a: any) => a.id)).toEqual(['a2', 'a1']);
    expect(blob.savedJobs.map((j: any) => j.id)).toEqual(['j1']);
    expect(blob.log.map((l: any) => l.id)).toEqual(['l1']);
  });

  it('sorts by createdAt when timestamp is absent (savedJobs)', async () => {
    const res = makeRes();
    await handler(
      makeReq('POST', {
        code: 'synthetic-code',
        body: {
          savedJobs: [
            { id: 'old-job', createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'new-job', createdAt: '2026-01-09T00:00:00.000Z' },
          ],
        },
      }),
      res
    );
    const blob = h.kvStore.get(DATA_KEY) as any;
    expect(blob.savedJobs.map((j: any) => j.id)).toEqual(['new-job', 'old-job']);
  });

  it('drops items without an id', async () => {
    const res = makeRes();
    await handler(
      makeReq('POST', {
        code: 'synthetic-code',
        body: { log: [item('ok', '2026-01-01T00:00:00.000Z'), { timestamp: '2026-01-02T00:00:00.000Z' }, null] },
      }),
      res
    );
    const blob = h.kvStore.get(DATA_KEY) as any;
    expect(blob.log.map((l: any) => l.id)).toEqual(['ok']);
  });

  it('holds the caps — analyses 100, savedJobs 50, log 200 — keeping the newest', async () => {
    const pad = (n: number) => String(n).padStart(3, '0');
    const mk = (prefix: string, n: number, day: string) =>
      Array.from({ length: n }, (_, i) => item(`${prefix}-${i}`, `2026-02-0${day}T00:00:00.${pad(i)}Z`));

    h.kvStore.set(DATA_KEY, {
      analyses: mk('ex-a', 60, '1'),
      savedJobs: mk('ex-j', 30, '1'),
      log: mk('ex-l', 120, '1'),
    });
    const res = makeRes();
    await handler(
      makeReq('POST', {
        code: 'synthetic-code',
        body: {
          analyses: mk('in-a', 60, '2'),
          savedJobs: mk('in-j', 30, '2'),
          log: mk('in-l', 120, '2'),
        },
      }),
      res
    );

    expect(res.body).toMatchObject({ ok: true, counts: { analyses: 100, savedJobs: 50, log: 200 } });
    const blob = h.kvStore.get(DATA_KEY) as any;
    expect(blob.analyses).toHaveLength(100);
    expect(blob.savedJobs).toHaveLength(50);
    expect(blob.log).toHaveLength(200);
    // Newest (incoming, day 02) all survive the cap
    expect(blob.analyses.filter((a: any) => a.id.startsWith('in-a'))).toHaveLength(60);
    expect(blob.savedJobs.filter((j: any) => j.id.startsWith('in-j'))).toHaveLength(30);
    expect(blob.log.filter((l: any) => l.id.startsWith('in-l'))).toHaveLength(120);
  });

  it('GET returns the merged blob for the same access code', async () => {
    const postRes = makeRes();
    await handler(
      makeReq('POST', {
        code: 'synthetic-code',
        body: { analyses: [item('a1', '2026-01-01T00:00:00.000Z')] },
      }),
      postRes
    );
    const getRes = makeRes();
    await handler(makeReq('GET', { code: 'synthetic-code' }), getRes);
    expect(getRes.statusCode).toBe(200);
    expect((getRes.body as any).analyses.map((a: any) => a.id)).toEqual(['a1']);
  });
});
