/**
 * Pit Boss bridge — Wave 2 + 3 (kanban-ui).
 *
 * The Today view ranks by `rankMoveTheMoney` (wave2-contract §Pit Boss).
 * agents-engine landed `src/agents/pitboss.ts` during Wave 2, so the
 * bridge binds the REAL ranker (flipped from the null placeholder —
 * no lead action needed anymore). It stays the single seam between
 * kanban-ui and the agent surface:
 *
 *  - adapts the store's shapes to the ranker's inputs (Person[] →
 *    flattenContacts ContactRef[], epoch-ms → Date);
 *  - narrows the output to what the UI consumes (`RankedMoneyItem`) —
 *    the real `MoveTheMoneyItem` is structurally assignable, and tests
 *    inject minimal mock items against the narrow type;
 *  - keeps TodayView/digest injectable+fallback-safe: a null ranker
 *    (tests) or a throwing ranker falls back to money-free renderings.
 *
 * Wave 3 (morning digest): the narrow item optionally carries the
 * ranker's `calibrated` flag so the digest can render an uncalibrated
 * item's REASONS without its ₪ (D-031: uncalibrated deals rank
 * money-free); and `overdueFeedbackDeals` derives the digest's
 * "משוב לקוח באיחור" section from the SAME thresholds Pit Boss uses
 * (imported constants — never re-declared numbers).
 *
 * ₪ discipline: the UI additionally drops/mutes ₪ for items whose
 * mandate is not calibrated (its own calibrated set — belt + braces
 * over the ranker's `calibrated` flag) because `evAtRisk` is a ₪ figure.
 */

import type { Deal, Person } from '../../types/pipeline';
import type { MandateFee, ObservedByStage, StagePriors } from '../../lib/money';
import {
  FEEDBACK_OVERDUE_DAYS,
  FEEDBACK_STAGES,
  rankMoveTheMoney,
} from '../../agents/pitboss';
import { flattenContacts } from '../../lib/metrics/leadingIndicators';
import { daysInStage } from '../../components/pipeline/aging';

/** The slice of Pit Boss's MoveTheMoneyItem the Today UI consumes. */
export interface RankedMoneyItem {
  dealId: string;
  /** ₪ at risk — rendered ONLY for calibrated mandates. */
  evAtRisk: number;
  /** Reasons carry Hebrew claims citing the numeric inputs. */
  reasons: readonly { claim: string }[];
  /**
   * The ranker's calibration verdict (Wave 3, digest). Optional so
   * Wave-2 mock items stay valid; treat absence as NOT calibrated —
   * ₪ is never rendered on a maybe.
   */
  calibrated?: boolean;
}

export type RankMoveTheMoneyFn = (
  deals: Deal[],
  fees: Record<string, MandateFee>,
  priors: StagePriors,
  contacts: Person[],
  now: number,
  observed?: ObservedByStage,
) => RankedMoneyItem[];

/** The live ranker, adapted to the UI-facing signature. */
export function resolveRankMoveTheMoney(): RankMoveTheMoneyFn | null {
  return (deals, fees, priors, persons, now, observed) =>
    rankMoveTheMoney(
      deals,
      fees,
      priors,
      flattenContacts(persons),
      new Date(now),
      observed,
    );
}

// ------------------------------------------------------------
// Wave 3 — morning-digest derivations (same numbers as Pit Boss)
// ------------------------------------------------------------

/** Re-exported Pit Boss thresholds so the digest cites the same numbers. */
export { FEEDBACK_OVERDUE_DAYS, FEEDBACK_STAGES };

export interface OverdueFeedbackDeal {
  deal: Deal;
  /** Whole days sitting in Submitted/ClientInterview. */
  days: number;
}

/**
 * Deals whose client feedback is overdue: live, in a feedback stage
 * (Submitted/ClientInterview), sitting there longer than Pit Boss's
 * FEEDBACK_OVERDUE_DAYS. Sorted longest-waiting first. Money-free —
 * days are facts, ₪ needs calibration.
 */
export function overdueFeedbackDeals(
  deals: Deal[],
  now: number = Date.now(),
): OverdueFeedbackDeal[] {
  return deals
    .filter(
      (d) => !d.deleted && (FEEDBACK_STAGES as readonly string[]).includes(d.stage),
    )
    .map((deal) => ({ deal, days: daysInStage(deal.stageEnteredAt, now) }))
    .filter((x) => x.days > FEEDBACK_OVERDUE_DAYS)
    .sort((a, b) => b.days - a.days);
}
