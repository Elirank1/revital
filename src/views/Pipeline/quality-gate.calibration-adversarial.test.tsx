// @vitest-environment jsdom
/**
 * Adversarial calibration sweep (quality-gate, Wave 2 batch C).
 *
 * The hard rule (wave2-contract §Fee/EV): an uncalibrated mandate shows
 * NO ₪ anywhere — never 0, never a guess. kanban-ui's own sweep covers
 * the two friendly shapes; this suite attacks the rule with ELEVEN
 * hostile mandate shapes at once, every one uncalibrated for a different
 * reason:
 *
 *   m1  no fee at all                       (deal past Screened)
 *   m2  percent without expectedSalary      (deal past Screened)
 *   m3  percent with expectedSalary = 0     (deal past Screened)
 *   m4  fixed with fixedAmount = 0          (deal past Screened, at-risk)
 *   m5  fixed with a NEGATIVE amount        (deal past Screened, at-risk)
 *   m6  fixed with NaN                      (deal past Screened)
 *   m7  fixed with Infinity                 (deal past Screened)
 *   m8  COMPLETE fee, nothing past Screened (Sourced + Screened only)
 *   m9  COMPLETE fee, only past-Screened deal is TOMBSTONED
 *   m10 COMPLETE fee, past-Screened journey ended in Rejected
 *   m11 unknown fee kind (corrupt value smuggled through the store)
 *
 * Surfaces swept for the ₪ character: header money block, board columns
 * and cards, Money Board lanes, Today view, the inbox rendering a
 * SERVER-SHAPED money-free suggestion (built by the same functions the
 * tick uses, over empty fees), and the Client Reporter output (text,
 * HTML, title, evidence).
 *
 * Sensitivity control: repairing exactly one mandate's fee makes ₪
 * appear where allowed — proving the sweep can actually see ₪ and is
 * not vacuously green.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JobDescription } from '../../types';
import { usePipelineStore } from '../../store/pipelineStore';
import { useMoneyStore } from '../../lib/money';
import { rankMoveTheMoney, pitBossSuggestionInput } from '../../agents/pitboss';
import { buildMandateReport } from '../../reporting/mandateReport';
import { PipelineView } from './PipelineView';
import { resetMoneyStore, resetPipelineStore, seedFee } from './storeTestKit';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});

afterEach(() => {
  cleanup();
});

function addDealFor(name: string, jobId: string, stage: string) {
  const store = usePipelineStore.getState();
  const { person } = store.addPerson({ name });
  const deal = store.addDeal({
    personId: person.id,
    jobId,
    jobTitle: `משרה ${jobId}`,
    stage: stage as never,
  });
  return { person, deal };
}

function backdate(dealId: string, days: number): void {
  usePipelineStore.setState((s) => ({
    deals: s.deals.map((d) =>
      d.id === dealId
        ? { ...d, stageEnteredAt: new Date(Date.now() - days * DAY_MS).toISOString() }
        : d,
    ),
  }));
}

/** Seed the eleven hostile mandates. Returns m4's deal id (risk-carrier). */
function seedAdversarialBoard(): { atRiskDealId: string } {
  addDealFor('אחד כהן', 'm1', 'Offer'); // no fee at all
  addDealFor('שניים לוי', 'm2', 'ClientInterview');
  seedFee({ jobId: 'm2', kind: 'percent', percent: 20 }); // no salary
  addDealFor('שלושה מזרחי', 'm3', 'Submitted');
  seedFee({ jobId: 'm3', kind: 'percent', percent: 20, expectedSalary: 0 });
  const m4 = addDealFor('ארבעה פרץ', 'm4', 'Submitted');
  seedFee({ jobId: 'm4', kind: 'fixed', fixedAmount: 0 });
  backdate(m4.deal.id, 10); // real risk on an uncalibrated mandate
  const m5 = addDealFor('חמישה ביטון', 'm5', 'Offer');
  seedFee({ jobId: 'm5', kind: 'fixed', fixedAmount: -5000 });
  backdate(m5.deal.id, 5); // decaying offer, still no ₪ allowed
  addDealFor('שישה אזולאי', 'm6', 'ClientInterview');
  seedFee({ jobId: 'm6', kind: 'fixed', fixedAmount: Number.NaN });
  addDealFor('שבעה גבאי', 'm7', 'Submitted');
  seedFee({ jobId: 'm7', kind: 'fixed', fixedAmount: Number.POSITIVE_INFINITY });
  // m8: complete fee, but nothing past Screened.
  addDealFor('שמונה חדד', 'm8', 'Sourced');
  addDealFor('שמונה-ב חדד', 'm8', 'Screened');
  seedFee({ jobId: 'm8', kind: 'fixed', fixedAmount: 25_000 });
  // m9: complete fee; the only past-Screened deal is tombstoned.
  const m9 = addDealFor('תשעה עמר', 'm9', 'Offer');
  addDealFor('תשעה-ב עמר', 'm9', 'Screened');
  usePipelineStore.getState().deleteDeal(m9.deal.id);
  seedFee({ jobId: 'm9', kind: 'fixed', fixedAmount: 25_000 });
  // m10: complete fee; the past-Screened journey ended in Rejected.
  const m10 = addDealFor('עשרה דהן', 'm10', 'Submitted');
  usePipelineStore
    .getState()
    .moveDeal(m10.deal.id, 'Rejected', { reason: 'הלקוח דחה את המועמדות' });
  addDealFor('עשרה-ב דהן', 'm10', 'Sourced'); // keeps a live lane visible
  seedFee({ jobId: 'm10', kind: 'fixed', fixedAmount: 25_000 });
  // m11: unknown fee kind smuggled through the store (corrupt persisted
  // value shape) — feeAmount must fall through to null.
  addDealFor('אחד-עשר סבן', 'm11', 'Submitted');
  seedFee({ jobId: 'm11', kind: 'mystery' as never, fixedAmount: 25_000 });

  return { atRiskDealId: m4.deal.id };
}

describe('adversarial calibration sweep — no ₪ may leak anywhere', () => {
  it('board, header, columns, cards: zero ₪ across all eleven shapes', () => {
    seedAdversarialBoard();
    const { container } = render(<PipelineView />);

    expect(container.textContent).not.toContain('₪');
    expect(screen.getByTestId('calibration-hint').textContent).toContain('מצב כיול');
    // Columns keep the truthful placeholder, never a number (the ev-<stage>
    // testid exists only when a ₪ figure renders — it must be absent).
    expect(screen.queryByTestId('ev-Submitted')).toBeNull();
    expect(screen.queryByTestId('ev-Offer')).toBeNull();
    expect(screen.getByTestId('column-Submitted').textContent).toContain('ΣEV —');
    expect(screen.getByTestId('column-Offer').textContent).toContain('ΣEV —');
    expect(screen.queryAllByTestId('ev-chip')).toHaveLength(0);
  });

  it('Money Board: every lane wears ללא כיול, none shows a lane EV', () => {
    seedAdversarialBoard();
    const { container } = render(<PipelineView />);
    fireEvent.click(screen.getByTestId('tab-money'));

    expect(container.textContent).not.toContain('₪');
    const badges = screen.getAllByTestId(/^lane-uncalibrated-/);
    expect(badges.length).toBeGreaterThanOrEqual(10); // m10's rejected-only? — Sourced deal keeps its lane
    for (const badge of badges) {
      expect(badge.textContent).toContain('ללא כיול');
    }
    expect(screen.queryAllByTestId(/^lane-ev-/)).toHaveLength(0);
  });

  it('Today: real risk on uncalibrated mandates ranks nothing with ₪', () => {
    seedAdversarialBoard();
    const { container } = render(<PipelineView />);
    fireEvent.click(screen.getByText('היום'));

    // m4 (10d Submitted) and m5 (5d Offer) genuinely rank server-side —
    // the UI must DROP them rather than print their ₪0/₪-less figures.
    expect(screen.queryAllByTestId('mtm-row')).toHaveLength(0);
    expect(screen.queryAllByTestId('mtm-ev')).toHaveLength(0);
    expect(container.textContent).not.toContain('₪');
  });

  it('server-shaped suggestions (empty fees, tick construction path) render ₪-free in the inbox', () => {
    seedAdversarialBoard();
    const { deals, persons } = usePipelineStore.getState();
    const { priors } = useMoneyStore.getState();

    // Exactly what the tick does: rank with EMPTY fees, build inputs.
    const items = rankMoveTheMoney(deals, {}, priors, [], new Date());
    expect(items.length).toBeGreaterThan(0);
    const byId = new Map(deals.map((d) => [d.id, d]));
    for (const item of items) {
      usePipelineStore
        .getState()
        .addSuggestion(pitBossSuggestionInput(item, byId.get(item.dealId)!));
    }

    const { container } = render(<PipelineView />);
    fireEvent.click(screen.getByTestId('inbox-badge'));
    const rendered = screen.getAllByTestId('suggestion-item');
    expect(rendered.length).toBe(items.length);
    expect(container.textContent).not.toContain('₪');
    // The suggestions still carry their numeric day-count evidence.
    expect(container.textContent).toMatch(/ימים/);
    expect(persons.length).toBeGreaterThan(0);
  });

  it('Client Reporter output carries no ₪ (text, HTML, title, evidence)', () => {
    seedAdversarialBoard();
    const { deals, stageEvents, persons } = usePipelineStore.getState();
    const mandate: JobDescription = {
      id: 'm4',
      title: 'ראש צוות דאטה',
      rawText: '',
      pillars: [],
      createdAt: new Date().toISOString(),
    };
    const report = buildMandateReport(mandate, deals, stageEvents, persons, {
      clientName: 'לקוח בדיקה',
    });

    // The nudge machinery IS active (m4's deal sits 10d in Submitted)…
    expect(report.text).toContain('ממתינים למשוב');
    // …and still: not a shekel sign anywhere in any rendering.
    expect(report.text).not.toContain('₪');
    expect(report.html).not.toContain('₪');
    expect(report.title).not.toContain('₪');
    expect(JSON.stringify(report.evidence)).not.toContain('₪');
  });

  it('sensitivity control: repairing ONE fee makes ₪ appear exactly there', () => {
    seedAdversarialBoard();
    // Repair m3: percent 20 × salary 150,000 → fee 30,000;
    // Submitted mid 0.275 → header qualified EV ₪8,250.
    seedFee({ jobId: 'm3', kind: 'percent', percent: 20, expectedSalary: 150_000 });

    render(<PipelineView />);
    expect(screen.getByTestId('qualified-ev').textContent).toContain('₪8,250');
    expect(screen.queryByTestId('calibration-hint')).toBeNull();

    // The other ten stay ₪-free on the Money Board.
    fireEvent.click(screen.getByTestId('tab-money'));
    expect(screen.getByTestId('lane-ev-m3').textContent).toContain('₪');
    for (const badge of screen.getAllByTestId(/^lane-uncalibrated-/)) {
      expect(badge.textContent).toContain('ללא כיול');
      expect(badge.textContent).not.toContain('₪');
    }
    const lanes = screen.getAllByTestId(/^lane-(?!ev-|uncalibrated-|fee-)/);
    for (const lane of lanes) {
      if (lane.getAttribute('data-testid') === 'lane-m3') continue;
      expect(lane.textContent).not.toContain('₪');
    }
  });
});
