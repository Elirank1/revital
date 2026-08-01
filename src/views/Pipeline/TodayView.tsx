/**
 * TodayView — "מה היום" work queue — Wave 1 + 2 (kanban-ui).
 *
 * Two sections: (1) approvals queue — pending suggestions with one-tap
 * accept/dismiss (accepts route through the store's `acceptSuggestion`,
 * which stamps the `editedBeforeAccept:false` marker for the edit-rate
 * metric — Wave-3 absorption, D-036);
 * (2) the work ranking:
 *   - Wave 2: deals rank by Pit Boss `rankMoveTheMoney` (live via
 *     pitbossBridge) — ₪ EV at risk + the ranker's reason claims, and
 *     every item carries the accepted pre-drafted wa.me link when one
 *     exists (pending drafts show an "awaiting approval" chip instead —
 *     an unapproved draft never becomes a send link). ₪ renders ONLY for
 *     calibrated mandates — items for uncalibrated deals are dropped
 *     defensively (their evAtRisk is a ₪ figure that may not be shown).
 *   - Fallback (injected null / ranker throws): the Wave-1 days-in-stage
 *     ranking — counts and days only, NO ₪ (calibration rule).
 *
 * Mobile-first at 390px: sections stack (flex-col), two columns from lg.
 * Rendered standalone (lead-wired) or as the board's "היום" tab.
 */

import { useMemo } from 'react';
import { usePipelineStore, pipelineContactLogger } from '../../store/pipelineStore';
import type { Deal, Person, Suggestion } from '../../types/pipeline';
import { daysInStage, AGING_WARN_DAYS } from '../../components/pipeline/aging';
import { AgingRing } from '../../components/pipeline/AgingRing';
import { stageLabel } from '../../components/pipeline/stages';
import { PIPELINE_STAGES, type PipelineStage } from '../../types/pipeline';
import { useMoneyStore } from '../../lib/money';
import { calibratedJobIdSet, formatILS } from '../../components/pipeline/money';
import {
  composeAndLog,
  suggestionToComposeArgs,
  suggestionToWaHref,
} from '../../lib/outreach';
import { pendingSuggestions } from '../Inbox/SuggestionsQueue';
import { acceptedDraftForDeal } from './PipelineView';
import {
  resolveRankMoveTheMoney,
  type RankedMoneyItem,
  type RankMoveTheMoneyFn,
} from './pitbossBridge';

/** Stages that can be "at risk" — the working pipeline before Placed/Paid. */
const AT_RISK_STAGES: readonly PipelineStage[] = PIPELINE_STAGES.slice(0, 7);

const AT_RISK_SHOWN = 10;
const RANKED_SHOWN = 10;

export interface AtRiskDeal {
  deal: Deal;
  days: number;
}

/**
 * Active-pipeline deals ranked by days-in-stage (longest-stuck first) —
 * the Wave-1 fallback ranking while Pit Boss is unavailable.
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

/** Latest PENDING draft_message targeting the deal (or its person). */
export function pendingDraftForDeal(
  suggestions: Suggestion[],
  deal: Deal,
): Suggestion | undefined {
  return suggestions
    .filter(
      (s) =>
        s.status === 'pending' &&
        s.kind === 'draft_message' &&
        !s.deleted &&
        (s.dealId === deal.id || (!s.dealId && s.personId === deal.personId)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

interface RankedRow {
  item: RankedMoneyItem;
  deal: Deal;
}

export function TodayView({
  now = Date.now,
  rankMoveTheMoney = resolveRankMoveTheMoney(),
}: {
  now?: () => number;
  rankMoveTheMoney?: RankMoveTheMoneyFn | null;
}) {
  const deals = usePipelineStore((s) => s.deals);
  const persons = usePipelineStore((s) => s.persons);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const acceptSuggestion = usePipelineStore((s) => s.acceptSuggestion);
  const dismissSuggestion = usePipelineStore((s) => s.dismissSuggestion);
  const fees = useMoneyStore((s) => s.fees);
  const priors = useMoneyStore((s) => s.priors);

  const pending = pendingSuggestions(suggestions);
  const livePersons = useMemo(() => persons.filter((p) => !p.deleted), [persons]);
  const calibrated = useMemo(() => calibratedJobIdSet(deals, fees), [deals, fees]);

  const ranked: RankedRow[] | null = useMemo(() => {
    if (!rankMoveTheMoney) return null;
    let items: RankedMoneyItem[];
    try {
      items = rankMoveTheMoney(deals, fees, priors, livePersons, now());
    } catch {
      return null; // a broken ranker must never take Today down — fall back
    }
    const byId = new Map(deals.map((d) => [d.id, d]));
    const rows: RankedRow[] = [];
    for (const item of items) {
      const deal = byId.get(item.dealId);
      if (!deal || deal.deleted) continue;
      // ₪ leak guard: evAtRisk is a ₪ figure — calibrated mandates only.
      if (!calibrated.has(deal.jobId)) continue;
      if (!Number.isFinite(item.evAtRisk)) continue;
      rows.push({ item, deal });
      if (rows.length >= RANKED_SHOWN) break;
    }
    return rows;
  }, [rankMoveTheMoney, deals, fees, priors, livePersons, calibrated, now]);

  const atRisk = ranked === null ? rankAtRiskDeals(deals, now()) : [];
  const personById = (personId: string): Person | undefined =>
    livePersons.find((p) => p.id === personId);
  const personName = (personId: string): string =>
    personById(personId)?.name ?? '—';

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

      {ranked !== null ? (
        /* Pit Boss ranking — ₪ EV at risk, calibrated mandates only */
        <section
          aria-label="להזיז את הכסף"
          className="w-full lg:w-1/2 flex flex-col gap-2"
        >
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            <span dir="auto">להזיז את הכסף עכשיו</span>
          </h3>
          {ranked.length === 0 ? (
            <p dir="auto" className="text-sm text-slate-400 dark:text-slate-500 text-start">
              אין עסקאות מכוילות בסיכון.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ranked.map(({ item, deal }) => {
                const label = stageLabel(deal.stage);
                const person = personById(deal.personId);
                const acceptedDraft = acceptedDraftForDeal(suggestions, deal);
                const waHref =
                  acceptedDraft && person
                    ? suggestionToWaHref(acceptedDraft, person)
                    : null;
                const pendingDraft = pendingDraftForDeal(suggestions, deal);
                return (
                  <li
                    key={deal.id}
                    data-testid="mtm-row"
                    data-deal-id={deal.id}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-3 pe-2 py-2"
                  >
                    <span
                      dir="ltr"
                      data-testid="mtm-ev"
                      title="שווי צפוי בסיכון"
                      className="shrink-0 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-xs font-semibold tabular-nums"
                    >
                      {formatILS(item.evAtRisk)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="truncate text-sm font-medium text-slate-900 dark:text-white text-start">
                        {personName(deal.personId)}{' '}
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          {deal.jobTitle}
                        </span>
                      </p>
                      <p dir="auto" className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start">
                        {label.he} · {label.en}
                        {item.reasons.length > 0
                          ? ` · ${item.reasons.map((r) => r.claim).join(' · ')}`
                          : ''}
                      </p>
                    </div>
                    {waHref && acceptedDraft && person ? (
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="mtm-wa-link"
                        onClick={() => {
                          const args = suggestionToComposeArgs(acceptedDraft, person);
                          if (args) composeAndLog(args, pipelineContactLogger);
                        }}
                        className="shrink-0 inline-flex items-center rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-xs font-medium"
                      >
                        <span dir="auto">וואטסאפ</span>
                      </a>
                    ) : pendingDraft ? (
                      <span
                        dir="auto"
                        data-testid="mtm-pending-draft"
                        title="טיוטה ממתינה לאישור בתור ההצעות"
                        className="shrink-0 rounded-full bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 px-2 py-0.5 text-[10px]"
                      >
                        טיוטה ממתינה
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        /* Wave-1 fallback: at-risk by days-in-stage — no ₪ */
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
      )}
    </div>
  );
}

export default TodayView;
