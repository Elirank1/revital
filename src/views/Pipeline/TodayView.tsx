/**
 * TodayView — "מה היום" work queue — Wave 1 (kanban-ui).
 *
 * Two sections: (1) approvals queue — pending suggestions with one-tap
 * accept/dismiss straight into the store; (2) at-risk deals ranked by
 * days-in-stage, oldest first (EV ranking arrives in Wave 2 — counts and
 * days only, NO fee/₪ figures per the calibration rule).
 *
 * Mobile-first at 390px: sections stack (flex-col) and switch to two
 * columns from lg upward (lg:flex-row) — asserted by class in tests.
 * Rendered standalone (lead-wired) or as the board's "היום" tab.
 */

import { usePipelineStore } from '../../store/pipelineStore';
import type { Deal, Person } from '../../types/pipeline';
import { daysInStage, AGING_WARN_DAYS } from '../../components/pipeline/aging';
import { AgingRing } from '../../components/pipeline/AgingRing';
import { stageLabel } from '../../components/pipeline/stages';
import { PIPELINE_STAGES, type PipelineStage } from '../../types/pipeline';
import { pendingSuggestions } from '../Inbox/SuggestionsQueue';

/** Stages that can be "at risk" — the working pipeline before Placed/Paid. */
const AT_RISK_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.slice(0, 7);

const AT_RISK_SHOWN = 10;

export interface AtRiskDeal {
  deal: Deal;
  days: number;
}

/**
 * Active-pipeline deals ranked by days-in-stage (longest-stuck first).
 * Wave-2 swaps this ranking for EV; the shape stays.
 */
export function rankAtRiskDeals(
  deals: Deal[],
  now: number = Date.now(),
): AtRiskDeal[] {
  return deals
    .filter(
      (d) =>
        !d.deleted && (AT_RISK_STAGES as readonly string[]).includes(d.stage),
    )
    .map((deal) => ({ deal, days: daysInStage(deal.stageEnteredAt, now) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, AT_RISK_SHOWN);
}

export function TodayView({ now = Date.now }: { now?: () => number }) {
  const deals = usePipelineStore((s) => s.deals);
  const persons = usePipelineStore((s) => s.persons);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const acceptSuggestion = usePipelineStore((s) => s.acceptSuggestion);
  const dismissSuggestion = usePipelineStore((s) => s.dismissSuggestion);

  const pending = pendingSuggestions(suggestions);
  const atRisk = rankAtRiskDeals(deals, now());
  const personName = (personId: string): string =>
    persons.find((p: Person) => p.id === personId && !p.deleted)?.name ?? '—';

  return (
    <div
      data-testid="today-view"
      className="flex flex-col gap-4 lg:flex-row lg:items-start"
    >
      {/* Approvals queue — one-tap resolve */}
      <section
        aria-label="אישורים"
        className="w-full lg:w-1/2 flex flex-col gap-2"
      >
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          <span dir="auto">לאישור עכשיו</span>{' '}
          <span className="text-xs font-normal tabular-nums text-slate-500 dark:text-slate-400">
            {pending.length}
          </span>
        </h3>
        {pending.length === 0 ? (
          <p dir="auto" className="text-sm text-slate-400 dark:text-slate-500 text-start">
            אין הצעות ממתינות.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pending.map((s) => (
              <li
                key={s.id}
                data-testid="approval-row"
                className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-3 pe-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-sm font-medium text-slate-900 dark:text-white text-start">
                    {s.title}
                  </p>
                  <p dir="auto" className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start">
                    {s.agent}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => acceptSuggestion(s.id)}
                  className="shrink-0 rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 text-xs font-medium"
                >
                  אישור
                </button>
                <button
                  type="button"
                  onClick={() => dismissSuggestion(s.id)}
                  className="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
                >
                  דחייה
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* At-risk deals by days-in-stage */}
      <section
        aria-label="עסקאות בסיכון"
        className="w-full lg:w-1/2 flex flex-col gap-2"
      >
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          <span dir="auto">תקועות הכי הרבה זמן</span>
        </h3>
        {atRisk.length === 0 ? (
          <p dir="auto" className="text-sm text-slate-400 dark:text-slate-500 text-start">
            אין עסקאות פעילות.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {atRisk.map(({ deal, days }) => {
              const label = stageLabel(deal.stage);
              return (
                <li
                  key={deal.id}
                  data-testid="at-risk-row"
                  data-days={days}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-3 pe-3 py-2"
                >
                  <AgingRing days={days} />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-sm font-medium text-slate-900 dark:text-white text-start">
                      {personName(deal.personId)}{' '}
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {deal.jobTitle}
                      </span>
                    </p>
                    <p dir="auto" className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start">
                      {label.he} · {label.en}
                      {days >= AGING_WARN_DAYS ? ` · ${days} ימים בשלב` : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default TodayView;
