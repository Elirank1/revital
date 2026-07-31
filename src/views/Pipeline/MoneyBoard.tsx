/**
 * MoneyBoard — unified money view, swimlanes per mandate — Wave 2 (kanban-ui).
 *
 * One horizontal lane per mandate (jobId), rendered with the SAME
 * DealCard component as the board. Lane header: mandate title, live deal
 * count, and — for CALIBRATED mandates only — the lane's Σ EV range.
 * Uncalibrated lanes show a "ללא כיול" badge and not a single ₪ (hard
 * rule); their fee button opens FeeCapture, which is exactly how a lane
 * becomes calibrated. Bench/Rejected deals are excluded (no probability
 * model — the lib refuses to invent one, so does this view).
 *
 * Lane order: calibrated first by EV midpoint (desc), then uncalibrated
 * by title — deterministic, money first.
 *
 * BiDi: user content dir="auto", amounts dir="ltr"; logical CSS only.
 */

import { useMemo, useState } from 'react';
import { usePipelineStore, pipelineContactLogger } from '../../store/pipelineStore';
import { useAppStore } from '../../store/appStore';
import type { CandidateAnalysis } from '../../types';
import type { Deal, Person, Suggestion } from '../../types/pipeline';
import {
  PIPELINE_STAGES,
  type PipelineStage,
} from '../../types/pipeline';
import {
  observedStageStats,
  useMoneyStore,
  type MandateFee,
  type ObservedByStage,
  type StagePriors,
} from '../../lib/money';
import {
  calibratedJobIdSet,
  evRangeForCalibratedDeal,
  formatEvRange,
  type EvRange,
} from '../../components/pipeline/money';
import { DealCard } from '../../components/pipeline/DealCard';
import { FeeCapture } from '../../components/pipeline/FeeCapture';
import { stageLabel } from '../../components/pipeline/stages';
import { pendingSuggestions } from '../Inbox/SuggestionsQueue';
import { acceptedDraftForDeal, pendingCountForDeal } from './PipelineView';

export interface MandateLane {
  jobId: string;
  jobTitle: string;
  deals: Deal[];
  calibrated: boolean;
  /** Σ EV range over the lane's deals — null unless calibrated. */
  evRange: EvRange | null;
}

const STAGE_INDEX = new Map<string, number>(
  PIPELINE_STAGES.map((s, i) => [s as string, i]),
);

/**
 * Group live pipeline-stage deals into per-mandate lanes (pure, exported
 * for tests). Bench/Rejected excluded. Calibration + EV via the money lib.
 */
export function buildMandateLanes(
  deals: Deal[],
  fees: Record<string, MandateFee>,
  priors: StagePriors,
  observed?: ObservedByStage,
): MandateLane[] {
  const live = deals.filter(
    (d) => !d.deleted && STAGE_INDEX.has(d.stage as string),
  );
  const calibrated = calibratedJobIdSet(deals, fees);

  const byJob = new Map<string, Deal[]>();
  for (const d of live) {
    const list = byJob.get(d.jobId);
    if (list) list.push(d);
    else byJob.set(d.jobId, [d]);
  }

  const lanes: MandateLane[] = [];
  for (const [jobId, jobDeals] of byJob) {
    const sorted = [...jobDeals].sort((a, b) => {
      const si =
        (STAGE_INDEX.get(a.stage as string) ?? 0) -
        (STAGE_INDEX.get(b.stage as string) ?? 0);
      return si !== 0 ? si : a.stageEnteredAt.localeCompare(b.stageEnteredAt);
    });
    const isCal = calibrated.has(jobId);
    let evRange: EvRange | null = null;
    if (isCal) {
      let lo = 0;
      let hi = 0;
      let contributed = 0;
      for (const d of sorted) {
        const r = evRangeForCalibratedDeal(d, calibrated, fees, priors, observed);
        if (r === null) continue;
        lo += r.lo;
        hi += r.hi;
        contributed += 1;
      }
      evRange = contributed > 0 ? { lo, hi } : null;
    }
    // Latest-updated deal's denormalized title names the lane.
    const title = [...sorted].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0].jobTitle;
    lanes.push({ jobId, jobTitle: title, deals: sorted, calibrated: isCal, evRange });
  }

  return lanes.sort((a, b) => {
    if (a.calibrated !== b.calibrated) return a.calibrated ? -1 : 1;
    if (a.calibrated && b.calibrated) {
      const mid = (r: EvRange | null) => (r ? (r.lo + r.hi) / 2 : 0);
      const d = mid(b.evRange) - mid(a.evRange);
      if (d !== 0) return d;
    }
    return a.jobTitle.localeCompare(b.jobTitle, 'he');
  });
}

export function MoneyBoard() {
  const deals = usePipelineStore((s) => s.deals);
  const persons = usePipelineStore((s) => s.persons);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const stageEvents = usePipelineStore((s) => s.stageEvents);
  const setReplyState = usePipelineStore((s) => s.setReplyState);
  const fees = useMoneyStore((s) => s.fees);
  const priors = useMoneyStore((s) => s.priors);
  // READ-ONLY legacy subscription: analyses back the score chips.
  const analyses = useAppStore((s) => s.analyses);

  const [feeEdit, setFeeEdit] = useState<{ jobId: string; jobTitle: string } | null>(null);

  const observed = useMemo(() => observedStageStats(stageEvents), [stageEvents]);
  const lanes = useMemo(
    () => buildMandateLanes(deals, fees, priors, observed),
    [deals, fees, priors, observed],
  );
  const calibrated = useMemo(() => calibratedJobIdSet(deals, fees), [deals, fees]);
  const pending = useMemo(() => pendingSuggestions(suggestions), [suggestions]);
  const personsById = useMemo(
    () => new Map(persons.filter((p) => !p.deleted).map((p) => [p.id, p])),
    [persons],
  );
  const analysesById = useMemo(
    () => new Map(analyses.map((a) => [a.id, a])),
    [analyses],
  );

  return (
    <div data-testid="money-board" className="flex flex-col gap-3 overflow-y-auto pb-2">
      {lanes.length === 0 ? (
        <p dir="auto" className="text-sm text-slate-400 dark:text-slate-500 text-start">
          אין עסקאות פעילות — לוח הכסף יתמלא כשיהיו כרטיסים על הלוח.
        </p>
      ) : (
        lanes.map((lane) => (
          <MandateLaneSection
            key={lane.jobId}
            lane={lane}
            calibrated={calibrated}
            fees={fees}
            priors={priors}
            observed={observed}
            personsById={personsById}
            analysesById={analysesById}
            pending={pending}
            suggestions={suggestions}
            setReplyState={setReplyState}
            onEditFee={() => setFeeEdit({ jobId: lane.jobId, jobTitle: lane.jobTitle })}
          />
        ))
      )}

      {feeEdit && (
        <FeeCapture
          jobId={feeEdit.jobId}
          jobTitle={feeEdit.jobTitle}
          context="edit"
          onClose={() => setFeeEdit(null)}
        />
      )}
    </div>
  );
}

function MandateLaneSection({
  lane,
  calibrated,
  fees,
  priors,
  observed,
  personsById,
  analysesById,
  pending,
  suggestions,
  setReplyState,
  onEditFee,
}: {
  lane: MandateLane;
  calibrated: ReadonlySet<string>;
  fees: Record<string, MandateFee>;
  priors: StagePriors;
  observed: ObservedByStage;
  personsById: Map<string, Person>;
  analysesById: Map<string, CandidateAnalysis>;
  pending: Suggestion[];
  suggestions: Suggestion[];
  setReplyState: (personId: string, state: 'replied' | 'no_reply' | 'meeting_set') => void;
  onEditFee: () => void;
}) {
  return (
    <section
      data-testid={`lane-${lane.jobId}`}
      aria-label={lane.jobTitle}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40"
    >
      <header className="flex flex-wrap items-baseline gap-2 ps-3 pe-3 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-700">
        <h3
          dir="auto"
          className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white text-start"
        >
          {lane.jobTitle}
        </h3>
        <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500">
          {lane.deals.length}
        </span>
        {lane.calibrated && lane.evRange ? (
          <span
            dir="ltr"
            data-testid={`lane-ev-${lane.jobId}`}
            title="שווי צפוי מצטבר למנדט"
            className="shrink-0 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-xs font-medium tabular-nums"
          >
            {formatEvRange(lane.evRange)}
          </span>
        ) : (
          <span
            dir="auto"
            data-testid={`lane-uncalibrated-${lane.jobId}`}
            title="אין עמלה מוגדרת או שאין עסקה מעבר לסינון — אין שווי להציג"
            className="shrink-0 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-xs"
          >
            ללא כיול
          </span>
        )}
        <button
          type="button"
          data-testid={`lane-fee-button-${lane.jobId}`}
          onClick={onEditFee}
          className="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-0.5 text-[11px]"
        >
          <span dir="auto">עמלה</span>
        </button>
      </header>
      <div className="flex gap-2.5 ps-3 pe-3 py-2.5 overflow-x-auto">
        {lane.deals.map((deal) => {
          const person = personsById.get(deal.personId);
          const analysis = deal.analysisId ? analysesById.get(deal.analysisId) : undefined;
          const label = stageLabel(deal.stage);
          return (
            <div key={deal.id} className="w-64 shrink-0 flex flex-col gap-1">
              <span
                dir="auto"
                className="self-start rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-px text-[10px]"
              >
                {label.he} · {label.en}
              </span>
              <DealCard
                deal={deal}
                person={person}
                analysis={analysis}
                pendingSuggestionCount={pendingCountForDeal(pending, deal)}
                acceptedDraft={acceptedDraftForDeal(suggestions, deal)}
                evRange={evRangeForCalibratedDeal(deal, calibrated, fees, priors, observed)}
                onSetReplyState={setReplyState}
                contactLogger={pipelineContactLogger}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default MoneyBoard;
