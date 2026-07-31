// @vitest-environment jsdom
/**
 * PipelineView board DOM tests (jsdom) — kanban-ui, Wave 1.
 *
 * Real store, real components: flag gate, live columns + counts, the
 * calibration rule (no ₪ anywhere pre-Wave-2), the inbox badge/panel,
 * the board↔today tabs, and the live-subscription move/undo round-trip
 * (drag-end wiring itself is unit-tested in dragEnd.test.ts per the
 * task list — no full dnd simulation here).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { STAGE_COLUMNS } from '../../components/pipeline/stages';
import { PipelineView, feeCaptureForDrop } from './PipelineView';
import { resetMoneyStore, resetPipelineStore, seedPersonWithDeal } from './storeTestKit';

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});
afterEach(cleanup);

describe('flag gate', () => {
  it('renders nothing when the flag is off (default)', () => {
    resetPipelineStore({ enabled: false });
    const { container } = render(<PipelineView />);
    expect(container.innerHTML).toBe('');
  });
});

describe('board frame', () => {
  it('renders all 9 columns (Hebrew + English) and the Bench rail', () => {
    render(<PipelineView />);
    for (const stage of STAGE_COLUMNS) {
      const column = screen.getByTestId(`column-${stage.id}`);
      expect(column.textContent).toContain(stage.he);
      expect(column.textContent).toContain(stage.en);
    }
    expect(screen.getByTestId('bench-rail')).toBeTruthy();
  });

  it('shows counts only — no ₪ and no invented EV figures (calibration rule)', () => {
    seedPersonWithDeal({ name: 'נועה כהן', jobTitle: 'Backend Engineer', stage: 'Screened' });
    const { container } = render(<PipelineView />);
    expect(container.textContent).not.toContain('₪');
    // ΣEV placeholder present but empty (em dash), not a number.
    expect(screen.getByTestId('column-Screened').textContent).toContain('ΣEV —');
  });
});

describe('live store data', () => {
  it('renders seeded deals in their columns with correct counts', () => {
    seedPersonWithDeal({
      name: 'נועה כהן',
      phone: '0501234567',
      jobTitle: 'Senior Backend Engineer',
      stage: 'Screened',
    });
    render(<PipelineView />);
    expect(screen.getByTestId('count-Screened').textContent).toBe('1');
    expect(screen.getByTestId('count-Sourced').textContent).toBe('0');
    const column = screen.getByTestId('column-Screened');
    expect(within(column).getByText('נועה כהן')).toBeTruthy();
    expect(within(column).getByText('Senior Backend Engineer')).toBeTruthy();
  });

  it('re-renders on store moves and undo restores the prior column', () => {
    const { deal } = seedPersonWithDeal({
      name: 'דנה לוי',
      jobTitle: 'Data Engineer',
      stage: 'Screened',
    });
    render(<PipelineView />);
    act(() => {
      usePipelineStore.getState().moveDeal(deal.id, 'Submitted');
    });
    expect(screen.getByTestId('count-Submitted').textContent).toBe('1');
    expect(screen.getByTestId('count-Screened').textContent).toBe('0');
    expect(within(screen.getByTestId('column-Submitted')).getByText('דנה לוי')).toBeTruthy();

    act(() => {
      usePipelineStore.getState().undoLast();
    });
    expect(screen.getByTestId('count-Screened').textContent).toBe('1');
    expect(screen.getByTestId('count-Submitted').textContent).toBe('0');
  });

  it('shows benched persons on the Bench rail', () => {
    const { deal } = seedPersonWithDeal({
      name: 'יוסי מזרחי',
      jobTitle: 'DevOps',
      stage: 'Outreach',
    });
    act(() => {
      usePipelineStore.getState().moveDeal(deal.id, 'Rejected', { reason: 'לא רלוונטי' });
    });
    render(<PipelineView />);
    const rail = screen.getByTestId('bench-rail');
    expect(within(rail).getByText('יוסי מזרחי')).toBeTruthy();
    expect(within(rail).getByText('לא רלוונטי')).toBeTruthy();
  });
});

describe('inbox badge and panel', () => {
  it('shows the pending count and toggles the SuggestionsQueue panel', () => {
    usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'flag',
      title: 'שים לב: פער שכר',
      body: 'הציפייה גבוהה מהתקציב.',
    });
    render(<PipelineView />);
    expect(screen.getByTestId('inbox-badge-count').textContent).toBe('1');
    expect(screen.queryByTestId('suggestions-queue')).toBeNull();
    fireEvent.click(screen.getByTestId('inbox-badge'));
    const queue = screen.getByTestId('suggestions-queue');
    expect(within(queue).getByText('שים לב: פער שכר')).toBeTruthy();
    fireEvent.click(screen.getByTestId('inbox-badge'));
    expect(screen.queryByTestId('suggestions-queue')).toBeNull();
  });
});

describe('tabs', () => {
  it('switches between the board and the Today view', () => {
    render(<PipelineView />);
    expect(screen.queryByTestId('today-view')).toBeNull();
    fireEvent.click(screen.getByText('היום'));
    expect(screen.getByTestId('today-view')).toBeTruthy();
    expect(screen.queryByTestId('column-Sourced')).toBeNull();
    fireEvent.click(screen.getByText('לוח'));
    expect(screen.getByTestId('column-Sourced')).toBeTruthy();
  });

  it('switches to the Money Board via the "כסף" tab (Wave 2)', () => {
    render(<PipelineView />);
    fireEvent.click(screen.getByTestId('tab-money'));
    expect(screen.getByTestId('money-board')).toBeTruthy();
    expect(screen.queryByTestId('column-Sourced')).toBeNull();
    fireEvent.click(screen.getByText('לוח'));
    expect(screen.getByTestId('column-Sourced')).toBeTruthy();
  });
});

describe('feeCaptureForDrop (pure drag→Placed wiring, Wave 2)', () => {
  const deal = {
    id: 'd1',
    v: 0,
    updatedAt: 't',
    personId: 'p1',
    jobId: 'J9',
    jobTitle: 'Backend',
    stage: 'Offer' as const,
    stageEnteredAt: 't',
    createdAt: 't',
  };

  it('opens the fee modal exactly on a completed drop into Placed', () => {
    expect(
      feeCaptureForDrop({ moved: true, dealId: 'd1', from: 'Offer', to: 'Placed' }, deal),
    ).toEqual({ jobId: 'J9', jobTitle: 'Backend' });
  });

  it('no modal on other stages, refused moves, or an unknown deal', () => {
    expect(
      feeCaptureForDrop({ moved: true, dealId: 'd1', from: 'Offer', to: 'Paid' }, deal),
    ).toBeNull();
    expect(feeCaptureForDrop({ moved: false }, deal)).toBeNull();
    expect(
      feeCaptureForDrop({ moved: true, dealId: 'd1', from: 'Offer', to: 'Placed' }, undefined),
    ).toBeNull();
  });
});
