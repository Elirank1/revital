// @vitest-environment jsdom
/**
 * Calibration leak sweep (jsdom) — kanban-ui, Wave 2.
 *
 * THE hard rule: an uncalibrated mandate shows NO ₪ anywhere — header
 * money block, deal cards, column ΣEV, Money Board, Today — never 0,
 * never a placeholder amount. This suite sweeps every surface with two
 * uncalibrated shapes (no fee at all; complete fee but nothing past
 * Screened), then calibrates ONE mandate and asserts ₪ appears exactly
 * where it may — while the uncalibrated mandates stay ₪-free.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { useMoneyStore } from '../../lib/money';
import type { DealStage } from '../../types/pipeline';
import { PipelineView } from './PipelineView';
import { TodayView } from './TodayView';
import { resetMoneyStore, resetPipelineStore, seedFee } from './storeTestKit';

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});
afterEach(cleanup);

function seedMandate(jobId: string, title: string, name: string, stages: DealStage[]) {
  const store = usePipelineStore.getState();
  const { person } = store.addPerson({ name });
  const deals = stages.map((stage) =>
    usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId,
      jobTitle: title,
      stage,
    }),
  );
  return { person, deals };
}

describe('uncalibrated board: not a single ₪ on any surface', () => {
  beforeEach(() => {
    // U1: no fee at all, deals deep into the pipeline (incl. Submitted+).
    seedMandate('U1', 'Backend Engineer', 'נועה כהן', ['Sourced', 'Submitted', 'Offer']);
    // U2: complete fee BUT nothing past Screened — still uncalibrated.
    seedMandate('U2', 'Data Engineer', 'דנה לוי', ['Sourced', 'Screened']);
    seedFee({ jobId: 'U2', kind: 'percent', percent: 20, expectedSalary: 480_000 });
  });

  it('board tab: header, columns and cards are ₪-free; ΣEV placeholder intact', () => {
    const { container } = render(<PipelineView />);
    expect(container.textContent).not.toContain('₪');
    expect(screen.getByTestId('money-header').textContent).toContain('מצב כיול');
    expect(screen.getByTestId('column-Submitted').textContent).toContain('ΣEV —');
    expect(screen.queryAllByTestId('ev-chip')).toHaveLength(0);
  });

  it('money tab: lanes are ₪-free and marked uncalibrated', () => {
    const { container } = render(<PipelineView />);
    fireEvent.click(screen.getByTestId('tab-money'));
    expect(container.textContent).not.toContain('₪');
    expect(screen.getByTestId('lane-uncalibrated-U1')).toBeTruthy();
    expect(screen.getByTestId('lane-uncalibrated-U2')).toBeTruthy();
    expect(screen.queryByTestId('lane-ev-U1')).toBeNull();
    expect(screen.queryByTestId('lane-ev-U2')).toBeNull();
  });

  it('today tab (LIVE Pit Boss ranker over the uncalibrated board): ₪-free', () => {
    const { container } = render(<PipelineView />);
    fireEvent.click(screen.getByText('היום'));
    expect(container.textContent).not.toContain('₪');
  });

  it('today with an injected ranker leaking uncalibrated items: rows dropped, no ₪', () => {
    const dealId = usePipelineStore.getState().deals[1].id; // U1's Submitted deal
    const { container } = render(
      <TodayView
        rankMoveTheMoney={() => [
          { dealId, evAtRisk: 12_345, reasons: [{ claim: 'aging 9d × EV' }] },
        ]}
      />,
    );
    expect(container.textContent).not.toContain('₪');
    expect(screen.queryAllByTestId('mtm-row')).toHaveLength(0);
    expect(screen.getByText('אין עסקאות מכוילות בסיכון.')).toBeTruthy();
  });
});

describe('calibrating one mandate lights ₪ exactly there — and nowhere else', () => {
  beforeEach(() => {
    seedMandate('U1', 'Backend Engineer', 'נועה כהן', ['Submitted']);
    // C1 becomes calibrated: complete fee + deals past Screened.
    seedMandate('C1', 'Frontend Lead', 'יוסי מזרחי', ['Outreach', 'Submitted']);
    seedFee({ jobId: 'C1', kind: 'percent', percent: 20, expectedSalary: 480_000 });
  });

  it('header: qualified ₪ (Submitted+ point Σ) + early-stage range footnote', () => {
    render(<PipelineView />);
    // fee 96,000 × Submitted midpoint 0.275 = 26,400
    expect(screen.getByTestId('qualified-ev').textContent).toContain('₪26,400');
    // early: Outreach {5%..10%} × 96,000 = 4,800–9,600
    expect(screen.getByTestId('early-range').textContent).toContain('₪4,800–₪9,600');
    expect(screen.getByTestId('money-header').textContent).not.toContain('מצב כיול');
  });

  it('cards: EV range chip on the calibrated deal only', () => {
    render(<PipelineView />);
    const submitted = screen.getByTestId('column-Submitted');
    const cards = within(submitted).getAllByTestId('deal-card');
    expect(cards).toHaveLength(2);
    const chips = within(submitted).getAllByTestId('ev-chip');
    expect(chips).toHaveLength(1); // C1 yes, U1 no
    expect(chips[0].textContent).toBe('₪19,200–₪33,600');
    const u1Card = cards.find((c) => c.textContent?.includes('נועה כהן'));
    expect(u1Card?.textContent).not.toContain('₪');
  });

  it('columns: ΣEV renders on calibrated columns, placeholder stays elsewhere', () => {
    render(<PipelineView />);
    expect(screen.getByTestId('ev-Submitted').textContent).toBe('ΣEV ₪19,200–₪33,600');
    expect(screen.getByTestId('ev-Outreach').textContent).toBe('ΣEV ₪4,800–₪9,600');
    // A column with no calibrated deal keeps the truthful placeholder.
    expect(screen.getByTestId('column-Sourced').textContent).toContain('ΣEV —');
  });

  it('money board: calibrated lane shows Σ, uncalibrated lane stays ₪-free', () => {
    render(<PipelineView />);
    fireEvent.click(screen.getByTestId('tab-money'));
    const evC1 = screen.getByTestId('lane-ev-C1');
    // lane Σ = Outreach (4,800–9,600) + Submitted (19,200–33,600)
    expect(evC1.textContent).toBe('₪24,000–₪43,200');
    const laneU1 = screen.getByTestId('lane-U1');
    expect(laneU1.textContent).not.toContain('₪');
    expect(screen.getByTestId('lane-uncalibrated-U1')).toBeTruthy();
  });

  it('removing the fee returns the mandate to calibration mode everywhere', () => {
    render(<PipelineView />);
    expect(screen.getByTestId('qualified-ev')).toBeTruthy();
    act(() => {
      useMoneyStore.getState().clearFee('C1');
    });
    expect(screen.queryByTestId('qualified-ev')).toBeNull();
    expect(screen.getByTestId('money-header').textContent).toContain('מצב כיול');
    expect(screen.queryAllByTestId('ev-chip')).toHaveLength(0);
  });
});
