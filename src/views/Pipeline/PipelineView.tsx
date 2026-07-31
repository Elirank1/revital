/**
 * PipelineView — the V3 board — Wave 1 (kanban-ui).
 *
 * Flag OFF (default): renders null — byte-identical to V2, not reachable.
 * Flag ON: 9 stage columns + Bench rail, live from the pipeline store:
 * dnd-kit drag between columns → `moveDeal` (the single writer), undo
 * toast (6s, ביטול → `undoLast`), per-column count + ΣEV placeholder
 * (count only until Wave-2 fees — NO invented ₪ figures, calibration
 * rule), pending-suggestions badge that opens the inbox panel, and a
 * board/today tab switch.
 *
 * Data sources: `usePipelineStore` (deals/persons/suggestions + actions)
 * and a READ-ONLY subscription to the legacy `useAppStore` for the
 * analyses that back the match-score chips (kanban-ui never writes it).
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
import { STAGE_COLUMNS, BENCH_RAIL, stageLabel } from '../../components/pipeline/stages';
import type { StageColumnDef } from '../../components/pipeline/stages';
import { DealCard } from '../../components/pipeline/DealCard';
import { UndoToast } from '../../components/pipeline/UndoToast';
import { handleBoardDrop } from '../../components/pipeline/dragEnd';
import { SuggestionsQueue, pendingSuggestions } from '../Inbox/SuggestionsQueue';
import { TodayView } from './TodayView';

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
  setReplyState: (personId: string, state: 'replied' | 'no_reply' | 'meeting_set') => void;
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
        onSetReplyState={ctx.setReplyState}
        contactLogger={pipelineContactLogger}
      />
    </DraggableDealCard>
  );
}

function BoardColumn({
  stage,
  deals,
  ctx,
}: {
  stage: StageColumnDef;
  deals: Deal[];
  ctx: CardContext;
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
          {/* ΣEV lands with Wave-2 fees — placeholder only, never a fake ₪ figure. */}
          <span title="שווי צפוי — מגיע ב-Wave 2" className="ms-1.5">
            ΣEV —
          </span>
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

function BenchRail({ persons }: { persons: Person[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: BENCH_RAIL.id });
  const benched = persons.filter((p) => !p.deleted && !!p.bench);
  return (
    <aside
      ref={setNodeRef}
      aria-label={BENCH_RAIL.en}
      data-testid="bench-rail"
      className={`flex flex-col w-56 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-950/30 border ${
        isOver ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-amber-200 dark:border-amber-900'
      }`}
    >
      <header className="flex items-baseline justify-between gap-2 ps-3 pe-3 pt-3 pb-2 border-b border-amber-200 dark:border-amber-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          <span dir="auto">{BENCH_RAIL.he}</span>{' '}
          <span dir="auto" className="font-normal text-slate-500 dark:text-slate-400">
            {BENCH_RAIL.en}
          </span>
        </h3>
        <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
          {benched.length}
        </span>
      </header>
      <div className="flex-1 flex flex-col gap-1.5 ps-2 pe-2 py-2 overflow-y-auto">
        {benched.length === 0 ? (
          <p dir="auto" className="text-xs text-slate-400 dark:text-slate-500 text-start ps-1">
            הספסל ריק — מועמדים שנדחו נשמרים כאן לשימוש חוזר
          </p>
        ) : (
          benched.map((p) => (
            <div
              key={p.id}
              className="rounded-lg bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900 ps-2.5 pe-2.5 py-1.5"
            >
              <p dir="auto" className="truncate text-sm font-medium text-slate-900 dark:text-white text-start">
                {p.name}
              </p>
              {p.bench && (
                <p dir="auto" className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start">
                  {p.bench.reason}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------
// The board (rendered only when the flag is on)
// ------------------------------------------------------------

function PipelineBoard() {
  const deals = usePipelineStore((s) => s.deals);
  const persons = usePipelineStore((s) => s.persons);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const moveDeal = usePipelineStore((s) => s.moveDeal);
  const undoLast = usePipelineStore((s) => s.undoLast);
  const setReplyState = usePipelineStore((s) => s.setReplyState);
  // READ-ONLY legacy subscription: analyses back the match-score chips.
  const analyses = useAppStore((s) => s.analyses);

  const [tab, setTab] = useState<'board' | 'today'>('board');
  const [inboxOpen, setInboxOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const byStage = useMemo(() => groupDealsByStage(deals), [deals]);
  const pending = useMemo(() => pendingSuggestions(suggestions), [suggestions]);
  const ctx = useMemo<CardContext>(
    () => ({
      personsById: new Map(persons.filter((p) => !p.deleted).map((p) => [p.id, p])),
      analysesById: new Map(analyses.map((a) => [a.id, a])),
      pending,
      suggestions,
      setReplyState,
    }),
    [persons, analyses, pending, suggestions, setReplyState],
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
        </div>

        {/* Pending-suggestions badge → inbox panel */}
        <button
          type="button"
          data-testid="inbox-badge"
          aria-expanded={inboxOpen}
          onClick={() => setInboxOpen((v) => !v)}
          className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-sm text-slate-700 dark:text-slate-200"
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

      {/* Inbox panel (embedded SuggestionsQueue) */}
      {inboxOpen && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 ps-4 pe-4 py-3 max-h-80 overflow-y-auto">
          <SuggestionsQueue />
        </div>
      )}

      {tab === 'today' ? (
        <TodayView />
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
                  />
                ))}
              </div>
            </div>
            <BenchRail persons={persons} />
          </div>
        </DndContext>
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
