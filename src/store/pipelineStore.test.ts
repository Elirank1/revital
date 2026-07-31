import { describe, it, expect, beforeEach } from 'vitest';
import type { Deal, Suggestion } from '../types/pipeline';

// ---- in-memory localStorage (vitest runs in node env; no jsdom dep) ----
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

// Dynamic import AFTER the stub so module-level hydration sees it.
const { usePipelineStore, computeSkippedStages } = await import('./pipelineStore');
const { V3_KEYS, isV3Enabled } = await import('../lib/persistence/keys');

const makeDeal = (id: string, stage: Deal['stage'] = 'Sourced'): Omit<Deal, 'v' | 'updatedAt'> => ({
  id,
  personId: `person-${id}`,
  jobId: 'job-1',
  jobTitle: 'Backend Engineer',
  stage,
  stageEnteredAt: '2026-07-31T00:00:00.000Z',
  createdAt: '2026-07-31T00:00:00.000Z',
});

const makeSuggestion = (id: string): Omit<Suggestion, 'v' | 'updatedAt' | 'status'> => ({
  id,
  agent: 'pit_boss',
  kind: 'next_action',
  title: 'Follow up',
  body: 'ping the client',
  evidence: [],
  createdAt: '2026-07-31T00:00:00.000Z',
});

beforeEach(() => {
  localStorage.clear();
  usePipelineStore.setState({
    v3Enabled: false,
    persons: [],
    deals: [],
    stageEvents: [],
    suggestions: [],
    auditLog: [],
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
});

describe('feature flag (revital_v3_flag)', () => {
  it('is OFF by default', () => {
    expect(isV3Enabled()).toBe(false);
    expect(usePipelineStore.getState().v3Enabled).toBe(false);
  });

  it('setV3Flag persists and rollback = flag off removes the key', () => {
    usePipelineStore.getState().setV3Flag(true);
    expect(localStorage.getItem(V3_KEYS.flag)).toBe('on');
    usePipelineStore.getState().setV3Flag(false);
    expect(localStorage.getItem(V3_KEYS.flag)).toBeNull();
  });
});

describe('storage isolation', () => {
  it('writes only revital_v3_* keys — never legacy revital_* keys', () => {
    const s = usePipelineStore.getState();
    s.upsertDeal(makeDeal('d1'));
    s.moveDealStage('d1', 'Screened');
    s.addSuggestion(makeSuggestion('s1'));
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)!);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith('revital_v3_')).toBe(true);
  });
});

describe('deals', () => {
  it('creates with v=0 (never synced), persists, audits, marks dirty', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1'));
    const st = usePipelineStore.getState();
    expect(st.deals[0].v).toBe(0);
    expect(JSON.parse(localStorage.getItem(V3_KEYS.deals)!)).toHaveLength(1);
    expect(st.dirtyIds.deals).toContain('d1');
    expect(st.auditLog.at(-1)!.action).toBe('deal.create');
    expect(st.auditLog.at(-1)!.actor).toBe('human');
  });

  it('delete is a tombstone — record stays, flagged deleted, audited', () => {
    const s = usePipelineStore.getState();
    s.upsertDeal(makeDeal('d1'));
    usePipelineStore.getState().deleteDeal('d1');
    const st = usePipelineStore.getState();
    expect(st.deals).toHaveLength(1);
    expect(st.deals[0].deleted).toBe(true);
    expect(st.deals[0].deletedAt).toBeTruthy();
    expect(st.auditLog.at(-1)!.action).toBe('deal.delete');
  });
});

describe('moveDealStage + StageEvents', () => {
  it('logs a skip-event when stages are jumped', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1', 'Sourced'));
    usePipelineStore.getState().moveDealStage('d1', 'Submitted');
    const st = usePipelineStore.getState();
    expect(st.deals[0].stage).toBe('Submitted');
    const ev = st.stageEvents.at(-1)!;
    expect(ev.from).toBe('Sourced');
    expect(ev.to).toBe('Submitted');
    expect(ev.skippedStages).toEqual(['Screened', 'Outreach', 'InConversation']);
  });

  it('adjacent moves carry no skipped stages', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1', 'Sourced'));
    usePipelineStore.getState().moveDealStage('d1', 'Screened');
    expect(usePipelineStore.getState().stageEvents.at(-1)!.skippedStages).toEqual([]);
  });

  it('refuses Rejected without a reason; records rejection with one', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1', 'Outreach'));
    usePipelineStore.getState().moveDealStage('d1', 'Rejected');
    expect(usePipelineStore.getState().deals[0].stage).toBe('Outreach'); // refused

    usePipelineStore.getState().moveDealStage('d1', 'Rejected', { reason: 'salary gap' });
    const st = usePipelineStore.getState();
    expect(st.deals[0].stage).toBe('Rejected');
    expect(st.deals[0].rejection?.reason).toBe('salary gap');
    expect(st.stageEvents.at(-1)!.reason).toBe('salary gap');
  });

  it('agent-actor moves audit as ai', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1', 'Sourced'));
    usePipelineStore.getState().moveDealStage('d1', 'Screened', { actor: 'agent' });
    expect(usePipelineStore.getState().auditLog.at(-1)!.actor).toBe('ai');
  });
});

describe('computeSkippedStages', () => {
  it('is empty for creation, adjacent, backward, and rail moves', () => {
    expect(computeSkippedStages(null, 'Screened')).toEqual([]);
    expect(computeSkippedStages('Sourced', 'Screened')).toEqual([]);
    expect(computeSkippedStages('Submitted', 'Outreach')).toEqual([]);
    expect(computeSkippedStages('Bench', 'Outreach')).toEqual([]);
    expect(computeSkippedStages('Outreach', 'Rejected')).toEqual([]);
  });

  it('lists strictly-between pipeline stages on jumps', () => {
    expect(computeSkippedStages('Screened', 'Submitted')).toEqual([
      'Outreach',
      'InConversation',
    ]);
  });
});

describe('suggestions', () => {
  it('default to pending; resolving audits and stamps resolvedAt', () => {
    usePipelineStore.getState().addSuggestion(makeSuggestion('s1'));
    expect(usePipelineStore.getState().suggestions[0].status).toBe('pending');
    usePipelineStore.getState().resolveSuggestion('s1', 'accepted');
    const st = usePipelineStore.getState();
    expect(st.suggestions[0].status).toBe('accepted');
    expect(st.suggestions[0].resolvedAt).toBeTruthy();
    expect(st.auditLog.at(-1)!.action).toBe('suggestion.accepted');
  });

  it('resolving a non-pending suggestion is a no-op', () => {
    usePipelineStore.getState().addSuggestion(makeSuggestion('s1'));
    usePipelineStore.getState().resolveSuggestion('s1', 'dismissed');
    usePipelineStore.getState().resolveSuggestion('s1', 'accepted');
    expect(usePipelineStore.getState().suggestions[0].status).toBe('dismissed');
  });
});

describe('audit log rotation', () => {
  it('keeps only the newest 500 entries', () => {
    const s = usePipelineStore.getState();
    for (let i = 0; i < 510; i++) {
      s.appendAudit({ actor: 'human', action: `a${i}`, before: null, after: null, entityType: 'deal', entityId: `d${i}` });
    }
    const log = usePipelineStore.getState().auditLog;
    expect(log).toHaveLength(500);
    expect(log[0].action).toBe('a10'); // oldest 10 rotated out
    expect(log.at(-1)!.action).toBe('a509');
    expect(JSON.parse(localStorage.getItem(V3_KEYS.audit)!)).toHaveLength(500);
  });
});

describe('sync plumbing', () => {
  it('buildPushPayload contains only dirty records', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1'));
    usePipelineStore.getState().upsertDeal(makeDeal('d2'));
    usePipelineStore.getState().markSynced();
    usePipelineStore.getState().upsertDeal({ ...makeDeal('d1'), jobTitle: 'edited' });
    const payload = usePipelineStore.getState().buildPushPayload();
    expect(payload.deals.map((d) => d.id)).toEqual(['d1']);
    expect(payload.schemaVersion).toBe(1);
  });

  it('applyRemote adopts higher-v server records and persists them', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1'));
    const local = usePipelineStore.getState().deals[0];
    const stamped = { ...local, v: 7, jobTitle: 'Server Title' };
    usePipelineStore.getState().applyRemote({ deals: [stamped] });
    const st = usePipelineStore.getState();
    expect(st.deals[0].v).toBe(7);
    expect(st.deals[0].jobTitle).toBe('Server Title');
    expect(JSON.parse(localStorage.getItem(V3_KEYS.deals)!)[0].v).toBe(7);
  });

  it('markSynced clears dirty ids and stamps lastSyncAt', () => {
    usePipelineStore.getState().upsertDeal(makeDeal('d1'));
    usePipelineStore.getState().markSynced('2026-07-31T10:00:00.000Z');
    const st = usePipelineStore.getState();
    expect(st.dirtyIds.deals).toEqual([]);
    expect(st.meta.lastSyncAt).toBe('2026-07-31T10:00:00.000Z');
  });
});
