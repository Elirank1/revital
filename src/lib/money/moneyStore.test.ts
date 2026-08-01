// Waves 2–3 — money store slice: revital_v3_fees / revital_v3_priors /
// revital_v3_seeding persistence, audit trail, bound selectors.
// Node env with MemStorage.
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
const {
  useMoneyStore,
  MONEY_KEYS,
  feeForJob,
  feeAmountForJob,
  isMandateCalibrated,
  isMandateSeeded,
  qualifiedPipelineSnapshot,
  unseededMandates,
} = await import('./moneyStore');
const { DEFAULT_STAGE_PRIORS } = await import('./priors');
const { reloadSeeding } = await import('./seeding');

function resetStores() {
  localStorage.clear();
  useMoneyStore.setState({
    fees: {},
    priors: JSON.parse(JSON.stringify(DEFAULT_STAGE_PRIORS)),
    seeding: reloadSeeding(),
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

describe('markMandateSeeded (Wave-3 C-seed, D-042)', () => {
  it('persists under revital_v3_seeding, audits, and is idempotent', () => {
    expect(isMandateSeeded('J1')).toBe(false);
    const entry = useMoneyStore.getState().markMandateSeeded('J1');
    expect(entry.jobId).toBe('J1');
    expect(Date.parse(entry.seededAt)).not.toBeNaN();
    expect(isMandateSeeded('J1')).toBe(true);

    const persisted = JSON.parse(localStorage.getItem(MONEY_KEYS.seeding)!);
    expect(persisted.J1).toEqual(entry);

    const audit = usePipelineStore.getState().auditLog;
    expect(audit[audit.length - 1]).toMatchObject({
      actor: 'human',
      action: 'seeding.mark',
      entityType: 'mandate',
      entityId: 'J1',
      before: null,
      after: entry,
    });

    // Idempotent: same entry back, NO seededAt re-stamp, NO extra audit.
    const len = audit.length;
    const again = useMoneyStore.getState().markMandateSeeded('J1');
    expect(again).toEqual(entry);
    expect(usePipelineStore.getState().auditLog.length).toBe(len);
    expect(
      JSON.parse(localStorage.getItem(MONEY_KEYS.seeding)!).J1.seededAt,
    ).toBe(entry.seededAt);
  });

  it('unseededMandates lists live board mandates without a seeding entry', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'Noa Bar' });
    usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'J1',
      jobTitle: 'Backend',
      stage: 'Sourced',
    });
    const d2 = usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'J2',
      jobTitle: 'Data',
      stage: 'Screened',
    });
    expect(unseededMandates()).toEqual(['J1', 'J2']);

    useMoneyStore.getState().markMandateSeeded('J1');
    expect(unseededMandates()).toEqual(['J2']);

    // Tombstoned deals do not resurrect a mandate onto the worklist.
    usePipelineStore.getState().deleteDeal(d2.id);
    expect(unseededMandates()).toEqual([]);
  });
});

describe('bound selectors', () => {
  it('calibration + snapshot flow: seeded AND fee AND stage — all three gates', () => {
    // Fee exists but no deal past Screened AND unseeded.
    useMoneyStore
      .getState()
      .setFee({ jobId: 'J1', kind: 'fixed', fixedAmount: 100_000 });
    expect(feeAmountForJob('J1')).toBe(100_000);
    expect(isMandateCalibrated('J1')).toBe(false);
    expect(qualifiedPipelineSnapshot().qualifiedEV).toBeNull();

    // Card a person + deal and move it past Screened → STILL unseeded.
    const { person } = usePipelineStore.getState().addPerson({ name: 'Dana Levi' });
    const d = usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'J1',
      jobTitle: 'Backend',
      stage: 'Screened',
    });
    expect(isMandateCalibrated('J1')).toBe(false);
    usePipelineStore.getState().moveDeal(d.id, 'Submitted');
    // THE INVARIANT (D-042): complete fee + advanced deal, NOT seeded ⇒
    // no calibration, no ₪, snapshot stays null.
    expect(isMandateCalibrated('J1')).toBe(false);
    expect(qualifiedPipelineSnapshot().qualifiedEV).toBeNull();
    expect(qualifiedPipelineSnapshot().uncalibratedJobIds).toEqual(['J1']);

    // Seeding is the last gate — now all three hold.
    useMoneyStore.getState().markMandateSeeded('J1');
    expect(isMandateCalibrated('J1')).toBe(true);

    const snap = qualifiedPipelineSnapshot();
    expect(snap.qualifiedEV).toBeCloseTo(100_000 * 0.275, 6);
    expect(snap.calibratedJobIds).toEqual(['J1']);
  });

  it('clearing the fee de-calibrates a seeded mandate (gates stay independent)', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'GilShahar' });
    usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'J1',
      jobTitle: 'Backend',
      stage: 'Offer',
    });
    useMoneyStore
      .getState()
      .setFee({ jobId: 'J1', kind: 'fixed', fixedAmount: 50_000 });
    useMoneyStore.getState().markMandateSeeded('J1');
    expect(isMandateCalibrated('J1')).toBe(true);

    useMoneyStore.getState().clearFee('J1');
    expect(isMandateCalibrated('J1')).toBe(false);
    expect(isMandateSeeded('J1')).toBe(true); // seeding survives fee edits
  });
});
