// Wave-2 tick protocol: fail-closed auth, preview guard, chunked budget,
// per-code isolation, idempotent daily re-runs, no-LLM rail
// (docs/waves/wave2-contract.md §Tick protocol) + Wave-3B bench pass:
// gated on {benchPass}/new-JD trigger, spend-capped transport, capped
// outcome (docs/waves/wave3-tasks.md §Bench Sourcer).
import { describe, it, expect, vi } from 'vitest';
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
import {
  BenchSpendCapError,
  benchSuggestionId,
  type BenchMatchTransport,
} from '../../src/agents/benchSourcer';
import { createTickHandler, parseTickCodes, type TickDeps, type TickResponse } from './tick';

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
// Bench Sourcer pass (Wave 3B — the ONLY LLM allowed in the tick)
// ------------------------------------------------------------------

/** seededBlob + a benched silver medalist (no deals) and JD content. */
function benchSeededBlob() {
  const blob = seededBlob();
  blob.v3.persons.push({
    id: 'p3',
    v: 6,
    updatedAt: NOW,
    name: 'רות אברהם',
    normalizedName: 'רות אברהם',
    analysisIds: [],
    contactEvents: [],
    bench: { reason: 'מקום שני', since: NOW, silverMedalist: true },
  } as (typeof blob.v3.persons)[number]);
  (blob as Record<string, unknown>).savedJobs = [
    { id: 'j1', title: 'Backend Engineer', rawText: 'Node, Postgres, AWS' },
    { id: 'j2', title: 'Data Engineer', rawText: 'Spark, Airflow' },
  ];
  return blob;
}

/** Grounded match for p3 on every call (citation quotes her name). */
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
              personId: 'p3',
              score: 90,
              whyMatched: 'ניסיון רלוונטי ומדליית כסף בתהליך קודם',
              citations: [{ field: 'name', quote: 'רות אברהם' }],
            },
          ],
        });
      },
    }),
  };
}

function benchHandler(redis: BlobRedis, deps: Partial<TickDeps> = {}) {
  return createTickHandler({
    store: redisBridgeStore(redis),
    env: ENV,
    now: new Date(NOW),
    ...deps,
  });
}

describe('tick bench pass (Wave 3B)', () => {
  it('does NOT run without {benchPass:true} — default tick stays Wave-2: zero LLM', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: benchSeededBlob() });
    const factory = vi.fn();
    const { res, out } = makeRes();
    await benchHandler(redis, { benchTransportFor: factory })(
      makeReq({ body: { codes: ['c1'] } }),
      res,
    );
    expect(out.status).toBe(200);
    expect(factory).not.toHaveBeenCalled();
    expect(out.json?.ran.map((r) => r.agent)).toEqual(['outreach_runner', 'pit_boss']);
    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof benchSeededBlob>;
    expect((blob.v3.agentRuns as TickAgentRun[]).map((r) => r.agent)).not.toContain(
      'bench_sourcer',
    );
  });

  it('benchPass:true files bench_match suggestions + a run through the bridge; card state untouched', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: benchSeededBlob() });
    const { factory, calls } = groundedTransport();
    const { res, out } = makeRes();
    await benchHandler(redis, { benchTransportFor: factory })(
      makeReq({ body: { codes: ['c1'], benchPass: true } }),
      res,
    );

    expect(out.status).toBe(200);
    // Two open mandates (j1 Outreach, j2 Submitted) × one bench person.
    expect(calls).toHaveLength(2);
    const benchEntry = out.json?.ran.find((r) => r.agent === 'bench_sourcer');
    expect(benchEntry).toMatchObject({
      code: 'c1',
      produced: 2,
      cursor: 10,
      outcome: 'ok',
    });

    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof benchSeededBlob>;
    const suggestions = blob.v3.suggestions as Suggestion[];
    const benchMatches = suggestions.filter((s) => s.kind === 'bench_match');
    expect(benchMatches.map((s) => s.id).sort()).toEqual([
      benchSuggestionId('p3', 'j1'),
      benchSuggestionId('p3', 'j2'),
    ]);
    for (const s of benchMatches) {
      expect(s.agent).toBe('bench_sourcer');
      expect(s.status).toBe('pending');
      expect(s.personId).toBe('p3');
      expect(s.dealId).toBeUndefined(); // NEVER creates/targets deals
      // "why matched" evidence citing person fields + the open mandate.
      expect(s.evidence.some((e) => e.sourceType === 'person' && e.claim.includes('רות אברהם'))).toBe(true);
      expect(s.evidence.some((e) => e.sourceType === 'job')).toBe(true);
    }

    const runs = blob.v3.agentRuns as TickAgentRun[];
    const benchRun = runs.find((r) => r.agent === 'bench_sourcer');
    expect(benchRun).toMatchObject({
      trigger: 'cron',
      outcome: 'ok',
      itemsProcessed: 2,
      suggestionsCreated: 2,
      cursor: 10,
      volume: 5,
    });

    // Single writer: card state byte-identical.
    const before = benchSeededBlob();
    expect(blob.v3.persons).toEqual(before.v3.persons);
    expect(blob.v3.deals).toEqual(before.v3.deals);
    expect(blob.v3.events).toEqual(before.v3.events);
  });

  it('spend cap: transport throwing BenchSpendCapError ⇒ AgentRun outcome "capped", tick still 200', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: benchSeededBlob() });
    const capped: BenchMatchTransport = {
      async complete() {
        throw new BenchSpendCapError('Daily Claude spend cap reached (200/200)');
      },
    };
    const { res, out } = makeRes();
    await benchHandler(redis, { benchTransportFor: () => capped })(
      makeReq({ body: { codes: ['c1'], benchPass: true } }),
      res,
    );

    expect(out.status).toBe(200);
    expect(out.json?.ok).toBe(true);
    const benchEntry = out.json?.ran.find((r) => r.agent === 'bench_sourcer');
    expect(benchEntry).toMatchObject({ produced: 0, outcome: 'capped' });
    expect(benchEntry?.error).toMatch(/cap/);

    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof benchSeededBlob>;
    const benchRun = (blob.v3.agentRuns as TickAgentRun[]).find(
      (r) => r.agent === 'bench_sourcer',
    );
    expect(benchRun?.outcome).toBe('capped');
    expect(benchRun?.suggestionsCreated).toBe(0);
    // Deterministic passes were not harmed by the capped bench pass.
    expect(out.json?.ran.find((r) => r.agent === 'outreach_runner')?.produced).toBe(1);
  });

  it('newJdJobIds triggers the pass without benchPass and records trigger "event"', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: benchSeededBlob() });
    const { factory, calls } = groundedTransport();
    const { res, out } = makeRes();
    await benchHandler(redis, { benchTransportFor: factory })(
      makeReq({ body: { codes: ['c1'], newJdJobIds: ['j1'] } }),
      res,
    );
    expect(out.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof benchSeededBlob>;
    const benchRun = (blob.v3.agentRuns as TickAgentRun[]).find(
      (r) => r.agent === 'bench_sourcer',
    );
    expect(benchRun?.trigger).toBe('event');
  });

  it('re-running benchPass is idempotent: existing pair suggestions are planned away, not re-filed', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: benchSeededBlob() });
    const { factory } = groundedTransport();
    const handler = benchHandler(redis, { benchTransportFor: factory });
    await handler(makeReq({ body: { codes: ['c1'], benchPass: true } }), makeRes().res);
    const { res, out } = makeRes();
    await handler(makeReq({ body: { codes: ['c1'], benchPass: true } }), res);

    const benchEntry = out.json?.ran.find((r) => r.agent === 'bench_sourcer');
    expect(benchEntry?.produced).toBe(0);
    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof benchSeededBlob>;
    const benchMatches = (blob.v3.suggestions as Suggestion[]).filter(
      (s) => s.kind === 'bench_match',
    );
    expect(benchMatches).toHaveLength(2); // unchanged
  });

  it('validates the new body fields: benchPass boolean, newJdJobIds string array', async () => {
    const bad1 = makeRes();
    await benchHandler(mockRedis().redis)(
      makeReq({ body: { benchPass: 'yes' } }),
      bad1.res,
    );
    expect(bad1.out.status).toBe(400);

    const bad2 = makeRes();
    await benchHandler(mockRedis().redis)(
      makeReq({ body: { newJdJobIds: ['ok', ''] } }),
      bad2.res,
    );
    expect(bad2.out.status).toBe(400);
  });
});

// ------------------------------------------------------------------
// LLM / spend rail (wave2-tasks §agents-engine 5, amended by the
// wave3 contract: the Bench Sourcer is the ONLY LLM allowed in the
// tick, and it may reach it ONLY through the spend-capped transport)
// ------------------------------------------------------------------

describe('tick spend rail', () => {
  it('tick.ts itself never touches the spend guard or any LLM client', () => {
    const source = readFileSync(new URL('./tick.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/_lib\/spend/);
    expect(source).not.toMatch(/checkAndCount/);
    expect(source).not.toMatch(/anthropic/i);
    expect(source).not.toMatch(/fetch\(/);
  });

  it('the deterministic pass modules (sla, pitboss) remain LLM-free', () => {
    for (const mod of ['../../src/agents/sla.ts', '../../src/agents/pitboss.ts']) {
      const source = readFileSync(new URL(mod, import.meta.url), 'utf8');
      expect(source).not.toMatch(/fetch\(/);
      expect(source).not.toMatch(/anthropic/i);
    }
  });

  it('the bench transport is spend-capped by construction (imports the guard)', () => {
    const source = readFileSync(
      new URL('../_lib/benchTransport.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/from '\.\/spend'/);
    expect(source).toMatch(/checkAndCount/);
    expect(source).toMatch(/BenchSpendCapError/);
  });
});
