// Wave-2 AgentStore bridge: single-writer rail, server-assigned versions,
// LWW staleness, ≤200-run rotation, blob cap, Supabase-shaped adapter
// (docs/waves/wave2-contract.md §Agent-side store bridge).
import { describe, it, expect } from 'vitest';
import type { Suggestion } from '../../src/types/pipeline';
import {
  AGENT_RUNS_MAX,
  BLOB_HARD_CAP_BYTES,
  agentDataKey,
  lastCursorForAgent,
  mockSupabaseAgentStore,
  redisBridgeStore,
  rotateAgentRuns,
  type BlobRedis,
  type TickAgentRun,
} from './agentStore';

const NOW = '2026-07-31T12:00:00.000Z';

/** In-memory blob Redis — values deep-cloned to simulate serialization. */
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

function makeSuggestion(id: string, v = 0, overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    v,
    updatedAt: NOW,
    agent: 'pit_boss',
    kind: 'next_action',
    dealId: 'd1',
    title: 't',
    body: 'b',
    evidence: [{ claim: '8 ימים בשלב Submitted', sourceType: 'deal', sourceId: 'd1' }],
    status: 'pending',
    createdAt: NOW,
    ...overrides,
  };
}

function makeRun(id: string, v = 0, overrides: Partial<TickAgentRun> = {}): TickAgentRun {
  return {
    id,
    v,
    updatedAt: NOW,
    agent: 'pit_boss',
    trigger: 'cron',
    startedAt: NOW,
    finishedAt: NOW,
    itemsProcessed: 3,
    suggestionsCreated: 1,
    outcome: 'ok',
    cursor: 7,
    ...overrides,
  };
}

function seededBlob() {
  return {
    analyses: [{ id: 'legacy-1', timestamp: NOW }],
    savedJobs: [{ id: 'job-1' }],
    log: [{ id: 'log-1' }],
    updatedAt: NOW,
    v3: {
      schemaVersion: 1,
      vCounter: 10,
      persons: [{ id: 'p1', v: 3, updatedAt: NOW, name: 'דנה', normalizedName: 'דנה', analysisIds: [], contactEvents: [] }],
      deals: [{ id: 'd1', v: 4, updatedAt: NOW, personId: 'p1', jobId: 'j1', jobTitle: 'BE', stage: 'Submitted', stageEnteredAt: NOW, createdAt: NOW }],
      events: [{ id: 'e1', v: 5, updatedAt: NOW, dealId: 'd1', from: null, to: 'Sourced', ts: NOW, actor: 'human', skippedStages: [] }],
      suggestions: [makeSuggestion('s-existing', 6, { status: 'dismissed' })],
      agentRuns: [makeRun('run-old', 7, { cursor: 5 })],
    },
  };
}

// ------------------------------------------------------------------
// redisBridgeStore
// ------------------------------------------------------------------

describe('redisBridgeStore.load', () => {
  it('returns an empty view for a missing blob', async () => {
    const { redis } = mockRedis();
    const view = await redisBridgeStore(redis).load('c1');
    expect(view).toEqual({
      schemaVersion: 1,
      vCounter: 0,
      persons: [],
      deals: [],
      events: [],
      suggestions: [],
      agentRuns: [],
    });
  });

  it('reads the v3 section of revital:data:{code}', async () => {
    const { redis } = mockRedis({ [agentDataKey('c1')]: seededBlob() });
    const view = await redisBridgeStore(redis).load('c1');
    expect(view.vCounter).toBe(10);
    expect(view.deals).toHaveLength(1);
    expect(view.suggestions[0].id).toBe('s-existing');
    expect(view.agentRuns[0].cursor).toBe(5);
  });

  it('fails CLOSED when Redis is unconfigured (write path, not spend-style fail-open)', async () => {
    await expect(redisBridgeStore(null).load('c1')).rejects.toThrow(/Redis unconfigured/);
  });
});

describe('redisBridgeStore.write', () => {
  it('assigns server versions from the blob vCounter (same semantics as api/data v3)', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: seededBlob() });
    const bridge = redisBridgeStore(redis);
    const result = await bridge.write('c1', {
      suggestions: [makeSuggestion('s-new-1'), makeSuggestion('s-new-2')],
      agentRuns: [makeRun('run-new')],
    });
    expect(result.suggestionsAccepted).toEqual(['s-new-1', 's-new-2']);
    expect(result.runsAccepted).toEqual(['run-new']);
    expect(result.vCounter).toBe(13); // 10 + 3 accepted writes

    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof seededBlob>;
    const s1 = blob.v3.suggestions.find((s: Suggestion) => s.id === 's-new-1');
    const s2 = blob.v3.suggestions.find((s: Suggestion) => s.id === 's-new-2');
    const run = blob.v3.agentRuns.find((r: TickAgentRun) => r.id === 'run-new');
    expect(s1?.v).toBe(11);
    expect(s2?.v).toBe(12);
    expect(run?.v).toBe(13);
    expect(blob.v3.vCounter).toBe(13);
  });

  it('NEVER touches persons/deals/events or the legacy sections (single writer)', async () => {
    const before = seededBlob();
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: before });
    const bridge = redisBridgeStore(redis);
    // Even a hostile payload smuggling card-state keys cannot reach them.
    await bridge.write('c1', {
      suggestions: [makeSuggestion('s-new')],
      agentRuns: [makeRun('run-new')],
      persons: [{ id: 'evil', v: 999 }],
      deals: [{ id: 'evil', v: 999 }],
      events: [{ id: 'evil', v: 999 }],
    } as never);

    const after = store.get(agentDataKey('c1')) as ReturnType<typeof seededBlob>;
    expect(after.v3.persons).toEqual(before.v3.persons);
    expect(after.v3.deals).toEqual(before.v3.deals);
    expect(after.v3.events).toEqual(before.v3.events);
    expect(after.analyses).toEqual(before.analyses);
    expect(after.savedJobs).toEqual(before.savedJobs);
    expect(after.log).toEqual(before.log);
  });

  it('drops deterministic-id re-emissions as stale — dismissals stay final', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: seededBlob() });
    const bridge = redisBridgeStore(redis);
    // s-existing sits in the blob with v=6, status dismissed. A tick
    // re-emitting the same episode id with v=0 must be dropped.
    const result = await bridge.write('c1', {
      suggestions: [makeSuggestion('s-existing', 0, { status: 'pending' })],
      agentRuns: [],
    });
    expect(result.suggestionsAccepted).toEqual([]);
    expect(result.suggestionsDropped).toEqual(['s-existing']);

    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof seededBlob>;
    const kept = blob.v3.suggestions.find((s: Suggestion) => s.id === 's-existing');
    expect(kept?.status).toBe('dismissed');
    expect(kept?.v).toBe(6);
  });

  it(`rotates agentRuns to the newest ${AGENT_RUNS_MAX} by server version`, async () => {
    const blob = seededBlob();
    blob.v3.agentRuns = Array.from({ length: AGENT_RUNS_MAX }, (_, i) =>
      makeRun(`run-${i + 1}`, i + 1),
    );
    blob.v3.vCounter = AGENT_RUNS_MAX;
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: blob });
    const bridge = redisBridgeStore(redis);

    const result = await bridge.write('c1', {
      suggestions: [],
      agentRuns: [makeRun('run-a'), makeRun('run-b'), makeRun('run-c')],
    });
    expect(result.runsRotatedOut).toBe(3);

    const after = store.get(agentDataKey('c1')) as ReturnType<typeof seededBlob>;
    expect(after.v3.agentRuns).toHaveLength(AGENT_RUNS_MAX);
    const ids = after.v3.agentRuns.map((r: TickAgentRun) => r.id);
    expect(ids).toContain('run-a');
    expect(ids).toContain('run-c');
    // The three oldest (v 1..3) rotated out.
    expect(ids).not.toContain('run-1');
    expect(ids).not.toContain('run-3');
    expect(ids).toContain('run-4');
  });

  it('refuses a write that would push the blob past the 1.5MB hard cap', async () => {
    const { redis, store } = mockRedis({ [agentDataKey('c1')]: seededBlob() });
    const bridge = redisBridgeStore(redis);
    const huge = makeSuggestion('s-huge', 0, { body: 'x'.repeat(BLOB_HARD_CAP_BYTES) });
    await expect(
      bridge.write('c1', { suggestions: [huge], agentRuns: [] }),
    ).rejects.toThrow(/hard cap/);
    // Blob untouched by the refused write.
    const blob = store.get(agentDataKey('c1')) as ReturnType<typeof seededBlob>;
    expect(blob.v3.vCounter).toBe(10);
    expect(blob.v3.suggestions).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

describe('rotateAgentRuns / lastCursorForAgent', () => {
  it('keeps everything under the cap, ascending by v', () => {
    const runs = [makeRun('b', 2), makeRun('a', 1)];
    const { kept, rotatedOut } = rotateAgentRuns(runs);
    expect(rotatedOut).toBe(0);
    expect(kept.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest beyond the cap', () => {
    const runs = Array.from({ length: 5 }, (_, i) => makeRun(`r${i + 1}`, i + 1));
    const { kept, rotatedOut } = rotateAgentRuns(runs, 3);
    expect(rotatedOut).toBe(2);
    expect(kept.map((r) => r.id)).toEqual(['r3', 'r4', 'r5']);
  });

  it('lastCursorForAgent: max cursor for that agent, ignoring tombstones', () => {
    const runs = [
      makeRun('r1', 1, { agent: 'pit_boss', cursor: 5 }),
      makeRun('r2', 2, { agent: 'pit_boss', cursor: 9 }),
      makeRun('r3', 3, { agent: 'pit_boss', cursor: 99, deleted: true }),
      makeRun('r4', 4, { agent: 'outreach_runner', cursor: 50 }),
      makeRun('r5', 5, { agent: 'pit_boss' }), // pre-cursor record
    ];
    expect(lastCursorForAgent(runs, 'pit_boss')).toBe(9);
    expect(lastCursorForAgent(runs, 'outreach_runner')).toBe(50);
    expect(lastCursorForAgent(runs, 'screener')).toBe(0);
  });
});

// ------------------------------------------------------------------
// Supabase-shaped adapter (mock now, real client post-G3)
// ------------------------------------------------------------------

describe('mockSupabaseAgentStore', () => {
  it('round-trips suggestions/agent_runs through schema-shaped rows', async () => {
    const { store, client } = mockSupabaseAgentStore();
    const result = await store.write('c1', {
      suggestions: [makeSuggestion('s1')],
      agentRuns: [makeRun('r1')],
    });
    expect(result.suggestionsAccepted).toEqual(['s1']);
    expect(result.vCounter).toBe(2);

    const rows = await client.selectAll('suggestions');
    expect(rows).toHaveLength(1);
    expect(rows[0].access_code).toBe('c1');
    expect(rows[0].agent).toBe('pit_boss');

    const view = await store.load('c1');
    expect(view.suggestions[0].id).toBe('s1');
    expect(view.suggestions[0].v).toBe(1);
    expect(view.agentRuns[0].v).toBe(2);
    expect(view.vCounter).toBe(2);
    // Card state never lives agent-side.
    expect(view.persons).toEqual([]);
    expect(view.deals).toEqual([]);
  });

  it('applies the same LWW staleness rule as the redis bridge', async () => {
    const { store } = mockSupabaseAgentStore();
    await store.write('c1', { suggestions: [makeSuggestion('s1')], agentRuns: [] });
    const second = await store.write('c1', {
      suggestions: [makeSuggestion('s1', 0, { status: 'pending', body: 'changed' })],
      agentRuns: [],
    });
    expect(second.suggestionsAccepted).toEqual([]);
    expect(second.suggestionsDropped).toEqual(['s1']);
    const view = await store.load('c1');
    expect(view.suggestions[0].body).toBe('b');
  });

  it('isolates access codes', async () => {
    const { store } = mockSupabaseAgentStore();
    await store.write('c1', { suggestions: [makeSuggestion('s1')], agentRuns: [] });
    await store.write('c2', { suggestions: [makeSuggestion('s2')], agentRuns: [] });
    const v1 = await store.load('c1');
    const v2 = await store.load('c2');
    expect(v1.suggestions.map((s) => s.id)).toEqual(['s1']);
    expect(v2.suggestions.map((s) => s.id)).toEqual(['s2']);
  });
});
