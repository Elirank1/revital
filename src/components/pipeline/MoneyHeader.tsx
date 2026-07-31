/**
 * MoneyHeader — the board's money block — Wave 2 (kanban-ui).
 *
 * Data source: `qualifiedPipeline` from the money lib over live store
 * state (calibration is enforced in the DATA layer — uncalibrated
 * mandates contribute to no figure; wave2-contract §Fee/EV).
 *
 * Renders, for CALIBRATED mandates only:
 *   - qualified pipeline ₪ (Σ EV, Submitted+) + deal count;
 *   - expected-this-month (dated outstanding invoices only — no
 *     invented close-timing; "no dated invoices" renders WITHOUT ₪);
 *   - early-stage range footnote (Sourced..InConversation, ₪lo–hi).
 * With ZERO calibrated mandates the block shows a calibration hint and
 * not a single ₪ character (hard rule — the leak sweep asserts this).
 *
 * Also hosts the priors-editor popover (probabilities, not ₪ — usable
 * in calibration mode too).
 */

import { useMemo, useState } from 'react';
import { usePipelineStore } from '../../store/pipelineStore';
import {
  observedStageStats,
  qualifiedPipeline,
  useMoneyStore,
} from '../../lib/money';
import { expectedThisMonth, formatEvRange, formatILS } from './money';
import { PriorsEditor } from './PriorsEditor';

export function MoneyHeader({ now = Date.now }: { now?: () => number }) {
  const deals = usePipelineStore((s) => s.deals);
  const stageEvents = usePipelineStore((s) => s.stageEvents);
  const fees = useMoneyStore((s) => s.fees);
  const priors = useMoneyStore((s) => s.priors);
  const [priorsOpen, setPriorsOpen] = useState(false);

  const observed = useMemo(() => observedStageStats(stageEvents), [stageEvents]);
  const qp = useMemo(
    () => qualifiedPipeline(deals, fees, priors, observed),
    [deals, fees, priors, observed],
  );
  const month = useMemo(
    () => expectedThisMonth(fees, qp.calibratedJobIds, now()),
    [fees, qp.calibratedJobIds, now],
  );

  return (
    <div
      data-testid="money-header"
      className="relative flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 ps-3 pe-3 py-2"
    >
      {qp.qualifiedEV !== null ? (
        <>
          <div data-testid="qualified-ev" className="flex items-baseline gap-1.5">
            <span dir="auto" className="text-xs text-slate-500 dark:text-slate-400">
              צבר מוסמך (הוגשו+)
            </span>
            <span
              dir="ltr"
              className="text-sm font-bold tabular-nums text-slate-900 dark:text-white"
            >
              {formatILS(qp.qualifiedEV)}
            </span>
            <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
              <span dir="auto">{qp.qualifiedDealCount} עסקאות</span>
            </span>
          </div>

          <div data-testid="expected-month" className="flex items-baseline gap-1.5">
            <span dir="auto" className="text-xs text-slate-500 dark:text-slate-400">
              צפוי החודש
            </span>
            {month ? (
              <>
                <span
                  dir="ltr"
                  className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300"
                >
                  {formatILS(month.total)}
                </span>
                <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                  <span dir="auto">{month.invoiceCount} חשבוניות</span>
                </span>
              </>
            ) : (
              <span dir="auto" className="text-xs text-slate-400 dark:text-slate-500">
                אין חשבוניות מתוארכות
              </span>
            )}
          </div>

          {qp.earlyRange && (
            <div
              data-testid="early-range"
              className="flex items-baseline gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"
            >
              <span dir="auto">שלבים מוקדמים</span>
              <span dir="ltr" className="tabular-nums">
                {formatEvRange(qp.earlyRange)}
              </span>
              <span dir="auto">({qp.earlyDealCount} עסקאות)</span>
            </div>
          )}
        </>
      ) : (
        <span
          data-testid="calibration-hint"
          dir="auto"
          className="text-xs text-slate-500 dark:text-slate-400 text-start"
        >
          מצב כיול — הזינו עמלה למנדט עם עסקה פעילה כדי לראות שווי צבר
        </span>
      )}

      <button
        type="button"
        data-testid="priors-button"
        aria-expanded={priorsOpen}
        onClick={() => setPriorsOpen((v) => !v)}
        className="ms-auto shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-0.5 text-[11px]"
      >
        <span dir="auto">הסתברויות</span>
      </button>
      {priorsOpen && (
        <PriorsEditor observed={observed} onClose={() => setPriorsOpen(false)} />
      )}
    </div>
  );
}

export default MoneyHeader;
