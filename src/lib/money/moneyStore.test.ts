// Wave 2 — money store slice: revital_v3_fees / revital_v3_priors
// persistence, audit trail, bound selectors. Node env with MemStorage.
import { describe, it, expect, beforeEach } from 'vitest';

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
const { useMoneyStore, MONEY_KEYS, feeForJob, feeAmountForJob, isMandateCalibrated, qualifiedPipelineSnapshot } =
  await import('./moneyStore');
const { DEFAULT_STAGE_PRIORS } = await import('./priors');

function resetStores() {
  localStorage.clear();
  useMoneyStore.setState({
    fees: {},
    priors: JSON.parse(JSON.stringify(DEFAULT_STAGE_PRIORS)),
  });
  usePipelineStore.setState({
    persons: [],
    deals: [],
    stageEvents: [],
    suggestions: [],
    auditLog: [],
    undoStack: [],
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
}

beforeEach(resetStores);

describe('setFee / clearFee', () => {
  it('upserts, stamps updatedAt/currency, persists under revital_v3_fees, audits', () => {
    const created = useMoneyStore.getState().setFee({
      jobId: 'J1',
      kind: 'percent',
      percent: 20,
      expectedSalary: 480_000,
      guaranteeDays: 60,
    });
    expect(created.currency).toBe('ILS');
    expect(created.invoiceStatus).toBe('none');
    expect(created.guaranteeDays).toBe(60);
    expect(Date.parse(created.updatedAt)).not.toBeNaN();

    const persisted = JSON.parse(localStorage.getItem(MONEY_KEYS.fees)!);
    expect(persisted.J1.percent).toBe(20);

    const audit = usePipelineStore.getState().auditLog;
    expect(audit[audit.length - 1]).toMatchObject({
      action: 'fee.set',
      entityType: 'mandate',
      entityId: 'J1',
      before: null,
    });

    // update keeps unspecified fields (guaranteeDays, invoiceStatus)
    const updated = useMoneyStore.getState().setFee({
      jobId: 'J1',
      kind: 'percent',
      percent: 25,
      expectedSalary: 480_000,
    });
    expect(updated.guaranteeDays).toBe(60);
    const audit2 = usePipelineStore.getState().auditLog;
    expect(audit2[audit2.length - 1].action).toBe('fee.update');
  });

  it('clearFee removes the fee, persists, and audits', () => {
    useMoneyStore
      .getState()
      .setFee({ jobId: 'J1', kind: 'fixed', fixedAmount: 30_000 });
    useMoneyStore.getState().clearFee('J1');
    expect(feeForJob('J1')).toBeNull();
    expect(JSON.parse(localStorage.getItem(MONEY_KEYS.fees)!)).toEqual({});
    const audit = usePipelineStore.getState().auditLog;
    expect(audit[audit.length - 1].action).toBe('fee.clear');
    // clearing a non-existent fee is a silent no-op (no bogus audit)
    const len = audit.length;
    useMoneyStore.getState().clearFee('nope');
    expect(usePipelineStore.getState().auditLog.length).toBe(len);
  });
});

describe('priors editing', () => {
  it('setStagePrior persists valid edits and rejects corrupt ranges per-stage', () => {
    useMoneyStore.getState().setStagePrior('Submitted', { lo: 0.25, hi: 0.4 });
    expect(useMoneyStore.getState().priors.Submitted).toEqual({
      lo: 0.25,
      hi: 0.4,
    });
    const persisted = JSON.parse(localStorage.getItem(MONEY_KEYS.priors)!);
    expect(persisted.Submitted).toEqual({ lo: 0.25, hi: 0.4 });

    // lo > hi → sanitized back to the DEFAULT for that stage
    useMoneyStore.getState().setStagePrior('Offer', { lo: 0.9, hi: 0.1 });
    expect(useMoneyStore.getState().priors.Offer).toEqual(
      DEFAULT_STAGE_PRIORS.Offer,
    );
  });

  it('resetPriors restores defaults and audits', () => {
    useMoneyStore.getState().setStagePrior('Submitted', { lo: 0.25, hi: 0.4 });
    useMoneyStore.getState().resetPriors();
    expect(useMoneyStore.getState().priors).toEqual(DEFAULT_STAGE_PRIORS);
    const audit = usePipelineStore.getState().auditLog;
    expect(audit[audit.length - 1].action).toBe('priors.reset');
  });
});

describe('bound selectors', () => {
  it('calibration + snapshot flow over live pipeline state', () => {
    // Uncalibrated: fee exists but no deal past Screened.
    useMoneyStore
      .getState()
      .setFee({ jobId: 'J1', kind: 'fixed', fixedAmount: 100_000 });
    expect(feeAmountForJob('J1')).toBe(100_000);
    expect(isMandateCalibrated('J1')).toBe(false);
    expect(qualifiedPipelineSnapshot().qualifiedEV).toBeNull();

    // Card a person + deal and move it past Screened → calibrated.
    const { person } = usePipelineStore.getState().addPerson({ name: 'Dana Levi' });
    const d = usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'J1',
      jobTitle: 'Backend',
      stage: 'Screened',
    });
    expect(isMandateCalibrated('J1')).toBe(false);
    usePipelineStore.getState().moveDeal(d.id, 'Submitted');
    expect(isMandateCalibrated('J1')).toBe(true);

    const snap = qualifiedPipelineSnapshot();
    expect(snap.qualifiedEV).toBeCloseTo(100_000 * 0.275, 6);
    expect(snap.calibratedJobIds).toEqual(['J1']);
  });
});
