// @vitest-environment jsdom
/**
 * TodayView DOM tests (jsdom) — kanban-ui, Wave 1.
 *
 * Approvals queue (one-tap resolve via store) + at-risk ranking by
 * days-in-stage, and the 390px-first responsive layout (class
 * assertions per the task list: stacked by default, lg:flex-row up).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { TodayView, rankAtRiskDeals } from './TodayView';
import { backdateDeal, resetPipelineStore, seedPersonWithDeal, DAY_MS } from './storeTestKit';

beforeEach(() => resetPipelineStore());
afterEach(cleanup);

describe('responsive layout (390px-first)', () => {
  it('stacks sections by default and goes two-column only from lg', () => {
    render(<TodayView rankMoveTheMoney={null} />);
    const root = screen.getByTestId('today-view');
    expect(root.className).toContain('flex-col');
    expect(root.className).toContain('lg:flex-row');
    // Sections are full-width on mobile, half from lg.
    for (const section of Array.from(root.querySelectorAll('section'))) {
      expect(section.className).toContain('w-full');
      expect(section.className).toContain('lg:w-1/2');
    }
  });
});

describe('at-risk ranking', () => {
  it('ranks active deals by days-in-stage, longest-stuck first', () => {
    const a = seedPersonWithDeal({ name: 'נועה כהן', jobTitle: 'Backend', stage: 'Outreach' });
    const b = seedPersonWithDeal({ name: 'דנה לוי', jobTitle: 'Frontend', stage: 'Screened' });
    backdateDeal(a.deal.id, 7);
    backdateDeal(b.deal.id, 12);
    render(<TodayView rankMoveTheMoney={null} />);
    const rows = screen.getAllByTestId('at-risk-row');
    expect(rows.map((r) => r.getAttribute('data-days'))).toEqual(['12', '7']);
    expect(rows[0].textContent).toContain('דנה לוי');
    expect(rows[0].textContent).toContain('ימים בשלב');
  });

  it('excludes Placed/Paid/Bench/Rejected from the at-risk list', () => {
    const placed = seedPersonWithDeal({ name: 'אבי גל', jobTitle: 'QA', stage: 'Placed' });
    seedPersonWithDeal({ name: 'רוני בר', jobTitle: 'PM', stage: 'Offer' });
    backdateDeal(placed.deal.id, 30);
    render(<TodayView rankMoveTheMoney={null} />);
    const rows = screen.getAllByTestId('at-risk-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('רוני בר');
  });

  it('rankAtRiskDeals is pure and caps the list', () => {
    const now = Date.now();
    const deals = Array.from({ length: 15 }, (_, i) => ({
      id: `d${i}`,
      v: 0,
      updatedAt: 't',
      personId: 'p',
      jobId: 'j',
      jobTitle: 'T',
      stage: 'Sourced' as const,
      stageEnteredAt: new Date(now - i * DAY_MS).toISOString(),
      createdAt: 't',
    }));
    const ranked = rankAtRiskDeals(deals, now);
    expect(ranked).toHaveLength(10);
    expect(ranked[0].days).toBe(14);
  });
});

describe('approvals queue — one-tap resolve', () => {
  it('accepts a pending suggestion with one tap and removes the row', () => {
    const sug = usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'flag',
      title: 'לבדוק זמינות של נועה',
      body: '',
    });
    render(<TodayView rankMoveTheMoney={null} />);
    const row = screen.getByTestId('approval-row');
    expect(row.textContent).toContain('לבדוק זמינות של נועה');
    fireEvent.click(screen.getByText('אישור'));
    expect(
      usePipelineStore.getState().suggestions.find((s) => s.id === sug.id)?.status,
    ).toBe('accepted');
    expect(screen.queryByTestId('approval-row')).toBeNull();
    expect(screen.getByText('אין הצעות ממתינות.')).toBeTruthy();
  });

  it('dismisses with one tap', () => {
    const sug = usePipelineStore.getState().addSuggestion({
      agent: 'pit_boss',
      kind: 'next_action',
      title: 'להתקשר ללקוח',
      body: '',
    });
    render(<TodayView rankMoveTheMoney={null} />);
    fireEvent.click(screen.getByText('דחייה'));
    expect(
      usePipelineStore.getState().suggestions.find((s) => s.id === sug.id)?.status,
    ).toBe('dismissed');
  });
});
