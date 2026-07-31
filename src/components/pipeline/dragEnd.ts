/**
 * Board drop resolution — Wave 1 (kanban-ui).
 *
 * Pure wiring between a dnd-kit drag-end and the store's `moveDeal`
 * (the single writer of card state — wave1-store-contract.md). Kept
 * dependency-free of dnd-kit types so it unit-tests in plain node,
 * per the Wave-1 task list ("test moveDeal wiring via component
 * callbacks — skip full dnd simulation").
 *
 * Drop targets are the 9 pipeline columns plus the Bench rail.
 * 'Rejected' is deliberately NOT droppable: rejection requires a
 * reason (store refuses without one) and gets its own flow later —
 * a drag gesture cannot carry a reason.
 */

import { PIPELINE_STAGES, type DealStage, type StageEvent } from '../../types/pipeline';
import type { AuditActor } from '../../types/pipeline';

/** Stages a card can be dropped onto. */
export const DROPPABLE_STAGES: readonly DealStage[] = [...PIPELINE_STAGES, 'Bench'];

export function isDroppableStage(id: string | null | undefined): id is DealStage {
  return id != null && (DROPPABLE_STAGES as readonly string[]).includes(id);
}

/** The store's moveDeal signature (wave1-store-contract.md, binding). */
export type MoveDealFn = (
  dealId: string,
  toStage: DealStage,
  opts?: { reason?: string; actor?: AuditActor; agent?: string },
) => StageEvent | null;

export interface BoardDropResult {
  moved: boolean;
  dealId?: string;
  from?: DealStage;
  to?: DealStage;
}

/**
 * Resolve a drag-end into a `moveDeal` call (or a no-op).
 * No-ops: dropped outside any column, onto a non-droppable id, onto the
 * card's own column, or when the store refuses the move (returns null).
 */
export function handleBoardDrop(params: {
  dealId: string;
  fromStage: DealStage | undefined;
  overId: string | null;
  moveDeal: MoveDealFn;
}): BoardDropResult {
  const { dealId, fromStage, overId, moveDeal } = params;
  if (!isDroppableStage(overId)) return { moved: false };
  if (fromStage === overId) return { moved: false };
  const event = moveDeal(dealId, overId);
  if (event === null) return { moved: false };
  return { moved: true, dealId, from: event.from ?? fromStage, to: overId };
}
