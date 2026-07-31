/**
 * Board drop wiring tests (node env) — kanban-ui, Wave 1.
 *
 * Per the task list, drag is tested through the moveDeal wiring (the pure
 * handleBoardDrop resolver), not a full dnd-kit pointer simulation.
 */
import { describe, it, expect, vi } from 'vitest';
import type { StageEvent } from '../../types/pipeline';
import { DROPPABLE_STAGES, handleBoardDrop, isDroppableStage } from './dragEnd';

function fakeEvent(from: StageEvent['from'], to: StageEvent['to']): StageEvent {
  return {
    id: 'ev1',
    v: 0,
    updatedAt: 't',
    dealId: 'd1',
    from,
    to,
    ts: 't',
    actor: 'human',
    skippedStages: [],
  };
}

describe('isDroppableStage', () => {
  it('accepts the 9 pipeline columns and Bench', () => {
    expect(DROPPABLE_STAGES).toHaveLength(10);
    for (const s of DROPPABLE_STAGES) expect(isDroppableStage(s)).toBe(true);
  });

  it('rejects Rejected (reason required — no drag flow), null and junk', () => {
    expect(isDroppableStage('Rejected')).toBe(false);
    expect(isDroppableStage(null)).toBe(false);
    expect(isDroppableStage(undefined)).toBe(false);
    expect(isDroppableStage('NotAStage')).toBe(false);
  });
});

describe('handleBoardDrop → moveDeal wiring', () => {
  it('calls moveDeal on a drop onto another column and reports the move', () => {
    const moveDeal = vi.fn().mockReturnValue(fakeEvent('Sourced', 'Screened'));
    const result = handleBoardDrop({
      dealId: 'd1',
      fromStage: 'Sourced',
      overId: 'Screened',
      moveDeal,
    });
    expect(moveDeal).toHaveBeenCalledExactlyOnceWith('d1', 'Screened');
    expect(result).toEqual({
      moved: true,
      dealId: 'd1',
      from: 'Sourced',
      to: 'Screened',
    });
  });

  it('supports dropping onto the Bench rail', () => {
    const moveDeal = vi.fn().mockReturnValue(fakeEvent('Outreach', 'Bench'));
    const result = handleBoardDrop({
      dealId: 'd1',
      fromStage: 'Outreach',
      overId: 'Bench',
      moveDeal,
    });
    expect(moveDeal).toHaveBeenCalledExactlyOnceWith('d1', 'Bench');
    expect(result.moved).toBe(true);
    expect(result.to).toBe('Bench');
  });

  it('no-ops when dropped outside any column', () => {
    const moveDeal = vi.fn();
    expect(
      handleBoardDrop({ dealId: 'd1', fromStage: 'Sourced', overId: null, moveDeal }),
    ).toEqual({ moved: false });
    expect(moveDeal).not.toHaveBeenCalled();
  });

  it('no-ops when dropped onto its own column', () => {
    const moveDeal = vi.fn();
    expect(
      handleBoardDrop({
        dealId: 'd1',
        fromStage: 'Screened',
        overId: 'Screened',
        moveDeal,
      }),
    ).toEqual({ moved: false });
    expect(moveDeal).not.toHaveBeenCalled();
  });

  it('no-ops on a non-droppable target (Rejected has no drag flow)', () => {
    const moveDeal = vi.fn();
    expect(
      handleBoardDrop({
        dealId: 'd1',
        fromStage: 'Sourced',
        overId: 'Rejected',
        moveDeal,
      }),
    ).toEqual({ moved: false });
    expect(moveDeal).not.toHaveBeenCalled();
  });

  it('reports moved:false when the store refuses the move (returns null)', () => {
    const moveDeal = vi.fn().mockReturnValue(null);
    const result = handleBoardDrop({
      dealId: 'ghost',
      fromStage: 'Sourced',
      overId: 'Screened',
      moveDeal,
    });
    expect(moveDeal).toHaveBeenCalledOnce();
    expect(result).toEqual({ moved: false });
  });
});
