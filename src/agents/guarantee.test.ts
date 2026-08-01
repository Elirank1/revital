// Rule-27 ⑥.2 guarantee-window pass: window math (boundary days),
// placement precedence + Placed fallback, mandate-fee authority vs
// legacy Deal.fee fallback, episode dedupe/dismissal finality, flag
// gate, zero-₪ construction.
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
const {
  GUARANTEE_ENDING_SOON_DAYS,
  buildGuaranteeSuggestion,
  detectGuaranteeWindows,
  guaranteeMilestonePrefix,
  guaranteeSuggestionId,
  planGuaranteeSweep,
  resolveGuaranteeTerms,
  resolvePlacement,
  runGuaranteeSweepOnLoad,
} = await import('./guarantee');

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
    jobId: `job-${seq}`,
    jobTitle: 'Backend Engineer',
    stage: 'Placed',
    stageEnteredAt: daysAgo(10),
    createdAt: daysAgo(60),
    ...overrides,
  };
}

function makeFee(overrides: Partial<MandateFee> = {}): MandateFee {
  return {
    jobId: 'j1',
    kind: 'fixed',
    fixedAmount: 40000,
    currency: 'ILS',
    guaranteeDays: 30,
    invoiceStatus: 'none',
    updatedAt: daysAgo(30),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<StageEvent> = {}): StageEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    v: seq,
    updatedAt: daysAgo(1),
    dealId: 'd1',
    from: 'Offer',
    to: 'Placed',
    ts: daysAgo(20),
    actor: 'human',
    skippedStages: [],
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
    kind: 'flag',
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
// Window math (boundary days)
// ------------------------------------------------------------------

describe('detectGuaranteeWindows — window math', () => {
  it('fires ENDING at exactly 7 days left; stays silent at 7.1', () => {
    // Placed 23d ago + 30d guarantee ⇒ exactly 7d left.
    const atBoundary = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(23) });
    const fees = { j1: makeFee({ jobId: 'j1' }) };
    const hit = detectGuaranteeWindows([atBoundary], fees, [], NOW);
    expect(hit.windows).toHaveLength(1);
    expect(hit.windows[0].phase).toBe('ending');
    expect(hit.windows[0].daysLeft).toBeCloseTo(GUARANTEE_ENDING_SOON_DAYS, 5);

    const early = makeDeal({ id: 'd2', jobId: 'j1', stageEnteredAt: daysAgo(22.9) });
    expect(detectGuaranteeWindows([early], fees, [], NOW).windows).toHaveLength(0);
  });

  it('flips to ENDED at exactly 0 days left, and stays ended after', () => {
    const fees = { j1: makeFee({ jobId: 'j1' }) };
    const atEnd = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(30) });
    const ended = detectGuaranteeWindows([atEnd], fees, [], NOW);
    expect(ended.windows[0].phase).toBe('ended');

    const past = makeDeal({ id: 'd2', jobId: 'j1', stageEnteredAt: daysAgo(45) });
    const w = detectGuaranteeWindows([past], fees, [], NOW).windows[0];
    expect(w.phase).toBe('ended');
    expect(w.daysLeft).toBeCloseTo(-15, 5);
  });

  it('guaranteeDays 0 / no fee anywhere ⇒ no window, not even scanned', () => {
    const noGuarantee = makeDeal({ id: 'd1', jobId: 'j1' });
    const zero = detectGuaranteeWindows(
      [noGuarantee],
      { j1: makeFee({ jobId: 'j1', guaranteeDays: 0 }) },
      [],
      NOW,
    );
    expect(zero.windows).toHaveLength(0);
    expect(zero.scanned).toBe(0);

    const bare = detectGuaranteeWindows([makeDeal()], {}, [], NOW);
    expect(bare.windows).toHaveLength(0);
    expect(bare.scanned).toBe(0);
  });

  it('only Placed/Paid sweep; tombstoned deals never', () => {
    const fees = { j1: makeFee({ jobId: 'j1' }) };
    const offer = makeDeal({ id: 'd1', jobId: 'j1', stage: 'Offer', stageEnteredAt: daysAgo(40) });
    const dead = makeDeal({ id: 'd2', jobId: 'j1', stageEnteredAt: daysAgo(40), deleted: true });
    const paid = makeDeal({ id: 'd3', jobId: 'j1', stage: 'Paid', stageEnteredAt: daysAgo(40) });
    const { windows } = detectGuaranteeWindows([offer, dead, paid], fees, [], NOW);
    expect(windows.map((w) => w.dealId)).toEqual(['d3']);
  });

  it('ENDED is skipped when the invoice is already paid; ENDING still fires', () => {
    const fees = { j1: makeFee({ jobId: 'j1', invoiceStatus: 'paid' }) };
    const endedPaid = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(45) });
    expect(detectGuaranteeWindows([endedPaid], fees, [], NOW).windows).toHaveLength(0);

    const endingPaid = makeDeal({ id: 'd2', jobId: 'j1', stageEnteredAt: daysAgo(25) });
    const { windows } = detectGuaranteeWindows([endingPaid], fees, [], NOW);
    expect(windows).toHaveLength(1);
    expect(windows[0].phase).toBe('ending');
  });
});

// ------------------------------------------------------------------
// Guarantee-term source precedence
// ------------------------------------------------------------------

describe('resolveGuaranteeTerms — MandateFee authority, Deal.fee fallback', () => {
  it('mandate fee wins; a mandate fee saying "no guarantee" silences legacy terms', () => {
    const deal = makeDeal({
      id: 'd1',
      jobId: 'j1',
      fee: { kind: 'fixed', fixedAmountILS: 30000, guaranteeDays: 60 },
    });
    const mandate = resolveGuaranteeTerms(deal, { j1: makeFee({ jobId: 'j1', guaranteeDays: 30 }) });
    expect(mandate).toMatchObject({ guaranteeDays: 30, feeSource: 'mandate' });

    // Mandate fee EXISTS with guaranteeDays 0 — it is the authority.
    expect(
      resolveGuaranteeTerms(deal, { j1: makeFee({ jobId: 'j1', guaranteeDays: 0 }) }),
    ).toBeNull();
  });

  it('falls back to legacy synced Deal.fee (server tick reality pre-G3)', () => {
    const deal = makeDeal({
      id: 'd1',
      jobId: 'j1',
      fee: { kind: 'fixed', fixedAmountILS: 30000, guaranteeDays: 45, invoiceStatus: 'pending' },
    });
    const terms = resolveGuaranteeTerms(deal, {});
    expect(terms).toMatchObject({
      guaranteeDays: 45,
      feeSource: 'deal',
      invoiceStatus: 'due', // legacy 'pending' maps to 'due'
    });
  });
});

// ------------------------------------------------------------------
// Placement precedence
// ------------------------------------------------------------------

describe('resolvePlacement — Placed event → Paid event → stageEnteredAt', () => {
  it('prefers the LATEST live to=Placed event over everything', () => {
    const deal = makeDeal({ id: 'd1', stage: 'Paid', stageEnteredAt: daysAgo(2) });
    const older = makeEvent({ id: 'ev-old', dealId: 'd1', to: 'Placed', ts: daysAgo(50) });
    const newer = makeEvent({ id: 'ev-new', dealId: 'd1', to: 'Placed', ts: daysAgo(20) });
    const paid = makeEvent({ id: 'ev-paid', dealId: 'd1', from: 'Placed', to: 'Paid', ts: daysAgo(2) });
    const ref = resolvePlacement(deal, [older, paid, newer]);
    expect(ref).toEqual({ ts: daysAgo(20), source: 'placed_event', sourceId: 'ev-new' });
  });

  it('falls back to a to=Paid event when Placed was skipped over', () => {
    const deal = makeDeal({ id: 'd1', stage: 'Paid', stageEnteredAt: daysAgo(5) });
    const skip = makeEvent({
      id: 'ev-skip',
      dealId: 'd1',
      from: 'Offer',
      to: 'Paid',
      ts: daysAgo(25),
      skippedStages: ['Placed'],
    });
    expect(resolvePlacement(deal, [skip])).toEqual({
      ts: daysAgo(25),
      source: 'paid_event',
      sourceId: 'ev-skip',
    });
  });

  it('falls back to stageEnteredAt with no move log; tombstoned/foreign events ignored', () => {
    const deal = makeDeal({ id: 'd1', stageEnteredAt: daysAgo(12) });
    const dead = makeEvent({ id: 'ev-dead', dealId: 'd1', to: 'Placed', ts: daysAgo(30), deleted: true });
    const foreign = makeEvent({ id: 'ev-x', dealId: 'other', to: 'Placed', ts: daysAgo(30) });
    expect(resolvePlacement(deal, [dead, foreign])).toEqual({
      ts: daysAgo(12),
      source: 'stage_entered_at',
      sourceId: 'd1',
    });
  });

  it('window end follows the placement event, not the current stage entry', () => {
    // Deal moved Placed→Paid: window runs from the Placed EVENT (28d ago),
    // not from Paid entry (2d ago) — 2d left on a 30d guarantee.
    const deal = makeDeal({ id: 'd1', jobId: 'j1', stage: 'Paid', stageEnteredAt: daysAgo(2) });
    const placed = makeEvent({ id: 'ev1', dealId: 'd1', to: 'Placed', ts: daysAgo(28) });
    const { windows } = detectGuaranteeWindows(
      [deal],
      { j1: makeFee({ jobId: 'j1' }) },
      [placed],
      NOW,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].phase).toBe('ending');
    expect(windows[0].daysLeft).toBeCloseTo(2, 5);
    expect(windows[0].placement.sourceId).toBe('ev1');
  });
});

// ------------------------------------------------------------------
// Suggestion building
// ------------------------------------------------------------------

describe('buildGuaranteeSuggestion', () => {
  const fees = { j1: makeFee({ jobId: 'j1' }) };

  it('ENDING: pit_boss flag with the dispatch phrase + numeric fee/placement evidence, no ₪', () => {
    const deal = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(25) });
    const win = detectGuaranteeWindows([deal], fees, [], NOW).windows[0];
    const input = buildGuaranteeSuggestion(win, deal);

    expect(input.id).toBe(guaranteeSuggestionId('d1', 'ending', win.windowEndTs));
    expect(input.agent).toBe('pit_boss');
    expect(input.kind).toBe('flag');
    expect(input.dealId).toBe('d1');
    expect(input.title).toContain('תקופת אחריות מסתיימת בעוד 5 ימים');
    // Evidence cites the fee record (guarantee days) + the placement date.
    const claims = (input.evidence ?? []).map((e) => e.claim).join('\n');
    expect(claims).toContain('30 ימים');
    expect(claims).toContain('תאריך השמה');
    expect((input.evidence ?? []).some((e) => e.sourceType === 'fee' && e.sourceId === 'j1')).toBe(true);
    expect((input.evidence ?? []).every((e) => /\d/.test(e.claim))).toBe(true);
    expect(`${input.title}\n${input.body}`).not.toContain('₪');
  });

  it('ENDED: next_action — invoice step when unpaid, payment check when already sent', () => {
    const deal = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(40) });
    const win = detectGuaranteeWindows([deal], fees, [], NOW).windows[0];
    const input = buildGuaranteeSuggestion(win, deal);
    expect(input.kind).toBe('next_action');
    expect(input.id).toBe(guaranteeSuggestionId('d1', 'ended', win.windowEndTs));
    expect(input.body).toContain('העמלה מובטחת');
    expect(input.body).toContain('להוציא חשבונית');

    const sentFees = { j1: makeFee({ jobId: 'j1', invoiceStatus: 'sent' }) };
    const sentWin = detectGuaranteeWindows([deal], sentFees, [], NOW).windows[0];
    const sentInput = buildGuaranteeSuggestion(sentWin, deal);
    expect(sentInput.body).toContain('החשבונית כבר נשלחה');
    expect(sentInput.body).not.toContain('להוציא חשבונית ללקוח');
    expect(`${sentInput.title}\n${sentInput.body}`).not.toContain('₪');
  });

  it('legacy Deal.fee evidence cites the deal, not a mandate fee record', () => {
    const deal = makeDeal({
      id: 'd1',
      jobId: 'j1',
      stageEnteredAt: daysAgo(25),
      fee: { kind: 'fixed', fixedAmountILS: 30000, guaranteeDays: 30 },
    });
    const win = detectGuaranteeWindows([deal], {}, [], NOW).windows[0];
    const input = buildGuaranteeSuggestion(win, deal);
    expect((input.evidence ?? []).some((e) => e.sourceType === 'deal' && e.sourceId === 'd1')).toBe(true);
    expect((input.evidence ?? []).some((e) => e.sourceType === 'fee')).toBe(false);
  });
});

// ------------------------------------------------------------------
// Sweep planning — dedupe + dismissal finality
// ------------------------------------------------------------------

describe('planGuaranteeSweep — dedupe', () => {
  const fees = { j1: makeFee({ jobId: 'j1' }) };

  it('same episode already filed in ANY status is never re-filed (dismissals final)', () => {
    const deal = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(25) });
    const win = detectGuaranteeWindows([deal], fees, [], NOW).windows[0];
    const dismissed = makeSuggestion({
      id: guaranteeSuggestionId('d1', 'ending', win.windowEndTs),
      status: 'dismissed',
    });
    const plan = planGuaranteeSweep([deal], fees, [], [dismissed], NOW);
    expect(plan.toFile).toHaveLength(0);
    expect(plan.skipped).toEqual([{ window: win, reason: 'exists' }]);
  });

  it('a pending same-milestone suggestion under a SHIFTED window end blocks re-filing', () => {
    const deal = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(25) });
    // Same (deal, phase) milestone, different end — e.g. guaranteeDays edited.
    const olderTimer = makeSuggestion({
      id: `${guaranteeMilestonePrefix('d1', 'ending')}20260701T000000000Z`,
      status: 'pending',
    });
    const plan = planGuaranteeSweep([deal], fees, [], [olderTimer], NOW);
    expect(plan.toFile).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('pending_milestone');

    // A RESOLVED old timer does not block the new episode.
    const resolved = { ...olderTimer, status: 'accepted' as const };
    expect(planGuaranteeSweep([deal], fees, [], [resolved], NOW).toFile).toHaveLength(1);
  });

  it('ENDING and ENDED are separate milestones — a resolved ending never blocks ended', () => {
    const deal = makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(40) });
    const win = detectGuaranteeWindows([deal], fees, [], NOW).windows[0];
    expect(win.phase).toBe('ended');
    const endingDone = makeSuggestion({
      id: guaranteeSuggestionId('d1', 'ending', win.windowEndTs),
      status: 'accepted',
    });
    const plan = planGuaranteeSweep([deal], fees, [], [endingDone], NOW);
    expect(plan.toFile).toHaveLength(1);
    expect(plan.toFile[0].input.kind).toBe('next_action');
  });
});

// ------------------------------------------------------------------
// Client on-load sweep
// ------------------------------------------------------------------

describe('runGuaranteeSweepOnLoad', () => {
  const feesStore = { getState: () => ({ fees: { j1: makeFee({ jobId: 'j1' }) } }) };

  it('flag off ⇒ store untouched', () => {
    usePipelineStore.setState({
      deals: [makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(25) })],
    });
    const result = runGuaranteeSweepOnLoad(usePipelineStore, feesStore, NOW);
    expect(result).toMatchObject({ ran: false, reason: 'flag_off', created: [] });
    expect(usePipelineStore.getState().suggestions).toHaveLength(0);
  });

  it('files through addSuggestion (audited ai/pit_boss); re-run is a no-op', () => {
    usePipelineStore.setState({
      v3Enabled: true,
      deals: [makeDeal({ id: 'd1', jobId: 'j1', stageEnteredAt: daysAgo(25) })],
    });
    const first = runGuaranteeSweepOnLoad(usePipelineStore, feesStore, NOW);
    expect(first.ran).toBe(true);
    expect(first.created).toHaveLength(1);
    const filed = usePipelineStore.getState().suggestions;
    expect(filed).toHaveLength(1);
    expect(filed[0].agent).toBe('pit_boss');
    expect(filed[0].status).toBe('pending');
    const audit = usePipelineStore.getState().auditLog.at(-1);
    expect(audit).toMatchObject({ actor: 'ai', agent: 'pit_boss', action: 'suggestion.create' });

    const second = runGuaranteeSweepOnLoad(usePipelineStore, feesStore, NOW);
    expect(second.created).toHaveLength(0);
    expect(second.skipped[0].reason).toBe('exists');
    expect(usePipelineStore.getState().suggestions).toHaveLength(1);
  });
});
