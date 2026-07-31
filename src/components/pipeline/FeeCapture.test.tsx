// @vitest-environment jsdom
/**
 * FeeCapture modal DOM tests (jsdom) — kanban-ui, Wave 2.
 *
 * Real money store: save flows (percent / fixed / invoice fields) write
 * through `setFee` (audited), cancel mutates nothing, prefill round-trips,
 * and the computed preview appears only for a COMPLETE draft (never 0).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { useMoneyStore } from '../../lib/money';
import { FeeCapture } from './FeeCapture';
import {
  resetMoneyStore,
  resetPipelineStore,
  seedFee,
} from '../../views/Pipeline/storeTestKit';

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});
afterEach(cleanup);

describe('percent fee flow', () => {
  it('saves kind/percent/salary via the store (audited) and closes', () => {
    const onClose = vi.fn();
    render(<FeeCapture jobId="J1" jobTitle="Senior Backend" onClose={onClose} />);

    fireEvent.change(screen.getByTestId('fee-percent'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('fee-salary'), { target: { value: '480000' } });
    fireEvent.click(screen.getByTestId('fee-save'));

    const fee = useMoneyStore.getState().fees.J1;
    expect(fee).toMatchObject({
      jobId: 'J1',
      kind: 'percent',
      percent: 20,
      expectedSalary: 480_000,
      currency: 'ILS',
      invoiceStatus: 'none',
    });
    const audit = usePipelineStore.getState().auditLog;
    expect(audit[audit.length - 1]).toMatchObject({
      action: 'fee.set',
      entityType: 'mandate',
      entityId: 'J1',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the computed preview only once the draft is complete', () => {
    render(<FeeCapture jobId="J1" jobTitle="Backend" onClose={() => {}} />);
    expect(screen.queryByTestId('fee-preview')).toBeNull();
    fireEvent.change(screen.getByTestId('fee-percent'), { target: { value: '20' } });
    expect(screen.queryByTestId('fee-preview')).toBeNull(); // still incomplete
    fireEvent.change(screen.getByTestId('fee-salary'), { target: { value: '480000' } });
    expect(screen.getByTestId('fee-preview').textContent).toBe('₪96,000');
  });
});

describe('fixed fee + invoice fields', () => {
  it('saves a fixed fee with invoice status and due date', () => {
    render(<FeeCapture jobId="J2" jobTitle="QA Lead" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('fee-kind-fixed'));
    fireEvent.change(screen.getByTestId('fee-fixed'), { target: { value: '35000' } });
    fireEvent.change(screen.getByTestId('fee-guarantee'), { target: { value: '60' } });
    fireEvent.change(screen.getByTestId('fee-invoice-status'), {
      target: { value: 'due' },
    });
    fireEvent.change(screen.getByTestId('fee-invoice-due'), {
      target: { value: '2026-08-15' },
    });
    fireEvent.click(screen.getByTestId('fee-save'));

    expect(useMoneyStore.getState().fees.J2).toMatchObject({
      kind: 'fixed',
      fixedAmount: 35_000,
      guaranteeDays: 60,
      invoiceStatus: 'due',
      invoiceDueAt: '2026-08-15',
    });
  });
});

describe('cancel / prefill', () => {
  it('cancel closes without any store mutation', () => {
    const onClose = vi.fn();
    render(<FeeCapture jobId="J3" jobTitle="PM" onClose={onClose} />);
    fireEvent.change(screen.getByTestId('fee-percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('fee-cancel'));
    expect(useMoneyStore.getState().fees.J3).toBeUndefined();
    expect(usePipelineStore.getState().auditLog).toHaveLength(0);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('prefills from the existing mandate fee', () => {
    seedFee({
      jobId: 'J4',
      kind: 'percent',
      percent: 18,
      expectedSalary: 400_000,
      guaranteeDays: 90,
      invoiceStatus: 'sent',
      invoiceDueAt: '2026-09-01',
    });
    render(<FeeCapture jobId="J4" jobTitle="Data" onClose={() => {}} />);
    expect((screen.getByTestId('fee-percent') as HTMLInputElement).value).toBe('18');
    expect((screen.getByTestId('fee-salary') as HTMLInputElement).value).toBe('400000');
    expect((screen.getByTestId('fee-guarantee') as HTMLInputElement).value).toBe('90');
    expect((screen.getByTestId('fee-invoice-status') as HTMLSelectElement).value).toBe(
      'sent',
    );
    expect((screen.getByTestId('fee-invoice-due') as HTMLInputElement).value).toBe(
      '2026-09-01',
    );
  });

  it('Escape closes without saving', () => {
    const onClose = vi.fn();
    render(<FeeCapture jobId="J5" jobTitle="X" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(useMoneyStore.getState().fees.J5).toBeUndefined();
  });

  it('placed context announces the placement', () => {
    render(
      <FeeCapture jobId="J6" jobTitle="DevOps" context="placed" onClose={() => {}} />,
    );
    expect(screen.getByTestId('fee-capture').textContent).toContain('הושמה');
  });
});
