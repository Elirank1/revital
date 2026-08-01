/**
 * PipelineView — the V3 board — Wave 1 + 2 (kanban-ui).
 *
 * Flag OFF (default): renders null — byte-identical to V2, not reachable.
 * Flag ON: 9 stage columns + Bench rail, live from the pipeline store:
 * dnd-kit drag between columns → `moveDeal` (the single writer), undo
 * toast (6s, ביטול → `undoLast`), pending-suggestions badge that opens
 * the inbox panel, and a board/today/money tab switch.
 *
 * Wave 3 surfaces: full Bench rail (silver medalists, re-match CTA,
 * restore-to-board — extracted to components/pipeline/BenchRail.tsx),
 * card-back trail + paste-a-thread (CardBack modal, opened per card),
 * "אישורים" tab hosting the full ApprovalsInbox + morning digest, and
 * the data panel behind the tools menu.
 *
 * Wave 2 money surfaces (ALL gated by mandate calibration — an
 * uncalibrated mandate shows no ₪ anywhere, never 0, never a placeholder):
 *   - MoneyHeader: qualified-pipeline ₪ + expected-this-month + early
 *     range footnote + priors editor popover;
 *   - EV range chip on calibrated DealCards;
 *   - per-column Σ EV replacing the Wave-1 "ΣEV —" placeholder (which
 *     still renders whenever no calibrated deal contributes);
 *   - FeeCapture modal auto-opening on drag→Placed;
 *   - MoneyBoard swimlanes behind the "כסף" tab;
 *   - BoardTools menu (export-everything + backfill dry-run panel).
 *
 * Data sources: `usePipelineStore` + `useMoneyStore` (fees/priors) and a
 * READ-ONLY subscription to the legacy `useAppStore` for the analyses
 * that back the match-score chips (kanban-ui never writes it).
 *
 * BiDi: user content dir="auto"; logical CSS (ps-/pe-/ms-/me-/text-start).
 * G4: outreach renders as <a href> inside DealCard — no window.open here.
 */

import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { usePipelineStore, pipelineContactLogger } from '../../store/pipelineStore';
import { useAppStore } from '../../store/appStore';
import type { CandidateAnalysis } from '../../types';
import type { Deal, DealStage, Person, Suggestion } from '../../types/pipeline';
import { STAGE_COLUMNS, stageLabel } from '../../components/pipeline/stages';
import type { StageColumnDef } from '../../components/pipeline/stages';
import { DealCard } from '../../components/pipeline/DealCard';
import { BenchRail } from '../../components/pipeline/BenchRail';
import { CardBack } from '../../components/pipeline/CardBack';
import { UndoToast } from '../../components/pipeline/UndoToast';
import { handleBoardDrop, type BoardDropResult } from '../../components/pipeline/dragEnd';
import { observedStageStats, useMoneyStore } from '../../lib/money';
import {
  calibratedJobIdSet,
  columnEvRange,
  evRangeForCalibratedDeal,
  formatEvRange,
  type EvRange,
} from '../../components/pipeline/money';
import { MoneyHeader } from '../../components/pipeline/MoneyHeader';
import { FeeCapture } from '../../components/pipeline/FeeCapture';
import { BoardTools } from '../../components/pipeline/BoardTools';
import { SuggestionsQueue, pendingSuggestions } from '../Inbox/SuggestionsQueue';
import { ApprovalsInbox } from '../Inbox/ApprovalsInbox';
import { TodayView } from './TodayView';
import { MoneyBoard } from './MoneyBoard';

// ------------------------------------------------------------
// Derived helpers (pure — exported for tests)
// ------------------------------------------------------------

/** Group live deals into their stages (tombstones excluded). */
export function groupDealsByStage(deals: Deal[]): Map<DealStage, Deal[]> {
  const map = new Map<DealStage, Deal[]>();
  for (const d of deals) {
    if (d.deleted) continue;
    const list = map.get(d.stage);
    if (list) list.push(d);
    else map.set(d.stage, [d]);
  }
  return map;
}

/** Pending suggestions targeting a deal (directly, or its person). */
export function pendingCountForDeal(pending: Suggestion[], deal: Deal): number {
  return pending.filter(
    (s) => s.dealId === deal.id || (!s.dealId && s.personId === deal.personId),
  ).length;
}

/** Latest accepted draft_message for a deal (deal link wins over person link). */
export function acceptedDraftForDeal(
  suggestions: Suggestion[],
  deal: Deal,
): Suggestion | undefined {
  return suggestions
    .filter(
      (s) =>
        s.status === 'accepted' &&
        s.kind === 'draft_message' &&
        !s.deleted &&
        (s.dealId === deal.id || (!s.dealId && s.personId === deal.personId)),
    )
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))[0];
}

/**
 * A completed drop into Placed opens the FeeCapture modal for the deal's
 * mandate — the moment fee/invoice reality changes (Wave 2). Pure so the
 * wiring unit-tests in node without dnd simulation.
 */
export function feeCaptureForDrop(
  result: BoardDropResult,
  deal: Deal | undefined,
): { jobId: string; jobTitle: string } | null {
  if (!result.moved || result.to !== 'Placed' || !deal) return null;
  return { jobId: deal.jobId, jobTitle: deal.jobTitle };
}

// ------------------------------------------------------------
// Board internals
// ------------------------------------------------------------

function DraggableDealCard({
  deal,
  children,
}: {
  deal: Deal;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: deal.id, data: { stage: deal.stage } });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.6 : undefined,
      }}
      {...listeners}
      {...attributes}
      className="touch-none cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  );
}

interface CardContext {
  personsById: Map<string, Person>;
  analysesById: Map<string, CandidateAnalysis>;
  pending: Suggestion[];
  suggestions: Suggestion[];
  /** EV range for CALIBRATED mandates only — null ⇒ no chip (no ₪). */
  evRangeFor: (deal: Deal) => EvRange | null;
  setReplyState: (personId: string, state: 'replied' | 'no_reply' | 'meeting_set') => void;
  /** Opens the card-back (trail + paste-a-thread) for a deal (Wave 3). */
  openTrail: (dealId: string) => void;
}

function BoardDealCard({ deal, ctx }: { deal: Deal; ctx: CardContext }) {
  const person = ctx.personsById.get(deal.personId);
  const analysis = deal.analysisId ? ctx.analysesById.get(deal.analysisId) : undefined;
  return (
    <DraggableDealCard deal={deal}>
      <DealCard
        deal={deal}
        person={person}
        analysis={analysis}
        pendingSuggestionCount={pendingCountForDeal(ctx.pending, deal)}
        acceptedDraft={acceptedDraftForDeal(ctx.suggestions, deal)}
        evRange={ctx.evRangeFor(deal)}
        onSetReplyState={ctx.setReplyState}
        contactLogger={pipelineContactLogger}
        onOpenTrail={() => ctx.openTrail(deal.id)}
      />
    </DraggableDealCard>
  );
}

function BoardColumn({
  stage,
  deals,
  ctx,
  evRange,
}: {
  stage: StageColumnDef;
  deals: Deal[];
  ctx: CardContext;
  /** Σ EV over the column's calibrated deals — null keeps the placeholder. */
  evRange: EvRange | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={stage.en}
      data-testid={`column-${stage.id}`}
      className={`flex flex-col w-64 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800/60 border ${
        isOver
          ? 'border-brand-400 ring-2 ring-brand-400/50'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <header className="flex items-baseline justify-between gap-2 ps-3 pe-3 pt-3 pb-2 border-b border-slate-200 dark:border-slate-700">
        <h3 className="min-w-0 text-sm font-semibold text-slate-900 dark:text-white">
          <span dir="auto">{stage.he}</span>{' '}
          <span dir="auto" className="font-normal text-slate-500 dark:text-slate-400">
            {stage.en}
          </span>
        </h3>
        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
          <span data-testid={`count-${stage.id}`} className="tabular-nums font-medium text-slate-500 dark:text-slate-400">
            {deals.length}
          </span>
          {/* Σ EV over CALIBRATED deals only; otherwise the truthful placeholder. */}
          {evRange ? (
            <span
              dir="ltr"
              data-testid={`ev-${stage.id}`}
              title="שווי צפוי מצטבר (מנדטים מכוילים)"
              className="ms-1.5 tabular-nums font-medium text-emerald-700 dark:text-emerald-400"
            >
              {`ΣEV ${formatEvRange(evRange)}`}
            </span>
          ) : (
            <span title="שווי צפוי — נדרש כיול עמלה למנדט" className="ms-1.5">
              ΣEV —
            </span>
          )}
        </span>
      </header>
      <div className="flex-1 min-h-16 flex flex-col gap-2 ps-2 pe-2 py-2 overflow-y-auto">
        {deals.length === 0 ? (
          <p dir="auto" className="text-xs text-slate-400 dark:text-slate-500 text-start ps-1">
            אין עסקאות בשלב זה
          </p>
        ) : (
          deals.map((deal) => <BoardDealCard key={deal.id} deal={deal} ctx={ctx} />)
        )}
      </div>
    </section>
  );
}

// BenchRail moved to components/pipeline/BenchRail.tsx (Wave 3 — full
// rail: silver-medalist badge, re-match CTA, restore-to-board).

// ------------------------------------------------------------
// The board (rendered only when the flag is on)
// ------------------------------------------------------------

function PipelineBoard() {
  const deals = usePipelineStore((s) => s.deals);
  const persons = usePipelineStore((s) => s.persons);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const stageEvents = usePipelineStore((s) => s.stageEvents);
  const moveDeal = usePipelineStore((s) => s.moveDeal);
  const undoLast = usePipelineStore((s) => s.undoLast);
  const setReplyState = usePipelineStore((s) => s.setReplyState);
  const fees = useMoneyStore((s) => s.fees);
  const priors = useMoneyStore((s) => s.priors);
  // READ-ONLY legacy subscription: analyses back the match-score chips.
  const analyses = useAppStore((s) => s.analyses);

  const [tab, setTab] = useState<'board' | 'today' | 'money' | 'approvals'>('board');
  const [inboxOpen, setInboxOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [feeCapture, setFeeCapture] = useState<{ jobId: string; jobTitle: string } | null>(
    null,
  );
  const [trailDealId, setTrailDealId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const byStage = useMemo(() => groupDealsByStage(deals), [deals]);
  const pending = useMemo(() => pendingSuggestions(suggestions), [suggestions]);
  const observed = useMemo(() => observedStageStats(stageEvents), [stageEvents]);
  const calibrated = useMemo(() => calibratedJobIdSet(deals, fees), [deals, fees]);
  const ctx = useMemo<CardContext>(
    () => ({
      personsById: new Map(persons.filter((p) => !p.deleted).map((p) => [p.id, p])),
      analysesById: new Map(analyses.map((a) => [a.id, a])),
      pending,
      suggestions,
      evRangeFor: (deal) =>
        evRangeForCalibratedDeal(deal, calibrated, fees, priors, observed),
      setReplyState,
      openTrail: setTrailDealId,
    }),
    [persons, analyses, pending, suggestions, calibrated, fees, priors, observed, setReplyState],
  );

  const onDragEnd = (event: DragEndEvent) => {
    const dealId = String(event.active.id);
    const deal = deals.find((d) => d.id === dealId);
    const result = handleBoardDrop({
      dealId,
      fromStage: deal?.stage,
      overId: event.over ? String(event.over.id) : null,
      moveDeal,
    });
    if (result.moved && result.to) {
      const to = stageLabel(result.to);
      setToast({
        id: Date.now(),
        message:
          result.to === 'Bench'
            ? 'הכרטיס הועבר לספסל'
            : `הכרטיס עבר לשלב ${to.he}`,
      });
      // Drag into Placed = the moment to capture/confirm the mandate fee.
      const prompt = feeCaptureForDrop(result, deal);
      if (prompt) setFeeCapture(prompt);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Board header */}
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          <span dir="auto">לוח עסקאות</span>{' '}
          <span dir="auto" className="text-brand-600 dark:text-brand-400">
            Pipeline
          </span>
        </h2>

        {/* Tab switch: board / today */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
          <button
            type="button"
            aria-pressed={tab === 'board'}
            onClick={() => setTab('board')}
            className={`rounded-md px-2.5 py-1 text-sm ${
              tab === 'board'
                ? 'bg-white dark:bg-slate-900 font-semibold text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            לוח
          </button>
          <button
            type="button"
            aria-pressed={tab === 'today'}
            onClick={() => setTab('today')}
            className={`rounded-md px-2.5 py-1 text-sm ${
              tab === 'today'
                ? 'bg-white dark:bg-slate-900 font-semibold text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            היום
          </button>
          <button
            type="button"
            data-testid="tab-money"
            aria-pressed={tab === 'money'}
            onClick={() => setTab('money')}
            className={`rounded-md px-2.5 py-1 text-sm ${
              tab === 'money'
                ? 'bg-white dark:bg-slate-900 font-semibold text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            כסף
          </button>
          <button
            type="button"
            data-testid="tab-approvals"
            aria-pressed={tab === 'approvals'}
            onClick={() => setTab('approvals')}
            className={`rounded-md px-2.5 py-1 text-sm ${
              tab === 'approvals'
                ? 'bg-white dark:bg-slate-900 font-semibold text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            אישורים
          </button>
        </div>

        {/* Board tools: export-everything + backfill dry-run */}
        <div className="ms-auto">
          <BoardTools />
        </div>

        {/* Pending-suggestions badge → inbox panel */}
        <button
          type="button"
          data-testid="inbox-badge"
          aria-expanded={inboxOpen}
          onClick={() => setInboxOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-sm text-slate-700 dark:text-slate-200"
        >
          <span dir="auto">הצעות</span>
          <span
            data-testid="inbox-badge-count"
            className={`rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums ${
              pending.length > 0
                ? 'bg-brand-600 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
            }`}
          >
            {pending.length}
          </span>
        </button>
      </header>

      {/* Wave-2 money block: calibrated figures only, priors editor popover */}
      <MoneyHeader />

      {/* Inbox panel (embedded SuggestionsQueue) */}
      {inboxOpen && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 ps-4 pe-4 py-3 max-h-80 overflow-y-auto">
          <SuggestionsQueue />
        </div>
      )}

      {tab === 'today' ? (
        <TodayView />
      ) : tab === 'money' ? (
        <MoneyBoard />
      ) : tab === 'approvals' ? (
        <ApprovalsInbox />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex flex-1 min-h-0 gap-4 items-stretch">
            <div className="flex-1 min-w-0 overflow-x-auto pb-2">
              <div className="flex h-full min-w-max gap-3">
                {STAGE_COLUMNS.map((stage) => (
                  <BoardColumn
                    key={stage.id}
                    stage={stage}
                    deals={byStage.get(stage.id) ?? []}
                    ctx={ctx}
                    evRange={columnEvRange(
                      byStage.get(stage.id) ?? [],
                      calibrated,
                      fees,
                      priors,
                      observed,
                    )}
                  />
                ))}
              </div>
            </div>
            <BenchRail />
          </div>
        </DndContext>
      )}

      {/* Card-back: full trail + paste-a-thread (Wave 3) */}
      {trailDealId && (
        <CardBack dealId={trailDealId} onClose={() => setTrailDealId(null)} />
      )}

      {/* FeeCapture: auto-opened by drag→Placed (also used by MoneyBoard lanes) */}
      {feeCapture && (
        <FeeCapture
          jobId={feeCapture.jobId}
          jobTitle={feeCapture.jobTitle}
          context="placed"
          onClose={() => setFeeCapture(null)}
        />
      )}

      {toast && (
        <UndoToast
          key={toast.id}
          message={toast.message}
          onUndo={() => {
            undoLast();
            setToast(null);
          }}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export function PipelineView() {
  // Reactive flag from the store: setV3Flag re-renders live (no reload).
  const enabled = usePipelineStore((s) => s.v3Enabled);
  if (!enabled) return null;
  return <PipelineBoard />;
}

export default PipelineView;
