// Rule-27 ⑥.3 invoice-reminder pass: invoice state machine
// (none/due/sent/paid × stale), guarantee gating + cross-pass dedupe,
// staleness bases, legacy Deal.fee fallback, episode dedupe, flag gate,
// zero-₪ construction.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Deal, StageEvent, Suggestion } from '../types/pipeline';
import type { MandateFee } from '../lib/money/mandateFee';

// ---- in-memory localStorage BEFORE store import (node env) ----
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

const { usePipelineStore } = await import('../store/pipelineStore');
const { guaranteeSuggestionId, guaranteeMilestonePrefix } = await import('./guarantee');
const {
  INVOICE_STALE_DAYS,
  buildInvoiceSuggestion,
  detectInvoiceActions,
  invoiceMilestonePrefix,
  invoiceSuggestionId,
  planInvoiceSweep,
  runInvoiceSweepOnLoad,
} = await import('./invoices');

const NOW = '2026-08-01T12:00:00.000Z';

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString();
}

let seq = 0;
function makeDeal(overrides: Partial<Deal> = {}): Deal {
  seq += 1;
  return {
    id: `d${seq}`,
    v: seq,
    updatedAt: daysAgo(1),
    personId: `p${seq}`,
    jobId: 'j1',
    jobTitle: 'Backend Engineer',
    stage: 'Placed',
    stageEnteredAt: daysAgo(40),
    createdAt: daysAgo(90),
    ...overrides,
  };
}

function makeFee(overrides: Partial<MandateFee> = {}): MandateFee {
  return {
    jobId: 'j1',
    kind: 'fixed',
    fixedAmount: 40000,
    currency: 'ILS',
    guaranteeDays: 0,
    invoiceStatus: 'none',
    updatedAt: daysAgo(30),
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  seq += 1;
  return {
    id: `s${seq}`,
    v: seq,
    updatedAt: daysAgo(1),
    agent: 'pit_boss',
    kind: 'next_action',
    title: 't',
    body: 'b',
    evidence: [],
    status: 'pending',
    createdAt: daysAgo(1),
    ...overrides,
  };
}

beforeEach(() => {
  seq = 0;
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
});

// ------------------------------------------------------------------
// Invoice state machine
// ------------------------------------------------------------------

describe('detectInvoiceActions — state machine', () => {
  it("'none' with a complete fee and a Placed deal ⇒ 'issue'; 'due' too", () => {
    const deal = makeDeal({ id: 'd1' });
    const none = detectInvoiceActions({ j1: makeFee() }, [deal], [], NOW);
    expect(none.findings).toEqual([
      expect.objectContaining({ jobId: 'j1', dealId: 'd1', milestone: 'issue', invoiceStatus: 'none' }),
    ]);
    const due = detectInvoiceActions({ j1: makeFee({ invoiceStatus: 'due' }) }, [deal], [], NOW);
    expect(due.findings[0]).toMatchObject({ milestone: 'issue', invoiceStatus: 'due' });
  });

  it("'sent' past invoiceDueAt is stale immediately; before the due date it is silent", () => {
    const deal = makeDeal({ id: 'd1' });
    const overdue = detectInvoiceActions(
      { j1: makeFee({ invoiceStatus: 'sent', invoiceDueAt: daysAgo(3) }) },
      [deal],
      [],
      NOW,
    );
    expect(overdue.findings[0]).toMatchObject({
      milestone: 'remind',
      basisKind: 'invoice_due_at',
      basisTs: daysAgo(3),
    });
    expect(overdue.findings[0].daysStale).toBeCloseTo(3, 5);

    const notYet = detectInvoiceActions(
      { j1: makeFee({ invoiceStatus: 'sent', invoiceDueAt: daysAgo(-2) }) },
      [deal],
      [],
      NOW,
    );
    expect(notYet.findings).toHaveLength(0);
  });

  it("'sent' without a due date goes stale only past 14 days from the record", () => {
    const deal = makeDeal({ id: 'd1' });
    const fresh = detectInvoiceActions(
      { j1: makeFee({ invoiceStatus: 'sent', updatedAt: daysAgo(INVOICE_STALE_DAYS) }) },
      [deal],
      [],
      NOW,
    );
    expect(fresh.findings).toHaveLength(0); // exactly 14d — not yet stale

    const stale = detectInvoiceActions(
      { j1: makeFee({ invoiceStatus: 'sent', updatedAt: daysAgo(14.1) }) },
      [deal],
      [],
      NOW,
    );
    expect(stale.findings[0]).toMatchObject({
      milestone: 'remind',
      basisKind: 'record_updated',
      basisTs: daysAgo(14.1),
    });
  });

  it("'paid' never fires; incomplete fee never fires (but is scanned)", () => {
    const deal = makeDeal({ id: 'd1' });
    expect(
      detectInvoiceActions({ j1: makeFee({ invoiceStatus: 'paid' }) }, [deal], [], NOW).findings,
    ).toHaveLength(0);

    const incomplete = detectInvoiceActions(
      { j1: makeFee({ kind: 'percent', percent: 25, fixedAmount: undefined }) },
      [deal],
      [],
      NOW,
    );
    expect(incomplete.findings).toHaveLength(0);
    expect(incomplete.scanned).toBe(1);
  });

  it('no live Placed/Paid deal ⇒ nothing (the fee alone is not actionable)', () => {
    const submitted = makeDeal({ id: 'd1', stage: 'Submitted' });
    const dead = makeDeal({ id: 'd2', deleted: true });
    const out = detectInvoiceActions({ j1: makeFee() }, [submitted, dead], [], NOW);
    expect(out.findings).toHaveLength(0);
    expect(out.scanned).toBe(0);
  });

  it("guarantee gate: 'issue' waits until every placement is past its window", () => {
    const fees = { j1: makeFee({ guaranteeDays: 30 }) };
    const inside = makeDeal({ id: 'd1', stageEnteredAt: daysAgo(10) });
    expect(detectInvoiceActions(fees, [inside], [], NOW).findings).toHaveLength(0);

    const past = makeDeal({ id: 'd2', stageEnteredAt: daysAgo(40) });
    const out = detectInvoiceActions(fees, [past], [], NOW);
    expect(out.findings[0]).toMatchObject({ milestone: 'issue' });
    expect(out.findings[0].guaranteeEndedTs).toBe(daysAgo(10)); // placed 40d ago + 30d
  });

  it('anchor deal is the earliest placement (deterministic on ties)', () => {
    const later = makeDeal({ id: 'd-b', stageEnteredAt: daysAgo(20) });
    const earlier = makeDeal({ id: 'd-a', stageEnteredAt: daysAgo(50) });
    const out = detectInvoiceActions({ j1: makeFee() }, [later, earlier], [], NOW);
    expect(out.findings[0].dealId).toBe('d-a');
  });

  it("legacy Deal.fee fallback: complete fixed fee + 'sent' stale via the deal record", () => {
    const deal = makeDeal({
      id: 'd1',
      updatedAt: daysAgo(20),
      fee: { kind: 'fixed', fixedAmountILS: 30000, invoiceStatus: 'sent' },
    });
    const out = detectInvoiceActions({}, [deal], [], NOW);
    expect(out.findings[0]).toMatchObject({
      milestone: 'remind',
      basisKind: 'record_updated',
      feeSource: 'deal',
    });

    // Legacy 'pending' maps to 'due' ⇒ issue milestone.
    const pendingDeal = makeDeal({
      id: 'd2',
      jobId: 'j2',
      fee: { kind: 'percent', percent: 25, expectedSalaryILS: 300000, invoiceStatus: 'pending' },
    });
    const issue = detectInvoiceActions({}, [pendingDeal], [], NOW);
    expect(issue.findings[0]).toMatchObject({ milestone: 'issue', invoiceStatus: 'due' });

    // Incomplete legacy fee never fires.
    const partial = makeDeal({
      id: 'd3',
      jobId: 'j3',
      fee: { kind: 'percent', percent: 25 },
    });
    expect(detectInvoiceActions({}, [partial], [], NOW).findings).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Suggestion building
// ------------------------------------------------------------------

describe('buildInvoiceSuggestion', () => {
  it("'issue': pit_boss next_action titled להוציא חשבונית, numeric evidence, no ₪", () => {
    const deal = makeDeal({ id: 'd1' });
    const finding = detectInvoiceActions({ j1: makeFee() }, [deal], [], NOW).findings[0];
    const input = buildInvoiceSuggestion(finding, deal);
    expect(input.id).toBe(invoiceSuggestionId(finding));
    expect(input.id).toBe('s_inv_issue_j1');
    expect(input.agent).toBe('pit_boss');
    expect(input.kind).toBe('next_action');
    expect(input.title).toContain('להוציא חשבונית');
    expect((input.evidence ?? []).some((e) => e.sourceType === 'fee' && e.sourceId === 'j1')).toBe(true);
    expect((input.evidence ?? []).every((e) => /\d/.test(e.claim))).toBe(true);
    expect(`${input.title}\n${input.body}`).not.toContain('₪');
  });

  it("'remind': titled תזכורת תשלום; body names the staleness basis", () => {
    const deal = makeDeal({ id: 'd1' });
    const overdue = detectInvoiceActions(
      { j1: makeFee({ invoiceStatus: 'sent', invoiceDueAt: daysAgo(3) }) },
      [deal],
      [],
      NOW,
    ).findings[0];
    const dueInput = buildInvoiceSuggestion(overdue, deal);
    expect(dueInput.title).toContain('תזכורת תשלום');
    expect(dueInput.body).toContain('תאריך היעד לתשלום עבר');
    expect(dueInput.id).toBe(invoiceSuggestionId(overdue));

    const stale = detectInvoiceActions(
      { j1: makeFee({ invoiceStatus: 'sent', updatedAt: daysAgo(20) }) },
      [deal],
      [],
      NOW,
    ).findings[0];
    const staleInput = buildInvoiceSuggestion(stale, deal);
    expect(staleInput.body).toContain(`סף: ${INVOICE_STALE_DAYS} ימים`);
    expect(`${staleInput.title}\n${staleInput.body}`).not.toContain('₪');
  });
});

// ------------------------------------------------------------------
// Sweep planning — dedupe + cross-pass guarantee coordination
// ------------------------------------------------------------------

describe('planInvoiceSweep — dedupe', () => {
  it('same episode in ANY status is never re-filed (dismissals final)', () => {
    const deal = makeDeal({ id: 'd1' });
    const dismissed = makeSuggestion({ id: 's_inv_issue_j1', status: 'dismissed' });
    const plan = planInvoiceSweep({ j1: makeFee() }, [deal], [], [dismissed], NOW);
    expect(plan.toFile).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('exists');
  });

  it("a pending same-milestone 'remind' under an older basis blocks a new one", () => {
    const deal = makeDeal({ id: 'd1' });
    const older = makeSuggestion({
      id: `${invoiceMilestonePrefix('j1', 'remind')}20260601T000000000Z`,
      status: 'pending',
    });
    const plan = planInvoiceSweep(
      { j1: makeFee({ invoiceStatus: 'sent', invoiceDueAt: daysAgo(3) }) },
      [deal],
      [],
      [older],
      NOW,
    );
    expect(plan.toFile).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('pending_milestone');
  });

  it("cross-pass: an unfiled or pending guarantee-ENDED episode blocks 'issue'; a resolved one does not", () => {
    const fees = { j1: makeFee({ guaranteeDays: 30 }) };
    const deal = makeDeal({ id: 'd1', stageEnteredAt: daysAgo(40) }); // window ended 10d ago
    const windowEnd = daysAgo(10);

    // Unfiled: the guarantee pass will file it in this same sweep.
    const unfiled = planInvoiceSweep(fees, [deal], [], [], NOW);
    expect(unfiled.toFile).toHaveLength(0);
    expect(unfiled.skipped[0].reason).toBe('guarantee_pending');

    // Pending: still hers to triage.
    const pendingOver = makeSuggestion({
      id: guaranteeSuggestionId('d1', 'ended', windowEnd),
      status: 'pending',
    });
    const pending = planInvoiceSweep(fees, [deal], [], [pendingOver], NOW);
    expect(pending.skipped[0].reason).toBe('guarantee_pending');

    // Resolved: the standing issue-reminder takes over.
    const resolvedOver = { ...pendingOver, status: 'dismissed' as const };
    const resolved = planInvoiceSweep(fees, [deal], [], [resolvedOver], NOW);
    expect(resolved.toFile).toHaveLength(1);
    expect(resolved.toFile[0].input.id).toBe('s_inv_issue_j1');
    expect(resolved.toFile[0].input.kind).toBe('next_action');
  });

  it("guarantee milestone prefixes never collide with invoice ids", () => {
    expect(guaranteeMilestonePrefix('d1', 'ended').startsWith('s_gw_over_')).toBe(true);
    expect(invoiceMilestonePrefix('j1', 'issue').startsWith('s_inv_issue_')).toBe(true);
    expect(invoiceMilestonePrefix('j1', 'remind').startsWith('s_inv_remind_')).toBe(true);
  });
});

// ------------------------------------------------------------------
// Client on-load sweep
// ------------------------------------------------------------------

describe('runInvoiceSweepOnLoad', () => {
  const feesStore = { getState: () => ({ fees: { j1: makeFee() } }) };

  it('flag off ⇒ store untouched', () => {
    usePipelineStore.setState({ deals: [makeDeal({ id: 'd1' })] });
    const result = runInvoiceSweepOnLoad(usePipelineStore, feesStore, NOW);
    expect(result).toMatchObject({ ran: false, reason: 'flag_off', created: [] });
    expect(usePipelineStore.getState().suggestions).toHaveLength(0);
  });

  it('files through addSuggestion (audited ai/pit_boss); re-run is a no-op', () => {
    usePipelineStore.setState({
      v3Enabled: true,
      deals: [makeDeal({ id: 'd1' })],
    });
    const first = runInvoiceSweepOnLoad(usePipelineStore, feesStore, NOW);
    expect(first.ran).toBe(true);
    expect(first.created).toHaveLength(1);
    const filed = usePipelineStore.getState().suggestions;
    expect(filed).toHaveLength(1);
    expect(filed[0].id).toBe('s_inv_issue_j1');
    expect(filed[0].agent).toBe('pit_boss');
    const audit = usePipelineStore.getState().auditLog.at(-1);
    expect(audit).toMatchObject({ actor: 'ai', agent: 'pit_boss', action: 'suggestion.create' });

    const second = runInvoiceSweepOnLoad(usePipelineStore, feesStore, NOW);
    expect(second.created).toHaveLength(0);
    expect(second.skipped[0].reason).toBe('exists');
    expect(usePipelineStore.getState().suggestions).toHaveLength(1);
  });
});
