// Wave-3B GET cron wrapper: method gate, auth PARITY with the tick
// (fail-closed CRON_SECRET + preview guard, same statuses), TICK_CODES +
// benchPass:true invocation, defensive budget query parsing
// (docs/waves/wave3-tasks.md §Cron wrapper).
import { describe, it, expect, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  agentDataKey,
  redisBridgeStore,
  type BlobRedis,
  type TickAgentRun,
} from '../_lib/agentStore';
import type { Suggestion } from '../../src/types/pipeline';
import type { BenchMatchTransport } from '../../src/agents/benchSourcer';
import { createTickHandler, TICK_DEFAULT_BUDGET_MS, type TickResponse } from './tick';
import { createCronHandler, parseCronBudgetMs } from './cron';

const NOW = '2026-07-31T12:00:00.000Z';
const SECRET = 'cron-secret';
const ENV = { CRON_SECRET: SECRET, TICK_CODES: 'c1' };

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeReq(overrides: Record<string, unknown> = {}): VercelRequest {
  return {
    method: 'GET',
    headers: { 'x-cron-secret': SECRET },
    query: {},
    ...overrides,
  } as unknown as VercelRequest;
}

function makeRes() {
  const out: { status?: number; json?: TickResponse & { error?: string } } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: never) {
      out.json = payload;
      return res;
    },
  };
  return { res: res as unknown as VercelResponse, out };
}

function mockRedis(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const redis: BlobRedis = {
    async get(key) {
      const v = store.get(key);
      return v === undefined ? null : JSON.parse(JSON.stringify(v));
    },
    async set(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
      return 'OK';
    },
  };
  return { redis, store };
}

/** Bench-ready blob: an open mandate + a benched person with JD text. */
function benchBlob() {
  return {
    analyses: [],
    savedJobs: [{ id: 'j1', title: 'Backend Engineer', rawText: 'Node' }],
    log: [],
    v3: {
      schemaVersion: 1,
      vCounter: 4,
      persons: [
        {
          id: 'p-bench',
          v: 2,
          updatedAt: NOW,
          name: 'רות אברהם',
          normalizedName: 'רות אברהם',
          analysisIds: [],
          contactEvents: [],
          bench: { reason: 'מקום שני', since: NOW },
        },
      ],
      deals: [
        {
          id: 'd1',
          v: 3,
          updatedAt: NOW,
          personId: 'p-other',
          jobId: 'j1',
          jobTitle: 'Backend Engineer',
          stage: 'Outreach',
          stageEnteredAt: daysAgo(1),
          createdAt: daysAgo(2),
        },
      ],
      events: [],
      suggestions: [],
      agentRuns: [],
    },
  };
}

function groundedTransport(): { factory: (code: string) => BenchMatchTransport; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    factory: () => ({
      async complete(prompt) {
        calls.push(prompt);
        return JSON.stringify({
          matches: [
            {
              personId: 'p-bench',
              score: 88,
              whyMatched: 'רקע מתאים למשרה',
              citations: [{ field: 'name', quote: 'רות אברהם' }],
            },
          ],
        });
      },
    }),
  };
}

function cronWith(redis: BlobRedis, env: Record<string, string | undefined> = ENV, extra: Record<string, unknown> = {}) {
  return createCronHandler({
    store: redisBridgeStore(redis),
    env,
    now: new Date(NOW),
    ...extra,
  });
}

// ------------------------------------------------------------------
// Method + guards
// ------------------------------------------------------------------

describe('cron wrapper guards', () => {
  it('is GET only (the tick stays POST only — complementary methods)', async () => {
    const { res, out } = makeRes();
    await cronWith(mockRedis().redis)(makeReq({ method: 'POST' }), res);
    expect(out.status).toBe(405);
  });

  it('AUTH PARITY: cron and tick answer identically across the auth matrix', async () => {
    const scenarios: Array<{
      env: Record<string, string | undefined>;
      headers: Record<string, string>;
      expected: number;
    }> = [
      // fail CLOSED: no CRON_SECRET configured
      { env: { TICK_CODES: 'c1' }, headers: { 'x-cron-secret': SECRET }, expected: 503 },
      // wrong secret
      { env: ENV, headers: { 'x-cron-secret': 'wrong' }, expected: 401 },
      // missing header entirely
      { env: ENV, headers: {}, expected: 401 },
      // x-cron-secret accepted
      { env: ENV, headers: { 'x-cron-secret': SECRET }, expected: 200 },
      // Vercel cron convention: Authorization Bearer accepted
      { env: ENV, headers: { authorization: `Bearer ${SECRET}` }, expected: 200 },
      // preview guard blocks both
      {
        env: { ...ENV, VERCEL_ENV: 'preview' },
        headers: { 'x-cron-secret': SECRET },
        expected: 503,
      },
      // ... and PREVIEW_DATA_OK unblocks both
      {
        env: { ...ENV, VERCEL_ENV: 'preview', PREVIEW_DATA_OK: '1' },
        headers: { 'x-cron-secret': SECRET },
        expected: 200,
      },
    ];

    for (const s of scenarios) {
      const { factory } = groundedTransport();
      const { redis } = mockRedis({ [agentDataKey('c1')]: benchBlob() });
      const deps = {
        store: redisBridgeStore(redis),
        env: s.env,
        now: new Date(NOW),
        benchTransportFor: factory,
      };

      const cron = makeRes();
      await createCronHandler(deps)(
        makeReq({ method: 'GET', headers: s.headers }),
        cron.res,
      );
      const tick = makeRes();
      await createTickHandler(deps)(
        makeReq({ method: 'POST', headers: s.headers, body: { benchPass: true } }),
        tick.res,
      );

      expect(cron.out.status, JSON.stringify(s.headers) + JSON.stringify(s.env)).toBe(s.expected);
      expect(tick.out.status, 'tick parity for ' + JSON.stringify(s)).toBe(s.expected);
    }
  });
});

// ------------------------------------------------------------------
// Invocation semantics
// ------------------------------------------------------------------

describe('cron wrapper invocation', () => {
  it('runs the tick logic for TICK_CODES with benchPass:true (nightly semantics)', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: benchBlob() });
    const { factory, calls } = groundedTransport();
    const { res, out } = makeRes();
    await cronWith(redis, ENV, { benchTransportFor: factory })(makeReq(), res);

    expect(out.status).toBe(200);
    expect(out.json?.ok).toBe(true);
    expect(calls).toHaveLength(1); // one open mandate × one bench person
    const agents = out.json?.ran.map((r) => r.agent);
    expect(agents).toEqual(['outreach_runner', 'pit_boss', 'bench_sourcer']);
    expect(out.json?.ran.every((r) => r.code === 'c1')).toBe(true);

    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof benchBlob>;
    const benchMatches = (blob.v3.suggestions as Suggestion[]).filter(
      (s) => s.kind === 'bench_match',
    );
    expect(benchMatches).toHaveLength(1);
    const benchRun = (blob.v3.agentRuns as TickAgentRun[]).find(
      (r) => r.agent === 'bench_sourcer',
    );
    expect(benchRun?.trigger).toBe('cron');
    expect(benchRun?.outcome).toBe('ok');
  });

  it('no TICK_CODES configured → honest 200 no-op with a note', async () => {
    const { res, out } = makeRes();
    const factory = vi.fn();
    await cronWith(mockRedis().redis, { CRON_SECRET: SECRET }, { benchTransportFor: factory })(
      makeReq(),
      res,
    );
    expect(out.status).toBe(200);
    expect(out.json?.ran).toEqual([]);
    expect(out.json?.note).toMatch(/TICK_CODES/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('never reads codes or jobIds from the request — only budgetMs, defensively', () => {
    expect(parseCronBudgetMs(undefined)).toBe(TICK_DEFAULT_BUDGET_MS);
    expect(parseCronBudgetMs('')).toBe(TICK_DEFAULT_BUDGET_MS);
    expect(parseCronBudgetMs('abc')).toBe(TICK_DEFAULT_BUDGET_MS);
    expect(parseCronBudgetMs('-5')).toBe(TICK_DEFAULT_BUDGET_MS);
    expect(parseCronBudgetMs('12000')).toBe(12000);
    expect(parseCronBudgetMs(['3000', '9'])).toBe(3000); // repeated param → first
  });
});
