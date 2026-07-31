/**
 * Days-in-stage aging model — Wave 1 (kanban-ui).
 *
 * Pure math for the card aging ring (plan §2): amber at ≥5 days in stage,
 * red at ≥10. Rendering is CSS-only (see AgingRing.tsx); this module owns
 * the thresholds and the day arithmetic so tests pin them exactly.
 */

export const AGING_WARN_DAYS = 5;
export const AGING_LATE_DAYS = 10;

export type AgingLevel = 'fresh' | 'warn' | 'late';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days a deal has sat in its current stage.
 * Defensive: an invalid/missing timestamp or a clock skew into the
 * future reads as 0 days — the ring must never crash a card render.
 */
export function daysInStage(
  stageEnteredAt: string,
  now: number = Date.now(),
): number {
  const entered = Date.parse(stageEnteredAt);
  if (Number.isNaN(entered)) return 0;
  const diff = now - entered;
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

/** Threshold mapping: <5 fresh · ≥5 warn (amber) · ≥10 late (red). */
export function agingLevel(days: number): AgingLevel {
  if (days >= AGING_LATE_DAYS) return 'late';
  if (days >= AGING_WARN_DAYS) return 'warn';
  return 'fresh';
}

/** Ring fill fraction (0..1): full ring at the red threshold. */
export function agingFraction(days: number): number {
  if (days <= 0) return 0;
  return Math.min(days / AGING_LATE_DAYS, 1);
}
