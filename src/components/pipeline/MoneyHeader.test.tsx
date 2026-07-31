// @vitest-environment jsdom
/**
 * MoneyHeader + PriorsEditor DOM tests (jsdom) — kanban-ui, Wave 2.
 *
 * Header figures against the money lib over the live stores (qualified Σ,
 * expected-this-month from dated invoices, early range), and the priors
 * editor popover: percent editing → audited store write, invalid ranges
 * block save, reset restores defaults. Calibration-off is swept in
 * calibration-sweep.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { DEFAULT_STAGE_PRIORS, useMoneyStore } from '../../lib/money';
import { MoneyHeader } from './MoneyHeader';
import {
  resetMoneyStore,
  resetPipelineStore,
  seedFee,
} from '../../views/Pipeline/storeTestKit';

const NOW = () => new Date('2026-07-15T10:00:00.000Z').getTime();

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});
afterEach(cleanup);

function seedCalibrated(jobId: string, name: string) {
  const { person } = usePipelineStore.getState().addPerson({ name });
  usePipelineStore.getState().addDeal({
    personId: person.id,
    jobId,
    jobTitle: 'Backend Engineer',
    stage: 'Submitted',
  });
}

describe('header figures (calibrated)', () => {
  it('qualified Σ + expected-this-month from a dated outstanding invoice', () => {
    seedCalibrated('J1', 'נועה כהן');
    seedFee({
      jobId: 'J1',
      kind: 'fixed',
      fixedAmount: 50_000,
      invoiceStatus: 'due',
      invoiceDueAt: '2026-07-25',
    });
    render(<MoneyHeader now={NOW} />);
    // 50,000 × Submitted midpoint 0.275 = 13,750
    expect(screen.getByTestId('qualified-ev').textContent).toContain('₪13,750');
    expect(screen.getByTestId('expected-month').textContent).toContain('₪50,000');
  });

  it('no dated invoice this month → an honest "none" line, no ₪0', () => {
    seedCalibrated('J1', 'נועה כהן');
    seedFee({ jobId: 'J1', kind: 'fixed', fixedAmount: 50_000 });
    render(<MoneyHeader now={NOW} />);
    const month = screen.getByTestId('expected-month');
    expect(month.textContent).toContain('אין חשבוניות מתוארכות');
    expect(month.textContent).not.toContain('₪');
  });
});

describe('priors editor popover', () => {
  it('edits a stage range in percent → audited store write in 0..1', () => {
    render(<MoneyHeader now={NOW} />);
    fireEvent.click(screen.getByTestId('priors-button'));
    fireEvent.change(screen.getByTestId('prior-lo-Submitted'), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByTestId('prior-hi-Submitted'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByTestId('priors-save'));

    expect(useMoneyStore.getState().priors.Submitted).toEqual({ lo: 0.3, hi: 0.4 });
    // untouched stages stay default
    expect(useMoneyStore.getState().priors.Offer).toEqual(DEFAULT_STAGE_PRIORS.Offer);
    const audit = usePipelineStore.getState().auditLog;
    expect(audit[audit.length - 1]).toMatchObject({
      action: 'priors.set',
      entityId: 'Submitted',
    });
    expect(screen.queryByTestId('priors-editor')).toBeNull(); // closed on save
  });

  it('lo > hi blocks save', () => {
    render(<MoneyHeader now={NOW} />);
    fireEvent.click(screen.getByTestId('priors-button'));
    fireEvent.change(screen.getByTestId('prior-lo-Offer'), { target: { value: '80' } });
    fireEvent.change(screen.getByTestId('prior-hi-Offer'), { target: { value: '60' } });
    expect((screen.getByTestId('priors-save') as HTMLButtonElement).disabled).toBe(true);
    expect(useMoneyStore.getState().priors.Offer).toEqual(DEFAULT_STAGE_PRIORS.Offer);
  });

  it('reset restores the defaults (audited)', () => {
    useMoneyStore.getState().setStagePrior('Offer', { lo: 0.1, hi: 0.2 });
    render(<MoneyHeader now={NOW} />);
    fireEvent.click(screen.getByTestId('priors-button'));
    fireEvent.click(screen.getByTestId('priors-reset'));
    expect(useMoneyStore.getState().priors).toEqual(DEFAULT_STAGE_PRIORS);
    const audit = usePipelineStore.getState().auditLog;
    expect(audit[audit.length - 1]).toMatchObject({ action: 'priors.reset' });
  });
});
