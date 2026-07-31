// @vitest-environment jsdom
/**
 * TodayView Pit Boss ranking DOM tests (jsdom) — kanban-ui, Wave 2.
 *
 * Mock-ranker tests pin the UI semantics against the bridge's narrow
 * type (order, ₪ gating, wa.me links, fallbacks); one integration test
 * renders the DEFAULT ranker — the LIVE `src/agents/pitboss.ts` through
 * pitbossBridge (flipped in-batch when agents-engine landed it).
 * Covered: ranked order + ₪ at-risk (calibrated only), accepted
 * pre-drafted wa.me link (G4: inert <a href>), pending-draft chip, and
 * the fallback to the Wave-1 aging ranking when the ranker is absent or
 * throws.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { TodayView } from './TodayView';
import type { RankMoveTheMoneyFn } from './pitbossBridge';
import {
  backdateDeal,
  resetMoneyStore,
  resetPipelineStore,
  seedFee,
} from './storeTestKit';

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});
afterEach(cleanup);

function seedCalibratedDeal(jobId: string, name: string, phone?: string) {
  const store = usePipelineStore.getState();
  const { person } = store.addPerson({ name, phone });
  const deal = usePipelineStore.getState().addDeal({
    personId: person.id,
    jobId,
    jobTitle: 'Backend Engineer',
    stage: 'Submitted',
  });
  seedFee({ jobId, kind: 'fixed', fixedAmount: 50_000 });
  return { person, deal };
}

describe('ranked "move the money" section', () => {
  it('renders items in the ranker order with formatted ₪ at-risk and reasons', () => {
    const a = seedCalibratedDeal('J1', 'נועה כהן');
    const b = seedCalibratedDeal('J2', 'דנה לוי');
    const rank: RankMoveTheMoneyFn = () => [
      { dealId: b.deal.id, evAtRisk: 50_000, reasons: [{ claim: 'משוב לקוח באיחור 8 ימים' }] },
      { dealId: a.deal.id, evAtRisk: 20_000, reasons: [] },
    ];
    render(<TodayView rankMoveTheMoney={rank} />);
    const rows = screen.getAllByTestId('mtm-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('דנה לוי');
    expect(rows[0].textContent).toContain('₪50,000');
    expect(rows[0].textContent).toContain('משוב לקוח באיחור 8 ימים');
    expect(rows[1].textContent).toContain('נועה כהן');
    expect(rows[1].textContent).toContain('₪20,000');
  });

  it('drops items whose deal is unknown, tombstoned, or uncalibrated', () => {
    const a = seedCalibratedDeal('J1', 'נועה כהן');
    // uncalibrated mandate (no fee)
    const { person } = usePipelineStore.getState().addPerson({ name: 'אבי גל' });
    const uncal = usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'NOFEE',
      jobTitle: 'QA',
      stage: 'Submitted',
    });
    const rank: RankMoveTheMoneyFn = () => [
      { dealId: uncal.id, evAtRisk: 99_999, reasons: [] },
      { dealId: 'ghost', evAtRisk: 5, reasons: [] },
      { dealId: a.deal.id, evAtRisk: 20_000, reasons: [] },
    ];
    render(<TodayView rankMoveTheMoney={rank} />);
    const rows = screen.getAllByTestId('mtm-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('נועה כהן');
    expect(screen.queryByText(/99,999/)).toBeNull();
  });

  it('carries the accepted pre-drafted wa.me link as an inert <a href>', () => {
    const a = seedCalibratedDeal('J1', 'נועה כהן', '0501234567');
    const sug = usePipelineStore.getState().addSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      dealId: a.deal.id,
      personId: a.person.id,
      title: 'טיוטה לנועה',
      body: 'היי נועה, מה שלומך?',
    });
    usePipelineStore.getState().acceptSuggestion(sug.id);
    const rank: RankMoveTheMoneyFn = () => [
      { dealId: a.deal.id, evAtRisk: 20_000, reasons: [] },
    ];
    render(<TodayView rankMoveTheMoney={rank} />);
    const link = screen.getByTestId('mtm-wa-link') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toContain('wa.me');
    expect(link.getAttribute('href')).toContain(encodeURIComponent('היי נועה'));
  });

  it('shows an awaiting-approval chip for a PENDING draft — never a send link', () => {
    const a = seedCalibratedDeal('J1', 'נועה כהן', '0501234567');
    usePipelineStore.getState().addSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      dealId: a.deal.id,
      personId: a.person.id,
      title: 'טיוטה לנועה',
      body: 'היי נועה',
    });
    const rank: RankMoveTheMoneyFn = () => [
      { dealId: a.deal.id, evAtRisk: 20_000, reasons: [] },
    ];
    render(<TodayView rankMoveTheMoney={rank} />);
    expect(screen.queryByTestId('mtm-wa-link')).toBeNull();
    expect(screen.getByTestId('mtm-pending-draft')).toBeTruthy();
  });
});

describe('LIVE Pit Boss through the default bridge', () => {
  it('a calibrated Submitted deal 8 days without feedback ranks with ₪ at risk', () => {
    const a = seedCalibratedDeal('J1', 'נועה כהן');
    backdateDeal(a.deal.id, 8); // > 6d feedback threshold
    render(<TodayView />); // DEFAULT ranker = real pitboss via the bridge
    const rows = screen.getAllByTestId('mtm-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('נועה כהן');
    expect(rows[0].textContent).toContain('₪'); // calibrated ⇒ ₪ allowed
    expect(rows[0].textContent).toContain('ללא משוב לקוח'); // pitboss claim
  });

  it('the same deal UNCALIBRATED never surfaces a ₪ through the live ranker', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'דנה לוי' });
    const deal = usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'NOFEE',
      jobTitle: 'QA Lead',
      stage: 'Submitted',
    });
    backdateDeal(deal.id, 8);
    const { container } = render(<TodayView />);
    expect(container.textContent).not.toContain('₪');
    expect(screen.queryAllByTestId('mtm-row')).toHaveLength(0);
  });
});

describe('fallback to the Wave-1 aging ranking', () => {
  it('null ranker (bridge not yet flipped) renders the aging section', () => {
    seedCalibratedDeal('J1', 'נועה כהן');
    render(<TodayView rankMoveTheMoney={null} />);
    expect(screen.queryAllByTestId('mtm-row')).toHaveLength(0);
    expect(screen.getByText('תקועות הכי הרבה זמן')).toBeTruthy();
    expect(screen.getAllByTestId('at-risk-row')).toHaveLength(1);
  });

  it('a throwing ranker falls back instead of taking Today down', () => {
    seedCalibratedDeal('J1', 'נועה כהן');
    const rank: RankMoveTheMoneyFn = () => {
      throw new Error('pitboss exploded');
    };
    render(<TodayView rankMoveTheMoney={rank} />);
    expect(screen.getByText('תקועות הכי הרבה זמן')).toBeTruthy();
    expect(screen.getAllByTestId('at-risk-row')).toHaveLength(1);
  });
});
