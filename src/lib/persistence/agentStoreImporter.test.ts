// Wave 2 — agent-store importer against the mocked Supabase client:
// dry-run-first, flag-gated, auto-backup, append-only events, idempotent.
import { describe, it, expect, beforeEach } from 'vitest';
import type { StageEvent, Suggestion } from '../../types/pipeline';
import type { MandateFee } from '../money/mandateFee';

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

const { mockSupabaseStore } = await import('./mockSupabase');
const {
  AGENT_IMPORT_BACKUP_KEY,
  agentStoreImportApply,
  agentStoreImportDryRun,
  buildImportSource,
  feeLedgerId,
} = await import('./agentStoreImporter');
const { setV3Enabled } = await import('./keys');
const { usePipelineStore } = await import('../../store/pipelineStore');
const { useMoneyStore } = await import('../money/moneyStore');

const T1 = '2026-07-01T10:00:00.000Z';
const T2 = '2026-07-02T10:00:00.000Z';

function stageEvent(id: string, over: Partial<StageEvent> = {}): StageEvent {
  return {
    id,
    v: 1,
    updatedAt: T1,
    dealId: 'd1',
    from: null,
    to: 'Sourced',
    ts: T1,
    actor: 'human',
    skippedStages: [],
    ...over,
  };
}

function makeSuggestion(id: string, over: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    v: 1,
    updatedAt: T1,
    agent: 'pit_boss',
    kind: 'next_action',
    title: 't',
    body: 'b',
    evidence: [],
    status: 'pending',
    createdAt: T1,
    ...over,
  };
}

function makeFee(over: Partial<MandateFee> = {}): MandateFee {
  return {
    jobId: 'J1',
    kind: 'fixed',
    fixedAmount: 100_000,
    currency: 'ILS',
    guaranteeDays: 90,
    invoiceStatus: 'none',
    updatedAt: T1,
    ...over,
  };
}

function source(over: Record<string, unknown> = {}) {
  return {
    accessCode: 'code-1',
    events: [stageEvent('e1'), stageEvent('e2', { to: 'Screened', from: 'Sourced' as const })],
    suggestions: [makeSuggestion('s1')],
    agentRuns: [],
    fees: [makeFee()],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('dry run', () => {
  it('reports the full plan without mutating the destination', async () => {
    const client = mockSupabaseStore();
    const plan = await agentStoreImportDryRun(source(), client);
    expect(plan).toMatchObject({
      accessCode: 'code-1',
      wouldInsertEvents: 2,
      unchangedEvents: 0,
      conflictingEventIds: [],
      wouldInsertSuggestions: 1,
      wouldUpsertFees: 1,
      wouldAppendFeeLedger: 1,
    });
    expect(client.count('events')).toBe(0);
    expect(client.count('suggestions')).toBe(0);
    expect(client.count('mandate_fees')).toBe(0);
    expect(client.count('fee_ledger')).toBe(0);
  });
});

describe('apply gating (flag + confirm)', () => {
  it('refuses with flag off — even with confirm:true', async () => {
    const client = mockSupabaseStore();
    const res = await agentStoreImportApply(source(), client, { confirm: true });
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('flag_off');
    expect(client.count('events')).toBe(0);
    expect(localStorage.getItem(AGENT_IMPORT_BACKUP_KEY)).toBeNull();
  });

  it('refuses without explicit confirm', async () => {
    setV3Enabled(true);
    const client = mockSupabaseStore();
    const res = await agentStoreImportApply(source(), client);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('not_confirmed');
    expect(client.count('events')).toBe(0);
  });
});

describe('apply', () => {
  it('writes all tables, takes a pre-migration backup, and re-runs are no-ops', async () => {
    setV3Enabled(true);
    const client = mockSupabaseStore();

    const res = await agentStoreImportApply(source(), client, { confirm: true });
    expect(res.applied).toBe(true);
    expect(res.insertedEvents).toBe(2);
    expect(res.upsertedSuggestions).toBe(1);
    expect(res.upsertedFees).toBe(1);
    expect(res.appendedFeeLedger).toBe(1);
    expect(res.backupKey).toBe(AGENT_IMPORT_BACKUP_KEY);

    // Backup captured the destination BEFORE this run (empty tables).
    const backup = JSON.parse(localStorage.getItem(AGENT_IMPORT_BACKUP_KEY)!);
    expect(backup.accessCode).toBe('code-1');
    expect(backup.tables.events).toEqual([]);
    expect(backup.tables.mandate_fees).toEqual([]);

    // Destination rows are schema-shaped and carry the full payload.
    const events = await client.selectAll('events');
    expect(events).toHaveLength(2);
    const e1 = events.find((r) => r.id === 'e1')!;
    expect(e1).toMatchObject({
      access_code: 'code-1',
      deal_id: 'd1',
      from_stage: null,
      to_stage: 'Sourced',
    });
    expect((e1.payload as StageEvent).id).toBe('e1');
    const ledger = await client.selectAll('fee_ledger');
    expect(ledger[0].id).toBe(feeLedgerId('J1', T1));

    // Idempotent re-run: same source → zero writes, everything unchanged.
    const again = await agentStoreImportApply(source(), client, { confirm: true });
    expect(again.applied).toBe(true);
    expect(again.insertedEvents).toBe(0);
    expect(again.upsertedSuggestions).toBe(0);
    expect(again.upsertedFees).toBe(0);
    expect(again.appendedFeeLedger).toBe(0);
    expect(again.plan.unchangedEvents).toBe(2);
    expect(again.plan.unchangedSuggestions).toBe(1);
    expect(again.plan.unchangedFees).toBe(1);
  });

  it('updates changed suggestions; changed fees upsert AND append a new ledger entry', async () => {
    setV3Enabled(true);
    const client = mockSupabaseStore();
    await agentStoreImportApply(source(), client, { confirm: true });

    const changed = source({
      suggestions: [makeSuggestion('s1', { status: 'accepted', resolvedAt: T2, updatedAt: T2 })],
      fees: [makeFee({ invoiceStatus: 'sent', updatedAt: T2 })],
    });
    const res = await agentStoreImportApply(changed, client, { confirm: true });
    expect(res.plan.wouldUpdateSuggestions).toBe(1);
    expect(res.upsertedSuggestions).toBe(1);
    expect(res.upsertedFees).toBe(1);
    expect(res.appendedFeeLedger).toBe(1); // fee history is append-only

    const suggestions = await client.selectAll('suggestions');
    expect(suggestions.find((r) => r.id === 's1')!.status).toBe('accepted');
    const fees = await client.selectAll('mandate_fees');
    expect(fees.find((r) => r.job_id === 'J1')!.invoice_status).toBe('sent');
    expect(await client.selectAll('fee_ledger')).toHaveLength(2);
  });

  it('append-only events: a conflicting id is reported and NEVER overwritten', async () => {
    setV3Enabled(true);
    const client = mockSupabaseStore();
    await agentStoreImportApply(source(), client, { confirm: true });

    const conflicting = source({
      events: [stageEvent('e1', { to: 'Outreach' })], // same id, different content
    });
    const plan = await agentStoreImportDryRun(conflicting, client);
    expect(plan.conflictingEventIds).toEqual(['e1']);
    expect(plan.wouldInsertEvents).toBe(0);

    const res = await agentStoreImportApply(conflicting, client, { confirm: true });
    expect(res.applied).toBe(true);
    expect(res.insertedEvents).toBe(0);
    const events = await client.selectAll('events');
    expect(events.find((r) => r.id === 'e1')!.to_stage).toBe('Sourced'); // untouched
  });

  it('scopes reads/writes to the source access code', async () => {
    setV3Enabled(true);
    const client = mockSupabaseStore();
    await agentStoreImportApply(source(), client, { confirm: true });
    // Same ids under a DIFFERENT code are fresh inserts, not conflicts.
    const other = source({ accessCode: 'code-2' });
    const plan = await agentStoreImportDryRun(other, client);
    expect(plan.wouldInsertEvents).toBe(2);
    expect(plan.conflictingEventIds).toEqual([]);
  });
});

describe('mock client invariants (mirrors supabase/schema.sql)', () => {
  it('events and fee_ledger reject upsert (append-only trigger)', async () => {
    const client = mockSupabaseStore();
    await expect(client.upsert('events', [])).rejects.toThrow(/append-only/);
    await expect(client.upsert('fee_ledger', [])).rejects.toThrow(/append-only/);
  });

  it('insert rejects duplicate primary keys atomically', async () => {
    const client = mockSupabaseStore();
    const row = { access_code: 'c', id: 'x', payload: {} };
    await client.insert('events', [row]);
    await expect(client.insert('events', [row])).rejects.toThrow(/duplicate key/);
    expect(client.count('events')).toBe(1);
  });

  it('selectAll returns copies — mutating a result never leaks into the store', async () => {
    const client = mockSupabaseStore();
    await client.insert('events', [{ access_code: 'c', id: 'x', payload: { a: 1 } }]);
    const rows = await client.selectAll('events');
    (rows[0].payload as { a: number }).a = 999;
    const fresh = await client.selectAll('events');
    expect((fresh[0].payload as { a: number }).a).toBe(1);
  });
});

describe('buildImportSource', () => {
  it('snapshots live store state read-only (events, suggestions, fees; runs empty in Wave 2)', () => {
    usePipelineStore.setState({
      persons: [],
      deals: [],
      stageEvents: [stageEvent('e9')],
      suggestions: [makeSuggestion('s9')],
      auditLog: [],
      undoStack: [],
      dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
    });
    useMoneyStore.setState({ fees: { J1: makeFee() } });
    const src = buildImportSource('code-9');
    expect(src.accessCode).toBe('code-9');
    expect(src.events.map((e) => e.id)).toEqual(['e9']);
    expect(src.suggestions.map((s) => s.id)).toEqual(['s9']);
    expect(src.agentRuns).toEqual([]);
    expect(src.fees.map((f) => f.jobId)).toEqual(['J1']);
  });
});
