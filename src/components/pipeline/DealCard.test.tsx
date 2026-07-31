// @vitest-environment jsdom
/**
 * DealCard DOM tests (jsdom) — kanban-ui, Wave 1.
 *
 * Covers: BiDi attrs on user content, the three reply chips → callback,
 * the wa.me anchor (G4: real <a href>, logging on click via the injected
 * ContactLogger — never window.open), aging-ring thresholds, the
 * pending-suggestion badge and the score/verdict chip.
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { Deal, Person, Suggestion } from '../../types/pipeline';
import type { ContactLogger } from '../../lib/outreach';
import { hashMessage } from '../../lib/outreach';
import { DealCard, REPLY_CHIPS } from './DealCard';

afterEach(cleanup);

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-31T12:00:00.000Z');

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'p1',
    v: 0,
    updatedAt: 'ts',
    name: 'נועה כהן',
    normalizedName: 'נועה כהן',
    phone: '050-1234567',
    analysisIds: [],
    contactEvents: [],
    ...overrides,
  };
}

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'd1',
    v: 0,
    updatedAt: 'ts',
    personId: 'p1',
    jobId: 'j1',
    jobTitle: 'Senior Backend Engineer',
    stage: 'Outreach',
    stageEnteredAt: new Date(NOW - 2 * DAY_MS).toISOString(),
    createdAt: 'ts',
    ...overrides,
  };
}

function stubLogger(): ContactLogger & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    logContact: (...args: unknown[]) => {
      calls.push(args);
    },
  } as ContactLogger & { calls: unknown[][] };
}

function renderCard(props: Partial<Parameters<typeof DealCard>[0]> = {}) {
  const logger = stubLogger();
  const onSetReplyState = vi.fn();
  const utils = render(
    <DealCard
      deal={makeDeal()}
      person={makePerson()}
      pendingSuggestionCount={0}
      onSetReplyState={onSetReplyState}
      contactLogger={logger}
      now={() => NOW}
      {...props}
    />,
  );
  return { ...utils, logger, onSetReplyState };
}

describe('BiDi safety', () => {
  it('renders name and role with dir="auto" (worst case: Hebrew name + English title)', () => {
    renderCard();
    const name = screen.getByText('נועה כהן');
    const role = screen.getByText('Senior Backend Engineer');
    expect(name.getAttribute('dir')).toBe('auto');
    expect(role.getAttribute('dir')).toBe('auto');
    // Same line: both spans share one <p> parent (single-line truncation).
    expect(name.parentElement).toBe(role.parentElement);
  });

  it('renders the next-action line with dir="auto"', () => {
    renderCard({
      deal: makeDeal({ nextAction: { label: 'לקבוע שיחת סינון', owner: 'revital' } }),
    });
    const line = screen.getByText(/לקבוע שיחת סינון/).closest('p');
    expect(line?.getAttribute('dir')).toBe('auto');
    expect(screen.getByText(/רויטל/)).toBeTruthy();
  });
});

describe('reply chips', () => {
  it('renders all three charter chips and dispatches the mapped state', () => {
    const { onSetReplyState } = renderCard();
    for (const { state, label } of REPLY_CHIPS) {
      fireEvent.click(screen.getByText(label));
      expect(onSetReplyState).toHaveBeenLastCalledWith('p1', state);
    }
    expect(onSetReplyState).toHaveBeenCalledTimes(3);
    expect(REPLY_CHIPS.map((c) => c.label)).toEqual([
      'השיב/ה',
      'אין מענה',
      'נקבעה שיחה',
    ]);
  });

  it('marks the latest reply-state as pressed', () => {
    renderCard({
      person: makePerson({
        contactEvents: [
          { kind: 'contacted', ts: 't1' },
          { kind: 'no_reply', ts: 't2' },
          { kind: 'replied', ts: 't3' },
        ],
      }),
    });
    const pressed = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toContain('השיב/ה');
  });
});

describe('wa.me one-tap (G4)', () => {
  it('renders a real <a href="https://wa.me/..."> and logs on click', () => {
    const { logger } = renderCard();
    const link = screen.getByTestId('wa-link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://wa.me/972501234567');
    // Prevent jsdom navigation noise; component handler still runs.
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(logger.calls).toHaveLength(1);
    const [personId, channel, messageHash] = logger.calls[0];
    expect(personId).toBe('p1');
    expect(channel).toBe('whatsapp');
    expect(messageHash).toBe(hashMessage(''));
  });

  it('uses the accepted draft as the message and logs its exact hash', () => {
    const draft: Pick<Suggestion, 'kind' | 'body' | 'personId'> = {
      kind: 'draft_message',
      body: 'היי נועה, ראיתי את הפרופיל שלך — מתאים למשרת Backend?',
      personId: 'p1',
    };
    const { logger } = renderCard({ acceptedDraft: draft });
    const link = screen.getByTestId('wa-link');
    const href = link.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/972501234567?text=')).toBe(true);
    expect(decodeURIComponent(href.split('?text=')[1])).toBe(draft.body);
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(logger.calls[0][2]).toBe(hashMessage(draft.body));
  });

  it('renders no anchor when the person has no usable phone', () => {
    renderCard({ person: makePerson({ phone: undefined }) });
    expect(screen.queryByTestId('wa-link')).toBeNull();
    renderCard({ person: makePerson({ phone: 'abc' }) });
    expect(screen.queryByTestId('wa-link')).toBeNull();
  });
});

describe('aging ring', () => {
  it.each([
    [2, 'fresh'],
    [5, 'warn'],
    [9, 'warn'],
    [10, 'late'],
    [14, 'late'],
  ])('%i days in stage → %s', (days, level) => {
    renderCard({
      deal: makeDeal({ stageEnteredAt: new Date(NOW - days * DAY_MS).toISOString() }),
    });
    const ring = screen.getByRole('img');
    expect(ring.getAttribute('data-aging')).toBe(level);
    expect(ring.getAttribute('data-days')).toBe(String(days));
    cleanup();
  });
});

describe('badges and chips', () => {
  it('shows the pending-suggestion badge only when count > 0', () => {
    renderCard({ pendingSuggestionCount: 3 });
    expect(screen.getByTestId('suggestion-badge').textContent).toBe('3');
    cleanup();
    renderCard({ pendingSuggestionCount: 0 });
    expect(screen.queryByTestId('suggestion-badge')).toBeNull();
  });

  it('renders the match score/verdict chip from the linked analysis', () => {
    renderCard({ analysis: { matchScore: 82, verdict: 'Strong Fit' } });
    const chip = screen.getByTestId('score-chip');
    expect(chip.textContent).toBe('82 · Strong Fit');
    expect(chip.getAttribute('dir')).toBe('auto');
  });

  it('renders no score chip without an analysis', () => {
    renderCard();
    expect(screen.queryByTestId('score-chip')).toBeNull();
  });
});
