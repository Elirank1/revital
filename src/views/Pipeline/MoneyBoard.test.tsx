// @vitest-environment jsdom
/**
 * MoneyBoard swimlanes DOM tests (jsdom) — kanban-ui, Wave 2.
 *
 * Lanes per mandate with the SAME DealCard component, calibrated-first
 * ordering, lane ΣEV for calibrated mandates only, and the lane fee
 * button → FeeCapture → lane becomes calibrated live.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import {
  DEFAULT_STAGE_PRIORS,
  useMoneyStore,
  type MandateFee,
} from '../../lib/money';
import type { Deal, DealStage } from '../../types/pipeline';
import { MoneyBoard, buildMandateLanes } from './MoneyBoard';
import { resetMoneyStore, resetPipelineStore, seedFee } from './storeTestKit';

/** Wave-3 C-seed seam (platform-data, lead-granted): calibration now ALSO
 *  requires the mandate to be seeded (D-042). Marks run per-test because
 *  the beforeEach reset clears the seeding state. */
function markSeeded(...jobIds: string[]): void {
  for (const jobId of jobIds) {
    useMoneyStore.getState().markMandateSeeded(jobId);
  }
}

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});
afterEach(cleanup);

function seedMandate(jobId: string, title: string, name: string, stages: DealStage[]) {
  const { person } = usePipelineStore.getState().addPerson({ name });
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

describe('buildMandateLanes (pure)', () => {
  function d(over: Partial<Deal> & { id: string; jobId: string; stage: DealStage }): Deal {
    return {
      v: 0,
      updatedAt: '2026-07-01T00:00:00.000Z',
      personId: 'p1',
      jobTitle: 'T',
      stageEnteredAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      ...over,
    };
  }
  const fee: MandateFee = {
    jobId: 'A',
    kind: 'fixed',
    fixedAmount: 50_000,
    currency: 'ILS',
    guaranteeDays: 0,
    invoiceStatus: 'none',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };

  it('groups live pipeline deals per mandate, excludes Bench/Rejected/tombstones', () => {
    const lanes = buildMandateLanes(
      [
        d({ id: '1', jobId: 'A', stage: 'Submitted' }),
        d({ id: '2', jobId: 'A', stage: 'Bench' }),
        d({ id: '3', jobId: 'A', stage: 'Rejected' }),
        d({ id: '4', jobId: 'B', stage: 'Sourced' }),
        d({ id: '5', jobId: 'B', stage: 'Outreach', deleted: true }),
      ],
      {},
      DEFAULT_STAGE_PRIORS,
    );
    expect(lanes).toHaveLength(2);
    expect(lanes.map((l) => l.deals.length)).toEqual([1, 1]);
  });

  it('orders calibrated lanes first, by EV midpoint desc; deals by stage order', () => {
    markSeeded('A', 'NOFEE'); // NOFEE stays uncalibrated purely on its missing fee
    const lanes = buildMandateLanes(
      [
        d({ id: '1', jobId: 'NOFEE', stage: 'Submitted', jobTitle: 'אאא' }),
        d({ id: '2', jobId: 'A', stage: 'Submitted' }),
        d({ id: '3', jobId: 'A', stage: 'Outreach' }),
      ],
      { A: fee },
      DEFAULT_STAGE_PRIORS,
    );
    expect(lanes[0].jobId).toBe('A');
    expect(lanes[0].calibrated).toBe(true);
    expect(lanes[0].deals.map((x) => x.stage)).toEqual(['Outreach', 'Submitted']);
    expect(lanes[1].jobId).toBe('NOFEE');
    expect(lanes[1].calibrated).toBe(false);
    expect(lanes[1].evRange).toBeNull();
  });
});

describe('MoneyBoard rendering', () => {
  it('renders a lane per mandate using the same DealCard component', () => {
    seedMandate('M1', 'Backend Engineer', 'נועה כהן', ['Submitted', 'Outreach']);
    seedMandate('M2', 'QA Lead', 'דנה לוי', ['Sourced']);
    render(<MoneyBoard />);
    const lane1 = screen.getByTestId('lane-M1');
    expect(within(lane1).getAllByTestId('deal-card')).toHaveLength(2);
    expect(within(screen.getByTestId('lane-M2')).getAllByTestId('deal-card')).toHaveLength(1);
    // stage chips label each card
    expect(lane1.textContent).toContain('הוגשו');
    expect(lane1.textContent).toContain('פנייה');
  });

  it('shows lane ΣEV for calibrated mandates and a badge (no ₪) otherwise', () => {
    seedMandate('M1', 'Backend Engineer', 'נועה כהן', ['Submitted']);
    seedMandate('M2', 'QA Lead', 'דנה לוי', ['Outreach']);
    seedFee({ jobId: 'M1', kind: 'fixed', fixedAmount: 50_000 });
    render(<MoneyBoard />);
    // 50,000 × Submitted {0.2..0.35} = 10,000–17,500
    expect(screen.getByTestId('lane-ev-M1').textContent).toBe('₪10,000–₪17,500');
    expect(screen.getByTestId('lane-M2').textContent).not.toContain('₪');
    expect(screen.getByTestId('lane-uncalibrated-M2')).toBeTruthy();
  });

  it('lane fee button opens FeeCapture; saving calibrates the lane live', () => {
    seedMandate('M3', 'DevOps', 'אבי גל', ['InConversation']);
    // C-seed: the wizard has already seeded M3 — the fee is the one
    // remaining gate, so saving it flips the lane live (as before).
    markSeeded('M3');
    render(<MoneyBoard />);
    expect(screen.getByTestId('lane-uncalibrated-M3')).toBeTruthy();

    fireEvent.click(screen.getByTestId('lane-fee-button-M3'));
    const modal = screen.getByTestId('fee-capture');
    fireEvent.click(within(modal).getByTestId('fee-kind-fixed'));
    fireEvent.change(within(modal).getByTestId('fee-fixed'), {
      target: { value: '40000' },
    });
    fireEvent.click(within(modal).getByTestId('fee-save'));

    expect(screen.queryByTestId('fee-capture')).toBeNull();
    // 40,000 × InConversation {0.1..0.18} = 4,000–7,200
    expect(screen.getByTestId('lane-ev-M3').textContent).toBe('₪4,000–₪7,200');
    expect(screen.queryByTestId('lane-uncalibrated-M3')).toBeNull();
  });
});
