// Wave-2 tick protocol: fail-closed auth, preview guard, chunked budget,
// per-code isolation, idempotent daily re-runs, no-LLM rail
// (docs/waves/wave2-contract.md §Tick protocol).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  agentDataKey,
  redisBridgeStore,
  type AgentStore,
  type BlobRedis,
  type TickAgentRun,
} from '../_lib/agentStore';
import type { Suggestion } from '../../src/types/pipeline';
import { createTickHandler, parseTickCodes, type TickResponse } from './tick';

const NOW = '2026-07-31T12:00:00.000Z';
const SECRET = 'tick-secret';
const ENV = { CRON_SECRET: SECRET };

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeReq(overrides: Record<string, unknown> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: { 'x-cron-secret': SECRET },
    body: {},
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

/** In-memory blob Redis (deep-cloned values, like the agentStore tests). */
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

/** One code's blob: an Outreach deal 5d silent + a Submitted deal 10d
 *  without client feedback — one SLA breach, two Pit Boss items. */
function seededBlob() {
  return {
    analyses: [{ id: 'legacy-1' }],
    savedJobs: [],
    log: [],
    v3: {
      schemaVersion: 1,
      vCounter: 10,
      persons: [
        {
          id: 'p1',
          v: 1,
          updatedAt: NOW,
          name: 'דנה כהן',
          normalizedName: 'דנה כהן',
          analysisIds: [],
          contactEvents: [{ kind: 'contacted', ts: daysAgo(5), channel: 'whatsapp' }],
        },
        {
          id: 'p2',
          v: 2,
          updatedAt: NOW,
          name: 'יוסי לוי',
          normalizedName: 'יוסי לוי',
          analysisIds: [],
          contactEvents: [],
        },
      ],
      deals: [
        {
          id: 'd-out',
          v: 3,
          updatedAt: NOW,
          personId: 'p1',
          jobId: 'j1',
          jobTitle: 'Backend Engineer',
          stage: 'Outreach',
          stageEnteredAt: daysAgo(5),
          createdAt: daysAgo(10),
        },
        {
          id: 'd-sub',
          v: 4,
          updatedAt: NOW,
          personId: 'p2',
          jobId: 'j2',
          jobTitle: 'Data Engineer',
          stage: 'Submitted',
          stageEnteredAt: daysAgo(10),
          createdAt: daysAgo(20),
        },
      ],
      events: [],
      suggestions: [],
      agentRuns: [],
    },
  };
}

function handlerWith(redis: BlobRedis, env: Record<string, string | undefined> = ENV) {
  return createTickHandler({
    store: redisBridgeStore(redis),
    env,
    now: new Date(NOW),
  });
}

// ------------------------------------------------------------------
// Protocol guards
// ------------------------------------------------------------------

describe('tick protocol guards', () => {
  it('is POST only', async () => {
    const { res, out } = makeRes();
    await handlerWith(mockRedis().redis)(makeReq({ method: 'GET' }), res);
    expect(out.status).toBe(405);
  });

  it('fails CLOSED (503) when CRON_SECRET is unconfigured', async () => {
    const { res, out } = makeRes();
    await handlerWith(mockRedis().redis, {})(makeReq(), res);
    expect(out.status).toBe(503);
  });

  it('rejects a wrong secret with 401 (Bearer and x-cron-secret both accepted)', async () => {
    const { res, out } = makeRes();
    await handlerWith(mockRedis().redis)(
      makeReq({ headers: { 'x-cron-secret': 'wrong' } }),
      res,
    );
    expect(out.status).toBe(401);

    const ok = makeRes();
    await handlerWith(mockRedis().redis)(
      makeReq({ headers: { authorization: `Bearer ${SECRET}` } }),
      ok.res,
    );
    expect(ok.out.status).toBe(200);
  });

  it('preview guard: 503 without PREVIEW_DATA_OK, runs with it', async () => {
    const preview = { ...ENV, VERCEL_ENV: 'preview' };
    const { res, out } = makeRes();
    await handlerWith(mockRedis().redis, preview)(makeReq(), res);
    expect(out.status).toBe(503);

    const allowed = makeRes();
    await handlerWith(mockRedis().redis, { ...preview, PREVIEW_DATA_OK: '1' })(
      makeReq(),
      allowed.res,
    );
    expect(allowed.out.status).toBe(200);
  });

  it('rejects malformed codes with 400; empty config is an honest no-op', async () => {
    const bad = makeRes();
    await handlerWith(mockRedis().redis)(makeReq({ body: { codes: ['ok', ''] } }), bad.res);
    expect(bad.out.status).toBe(400);

    const none = makeRes();
    await handlerWith(mockRedis().redis)(makeReq(), none.res);
    expect(none.out.status).toBe(200);
    expect(none.out.json?.ran).toEqual([]);
    expect(none.out.json?.partial).toBe(false);
    expect(none.out.json?.note).toMatch(/TICK_CODES/);
  });

  it('parseTickCodes: csv, trimmed, empties dropped', () => {
    expect(parseTickCodes('c1, c2 ,,c3')).toEqual(['c1', 'c2', 'c3']);
    expect(parseTickCodes(undefined)).toEqual([]);
    expect(parseTickCodes('')).toEqual([]);
  });
});

// ------------------------------------------------------------------
// The full pass
// ------------------------------------------------------------------

describe('tick agent passes', () => {
  it('writes SLA + Pit Boss suggestions and agent runs through the bridge', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: seededBlob() });
    const { res, out } = makeRes();
    await handlerWith(redis)(makeReq({ body: { codes: ['c1'] } }), res);

    expect(out.status).toBe(200);
    expect(out.json?.ok).toBe(true);
    expect(out.json?.partial).toBe(false);
    expect(out.json?.ran).toEqual([
      { code: 'c1', agent: 'outreach_runner', produced: 1, cursor: 10 },
      { code: 'c1', agent: 'pit_boss', produced: 2, cursor: 10 },
    ]);

    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof seededBlob>;
    const suggestions = blob.v3.suggestions as Suggestion[];
    const runs = blob.v3.agentRuns as TickAgentRun[];

    expect(suggestions).toHaveLength(3);
    expect(suggestions.every((s) => s.v > 10)).toBe(true); // server-assigned
    expect(suggestions.every((s) => s.status === 'pending')).toBe(true);
    const agents = suggestions.map((s) => s.agent).sort();
    expect(agents).toEqual(['outreach_runner', 'pit_boss', 'pit_boss']);
    // Evidence everywhere; every suggestion cites numeric inputs
    // (contextual claims may ride along, e.g. the deal reference).
    for (const s of suggestions) {
      expect(s.evidence.length).toBeGreaterThan(0);
      expect(s.evidence.some((e) => /\d/.test(e.claim))).toBe(true);
    }
    // Server fees are empty in Wave 2 → NO ₪ may appear anywhere.
    const text = suggestions.map((s) => `${s.title}\n${s.body}`).join('\n');
    expect(text).not.toContain('₪');

    expect(runs).toHaveLength(2);
    for (const r of runs) {
      expect(r.trigger).toBe('cron');
      expect(r.outcome).toBe('ok');
      expect(r.cursor).toBe(10);
    }
    const bySla = runs.find((r) => r.agent === 'outreach_runner');
    const byPb = runs.find((r) => r.agent === 'pit_boss');
    expect(bySla?.itemsProcessed).toBe(1); // one deal in SLA stages
    expect(bySla?.suggestionsCreated).toBe(1);
    expect(byPb?.itemsProcessed).toBe(2); // both pipeline-stage deals
    expect(byPb?.suggestionsCreated).toBe(2);

    // Single writer: card state byte-identical.
    const before = seededBlob();
    expect(blob.v3.persons).toEqual(before.v3.persons);
    expect(blob.v3.deals).toEqual(before.v3.deals);
    expect(blob.v3.events).toEqual(before.v3.events);
    expect(blob.analyses).toEqual(before.analyses);
  });

  it('daily re-run is idempotent: same episodes produce nothing new', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: seededBlob() });
    const handler = handlerWith(redis);
    await handler(makeReq({ body: { codes: ['c1'] } }), makeRes().res);
    const { res, out } = makeRes();
    await handler(makeReq({ body: { codes: ['c1'] } }), res);

    expect(out.json?.ran).toEqual([
      { code: 'c1', agent: 'outreach_runner', produced: 0, cursor: 15 },
      { code: 'c1', agent: 'pit_boss', produced: 0, cursor: 15 },
    ]);
    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof seededBlob>;
    expect(blob.v3.suggestions).toHaveLength(3); // unchanged
    expect(blob.v3.agentRuns).toHaveLength(4); // runs still logged
  });

  it('stops before budgetMs and reports partial for chunked continuation', async () => {
    const { redis } = mockRedis({
      [agentDataKey('c1')]: seededBlob(),
      [agentDataKey('c2')]: seededBlob(),
    });
    const bridge = redisBridgeStore(redis);
    const slow: AgentStore = {
      async load(code) {
        await new Promise((r) => setTimeout(r, 20));
        return bridge.load(code);
      },
      write: (code, output) => bridge.write(code, output),
    };
    const handler = createTickHandler({ store: slow, env: ENV, now: new Date(NOW) });
    const { res, out } = makeRes();
    await handler(makeReq({ body: { codes: ['c1', 'c2'], budgetMs: 1 } }), res);

    expect(out.json?.partial).toBe(true);
    expect(out.json?.ran.every((r) => r.code === 'c1')).toBe(true);
    expect(out.json?.ran).toHaveLength(2); // first code always makes progress
  });

  it('isolates per-code failures: one broken blob cannot sink the fan-out', async () => {
    const { redis } = mockRedis({ [agentDataKey('good')]: seededBlob() });
    const bridge = redisBridgeStore(redis);
    const flaky: AgentStore = {
      async load(code) {
        if (code === 'bad') throw new Error('boom');
        return bridge.load(code);
      },
      write: (code, output) => bridge.write(code, output),
    };
    const handler = createTickHandler({ store: flaky, env: ENV, now: new Date(NOW) });
    const { res, out } = makeRes();
    await handler(makeReq({ body: { codes: ['bad', 'good'] } }), res);

    expect(out.json?.ok).toBe(true);
    expect(out.json?.ran[0]).toMatchObject({ code: 'bad', agent: 'tick', error: 'boom' });
    expect(out.json?.ran.filter((r) => r.code === 'good')).toHaveLength(2);
  });

  it('reads default codes from env TICK_CODES', async () => {
    const { redis } = mockRedis({ [agentDataKey('c9')]: seededBlob() });
    const handler = handlerWith(redis, { ...ENV, TICK_CODES: ' c9 ' });
    const { res, out } = makeRes();
    await handler(makeReq(), res);
    expect(out.json?.ran.map((r) => r.code)).toEqual(['c9', 'c9']);
  });
});

// ------------------------------------------------------------------
// No-LLM / spend rail (wave2-tasks §agents-engine 5)
// ------------------------------------------------------------------

describe('tick spend rail', () => {
  it('the tick never imports the spend guard or any LLM client (deterministic cron)', () => {
    const source = readFileSync(new URL('./tick.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/_lib\/spend/);
    expect(source).not.toMatch(/checkAndCount/);
    expect(source).not.toMatch(/anthropic/i);
    expect(source).not.toMatch(/fetch\(/);
  });
});
