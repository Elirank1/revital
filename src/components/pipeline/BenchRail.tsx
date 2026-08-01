/**
 * BenchRail — the Bench side rail, full version — Wave 3 (kanban-ui).
 *
 * Rejected / silver-medalist candidates are reusable inventory, not
 * garbage (plan §2). The rail renders live benched persons via the
 * store's `benchBySilver()` grouping — silver medalists first (deal
 * reached Submitted+ before Rejected; badge sourced from the Wave-3
 * bench metadata, never recomputed here) — each with:
 *
 *  - bench reason + "on the bench since" line;
 *  - silver-medalist badge (title = the full lexicon claim);
 *  - re-match CTA: files a `rematch` REQUEST Suggestion addressed to the
 *    Bench Sourcer (`agent: 'bench_sourcer'`) through `addSuggestion` —
 *    the sourcer's own OUTPUT stays kind `bench_match`, so requests and
 *    results never collide. One pending request per person (guarded);
 *  - restore-to-board: `restorePlanForPerson` (pure, tested) picks the
 *    parked deal and its return stage from the StageEvent history, then
 *    the flow executes ONLY store contract actions (`moveDeal` /
 *    `addDeal` / `upsertPerson` to clear the bench flag — audited).
 *
 * Still a dnd drop target (drag a card onto the rail ⇒ Bench move, the
 * Wave-1 behavior — owned by the board's DndContext).
 *
 * BiDi: user content dir="auto"; logical CSS only. No ₪ anywhere on the
 * bench (D-028: the Bench refuses a number).
 */

import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  usePipelineStore,
  benchBySilver,
  type PersonWithBenchMeta,
} from '../../store/pipelineStore';
import {
  PIPELINE_STAGES,
  type Deal,
  type PipelineStage,
  type StageEvent,
  type Suggestion,
} from '../../types/pipeline';
import { BENCH_RAIL } from './stages';
import { t, daysAgoHe } from '../../i18n';

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// Pure helpers (exported for tests)
// ------------------------------------------------------------

export type RestorePlan =
  | { kind: 'move'; dealId: string; to: PipelineStage }
  | { kind: 'recreate'; jobId: string; jobTitle: string; to: PipelineStage }
  | { kind: 'unbench' };

/**
 * How to put a benched person back on the board:
 * - a live parked deal (Rejected/Bench stage) moves back to the stage it
 *   left — read from the StageEvent that parked it (`from`), falling
 *   back to 'Sourced' when history rotated out;
 * - no parked deal but another LIVE deal ⇒ already on the board — only
 *   the bench flag needs clearing;
 * - only tombstoned deals ⇒ recreate a fresh deal on the last known
 *   mandate at 'Sourced' (honest re-entry, no invented progress);
 * - no deal history at all ⇒ just un-bench.
 */
export function restorePlanForPerson(
  personId: string,
  deals: Deal[],
  stageEvents: StageEvent[],
): RestorePlan {
  const live = deals.filter((d) => d.personId === personId && !d.deleted);
  const parked = live
    .filter((d) => d.stage === 'Rejected' || d.stage === 'Bench')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (parked.length > 0) {
    const deal = parked[0];
    const parkingEvents = stageEvents
      .filter((e) => e.dealId === deal.id && !e.deleted && e.to === deal.stage)
      .sort((a, b) => b.ts.localeCompare(a.ts));
    let to: PipelineStage = 'Sourced';
    for (const e of parkingEvents) {
      if (e.from && (PIPELINE_STAGES as readonly string[]).includes(e.from)) {
        to = e.from as PipelineStage;
        break;
      }
    }
    return { kind: 'move', dealId: deal.id, to };
  }

  if (live.length > 0) return { kind: 'unbench' };

  const prior = deals
    .filter((d) => d.personId === personId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (prior) {
    return {
      kind: 'recreate',
      jobId: prior.jobId,
      jobTitle: prior.jobTitle,
      to: 'Sourced',
    };
  }
  return { kind: 'unbench' };
}

/** Person ids with a PENDING re-match request already filed. */
export function pendingRematchPersonIds(suggestions: Suggestion[]): Set<string> {
  const ids = new Set<string>();
  for (const s of suggestions) {
    if (s.kind === 'rematch' && s.status === 'pending' && !s.deleted && s.personId) {
      ids.add(s.personId);
    }
  }
  return ids;
}

// ------------------------------------------------------------
// The rail
// ------------------------------------------------------------

function BenchCard({
  person,
  hasPendingRematch,
  onRestore,
  onRematch,
  now,
}: {
  person: PersonWithBenchMeta;
  hasPendingRematch: boolean;
  onRestore: (person: PersonWithBenchMeta) => void;
  onRematch: (person: PersonWithBenchMeta) => void;
  now: () => number;
}) {
  const bench = person.bench;
  const silver = bench?.silverMedalist === true;
  const benchedAt = bench?.benchedAt ?? bench?.since;
  const benchedDays = benchedAt
    ? Math.floor((now() - Date.parse(benchedAt)) / DAY_MS)
    : null;
  const agoPhrase =
    benchedDays !== null && Number.isFinite(benchedDays)
      ? daysAgoHe(benchedDays)
      : null;

  return (
    <div
      data-testid="bench-card"
      data-person-id={person.id}
      className="rounded-lg bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900 ps-2.5 pe-2.5 py-1.5 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5">
        <p
          dir="auto"
          className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-white text-start"
        >
          {person.name}
        </p>
        {silver && (
          <span
            dir="auto"
            data-testid="silver-badge"
            title={t('bench.silverMedalist')}
            className="shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-1.5 py-px text-[10px] font-medium"
          >
            מדליית כסף
          </span>
        )}
      </div>
      {bench && (
        <p
          dir="auto"
          className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start"
        >
          {bench.reason}
        </p>
      )}
      {agoPhrase && (
        <p
          dir="auto"
          className="truncate text-[10px] text-slate-400 dark:text-slate-500 text-start"
        >
          על הספסל {agoPhrase}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <button
          type="button"
          data-testid="bench-restore"
          title="החזרת המועמד/ת ללוח העסקאות"
          onClick={() => onRestore(person)}
          className="rounded-md border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/60 px-2 py-0.5 text-[11px] font-medium"
        >
          <span dir="auto">{t('chrome.bench.restore')}</span>
        </button>
        <button
          type="button"
          data-testid="bench-rematch"
          disabled={hasPendingRematch}
          title={
            hasPendingRematch
              ? 'בקשת התאמה מחדש כבר ממתינה בסבב הסוכנים'
              : 'בקשה מאיתור מהספסל לחפש התאמות חדשות'
          }
          onClick={() => onRematch(person)}
          className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-default px-2 py-0.5 text-[11px]"
        >
          <span dir="auto">{hasPendingRematch ? 'בקשה ממתינה' : 'התאמה מחדש'}</span>
        </button>
      </div>
    </div>
  );
}

export function BenchRail({ now = Date.now }: { now?: () => number }) {
  const persons = usePipelineStore((s) => s.persons);
  const deals = usePipelineStore((s) => s.deals);
  const stageEvents = usePipelineStore((s) => s.stageEvents);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const moveDeal = usePipelineStore((s) => s.moveDeal);
  const addDeal = usePipelineStore((s) => s.addDeal);
  const upsertPerson = usePipelineStore((s) => s.upsertPerson);
  const addSuggestion = usePipelineStore((s) => s.addSuggestion);

  const { setNodeRef, isOver } = useDroppable({ id: BENCH_RAIL.id });

  // persons is the reactive dependency; the selector reads fresh state.
  const grouped = useMemo(() => benchBySilver(), [persons]);
  const benched = useMemo(
    () => [...grouped.silver, ...grouped.others],
    [grouped],
  );
  const pendingRematch = useMemo(
    () => pendingRematchPersonIds(suggestions),
    [suggestions],
  );

  const clearBench = (person: PersonWithBenchMeta) => {
    const { bench: _bench, ...rest } = person;
    upsertPerson(rest);
  };

  const onRestore = (person: PersonWithBenchMeta) => {
    const plan = restorePlanForPerson(person.id, deals, stageEvents);
    if (plan.kind === 'move') {
      moveDeal(plan.dealId, plan.to);
    } else if (plan.kind === 'recreate') {
      addDeal({
        personId: person.id,
        jobId: plan.jobId,
        jobTitle: plan.jobTitle,
        stage: plan.to,
      });
    }
    clearBench(person);
  };

  const onRematch = (person: PersonWithBenchMeta) => {
    if (pendingRematch.has(person.id)) return; // one pending request each
    const reason = person.bench?.benchReason ?? person.bench?.reason ?? '';
    const evidence = [
      {
        claim: reason !== '' ? `סיבת הספסל: ${reason}` : 'רשומ/ה על הספסל',
        sourceType: 'person',
        sourceId: person.id,
      },
      ...(person.bench?.silverMedalist === true
        ? [
            {
              claim: t('bench.silverMedalist'),
              sourceType: 'person',
              sourceId: person.id,
            },
          ]
        : []),
    ];
    addSuggestion({
      agent: 'bench_sourcer',
      kind: 'rematch',
      personId: person.id,
      title: `בקשת התאמה מחדש מהספסל: ${person.name}`,
      body:
        'רויטל ביקשה לבדוק התאמות חדשות מהספסל מול המנדטים הפתוחים. ' +
        'איתור מהספסל יטפל בבקשה בסבב הבא ויחזיר הצעות התאמה מנומקות לאישור.',
      evidence,
    });
  };

  return (
    <aside
      ref={setNodeRef}
      aria-label={BENCH_RAIL.en}
      data-testid="bench-rail"
      className={`flex flex-col w-56 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-950/30 border ${
        isOver
          ? 'border-amber-400 ring-2 ring-amber-400/50'
          : 'border-amber-200 dark:border-amber-900'
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
          <p
            dir="auto"
            className="text-xs text-slate-400 dark:text-slate-500 text-start ps-1"
          >
            הספסל ריק — מועמדים שנדחו נשמרים כאן לשימוש חוזר
          </p>
        ) : (
          benched.map((p) => (
            <BenchCard
              key={p.id}
              person={p}
              hasPendingRematch={pendingRematch.has(p.id)}
              onRestore={onRestore}
              onRematch={onRematch}
              now={now}
            />
          ))
        )}
      </div>
    </aside>
  );
}

export default BenchRail;
