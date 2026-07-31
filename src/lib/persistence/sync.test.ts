// Wave-1 client sync: v3 section of /api/data, mock-fetch (no network, G2-safe)
import { describe, it, expect, beforeEach, vi } from 'vitest';

class MemStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}
(globalThis as { localStorage?: Storage }).localStorage = new MemStorage();

const { usePipelineStore } = await import('../../store/pipelineStore');
const { pullV3, pushV3, syncV3OnLoad, API_DATA_PATH } = await import('./sync');
const { setV3Enabled } = await import('./keys');

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(status: number, body: unknown): FetchMock {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as FetchMock;
}

function reset() {
  localStorage.clear();
  usePipelineStore.setState({
    v3Enabled: false,
    persons: [],
    deals: [],
    stageEvents: [],
    suggestions: [],
    auditLog: [],
    undoStack: [],
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
}

function flagOn() {
  setV3Enabled(true);
  usePipelineStore.setState({ v3Enabled: true });
}

function seedDirtyDeal() {
  const { person } = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
  return usePipelineStore
    .getState()
    .addDeal({ personId: person.id, jobId: 'j1', jobTitle: 'Backend' });
}

beforeEach(reset);

describe('flag gating (flag-off = store never touched, no network)', () => {
  it('pullV3 and pushV3 are no-ops with the flag off', async () => {
    const fetchFn = mockFetch(200, {});
    expect(await pullV3('code', fetchFn as never)).toEqual({ ok: false, skipped: 'flag_off' });
    expect(await pushV3('code', fetchFn as never)).toEqual({ ok: false, skipped: 'flag_off' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('pushV3', () => {
  it('skips cleanly when nothing is dirty', async () => {
    flagOn();
    const fetchFn = mockFetch(200, {});
    expect(await pushV3('code', fetchFn as never)).toEqual({ ok: true, skipped: 'nothing_dirty' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs only dirty records with the v3 opt-in headers', async () => {
    flagOn();
    seedDirtyDeal();
    const fetchFn = mockFetch(200, { ok: true, v3: { accepted: [], staleDropped: [] } });
    await pushV3('secret-code', fetchFn as never);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(API_DATA_PATH);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Revital-V3']).toBe('1');
    expect((init.headers as Record<string, string>)['X-Access-Code']).toBe('secret-code');
    const body = JSON.parse(init.body as string);
    expect(body.v3.schemaVersion).toBe(1);
    expect(body.v3.deals).toHaveLength(1);
    expect(body.v3.persons).toHaveLength(1);
    expect(body.analyses).toBeUndefined(); // legacy section never touched
  });

  it('adopts server-stamped versions and clears dirty ids', async () => {
    flagOn();
    const deal = seedDirtyDeal();
    const stamped = { ...usePipelineStore.getState().deals[0]!, v: 42 };
    const fetchFn = mockFetch(200, {
      ok: true,
      v3: { accepted: [deal.id], staleDropped: [], records: { deals: [stamped] } },
    });
    const result = await pushV3('code', fetchFn as never);
    expect(result.ok).toBe(true);
    expect(result.accepted).toEqual([deal.id]);
    const st = usePipelineStore.getState();
    expect(st.deals[0]!.v).toBe(42);
    expect(st.dirtyIds.deals).toEqual([]);
    expect(st.meta.lastSyncAt).toBeTruthy();
  });

  it('surfaces the 413 hard-cap alert without mutating local state', async () => {
    flagOn();
    seedDirtyDeal();
    const fetchFn = mockFetch(413, { error: 'Data blob exceeds hard cap', alert: 'rotate!' });
    const result = await pushV3('code', fetchFn as never);
    expect(result).toMatchObject({ ok: false, status: 413, alert: 'rotate!' });
    expect(usePipelineStore.getState().dirtyIds.deals).toHaveLength(1); // still dirty
  });

  it('surfaces the preview read-only 503', async () => {
    flagOn();
    seedDirtyDeal();
    const fetchFn = mockFetch(503, { error: 'Preview environment is read-only', readOnly: true });
    const result = await pushV3('code', fetchFn as never);
    expect(result).toMatchObject({ ok: false, status: 503, readOnly: true });
  });

  it('never throws on network failure', async () => {
    flagOn();
    seedDirtyDeal();
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await pushV3('code', fetchFn as never);
    expect(result).toEqual({ ok: false, error: 'offline' });
  });
});

describe('pullV3', () => {
  it('GETs with v3 opt-in and LWW-merges the v3 section into the store', async () => {
    flagOn();
    const deal = seedDirtyDeal();
    const local = usePipelineStore.getState().deals[0]!;
    const fetchFn = mockFetch(200, {
      analyses: [],
      v3: {
        schemaVersion: 1,
        vCounter: 7,
        persons: [],
        deals: [{ ...local, v: 7, jobTitle: 'Server Title' }],
        events: [],
        suggestions: [],
      },
    });
    const result = await pullV3('code', fetchFn as never);
    expect(result.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(API_DATA_PATH);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['X-Revital-V3']).toBe('1');
    const st = usePipelineStore.getState();
    expect(st.deals.find((d) => d.id === deal.id)!.jobTitle).toBe('Server Title');
    expect(st.deals.find((d) => d.id === deal.id)!.v).toBe(7);
  });

  it('keeps local records that are newer or unsynced', async () => {
    flagOn();
    seedDirtyDeal();
    const local = usePipelineStore.getState().deals[0]!;
    // Remote copy at the same v (0) must NOT clobber the local unsynced edit
    const fetchFn = mockFetch(200, {
      v3: { persons: [], deals: [{ ...local, jobTitle: 'Stale Remote' }], events: [], suggestions: [] },
    });
    await pullV3('code', fetchFn as never);
    expect(usePipelineStore.getState().deals[0]!.jobTitle).toBe('Backend');
  });

  it('reports non-OK statuses', async () => {
    flagOn();
    const fetchFn = mockFetch(401, { error: 'Invalid access code' });
    expect(await pullV3('bad', fetchFn as never)).toMatchObject({ ok: false, status: 401 });
  });
});

describe('syncV3OnLoad', () => {
  it('pulls then pushes in order', async () => {
    flagOn();
    seedDirtyDeal();
    const calls: string[] = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? 'GET');
      return {
        ok: true,
        status: 200,
        json: async () =>
          (init?.method ?? 'GET') === 'GET'
            ? { v3: { persons: [], deals: [], events: [], suggestions: [] } }
            : { ok: true, v3: { accepted: [], staleDropped: [] } },
      };
    });
    const { pull, push } = await syncV3OnLoad('code', fetchFn as never);
    expect(pull.ok).toBe(true);
    expect(push.ok).toBe(true);
    expect(calls).toEqual(['GET', 'POST']);
  });
});
