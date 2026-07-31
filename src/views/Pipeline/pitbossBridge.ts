/**
 * Pit Boss bridge — Wave 2 (kanban-ui).
 *
 * The Today view ranks by `rankMoveTheMoney` (wave2-contract §Pit Boss).
 * agents-engine landed `src/agents/pitboss.ts` during this batch, so the
 * bridge now binds the REAL ranker (flipped from the null placeholder —
 * no lead action needed anymore). It stays the single seam between
 * kanban-ui and the agent surface:
 *
 *  - adapts the store's shapes to the ranker's inputs (Person[] →
 *    flattenContacts ContactRef[], epoch-ms → Date);
 *  - narrows the output to what the UI consumes (`RankedMoneyItem`) —
 *    the real `MoveTheMoneyItem` is structurally assignable, and tests
 *    inject minimal mock items against the narrow type;
 *  - keeps TodayView injectable/fallback-safe: a null ranker (tests) or
 *    a throwing ranker falls back to the Wave-1 aging ranking.
 *
 * ₪ discipline: the UI additionally drops items whose mandate is not
 * calibrated (its own calibrated set — belt + braces over the ranker's
 * `calibrated` flag) because `evAtRisk` is a ₪ figure.
 */

import type { Deal, Person } from '../../types/pipeline';
import type { MandateFee, ObservedByStage, StagePriors } from '../../lib/money';
import { rankMoveTheMoney } from '../../agents/pitboss';
import { flattenContacts } from '../../lib/metrics/leadingIndicators';

/** The slice of Pit Boss's MoveTheMoneyItem the Today UI consumes. */
export interface RankedMoneyItem {
  dealId: string;
  /** ₪ at risk — rendered ONLY for calibrated mandates. */
  evAtRisk: number;
  /** Reasons carry Hebrew claims citing the numeric inputs. */
  reasons: readonly { claim: string }[];
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
