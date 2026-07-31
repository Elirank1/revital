/**
 * PipelineView — Wave 0 scaffold (kanban-ui).
 *
 * Flag OFF (default): renders null — byte-identical to V2, not reachable.
 * Flag ON: a BiDi-safe placeholder board frame — 9 stage columns
 * (Hebrew + English headers) + Bench rail. No data, no drag (dnd-kit is
 * Wave 1), no store wiring yet.
 *
 * BiDi rules (plan §2, charter): every content node carries dir="auto";
 * layout uses logical Tailwind utilities (ps-/pe-/ms-/me-/text-start) —
 * no pl-/pr-/ml-/mr-/text-left on content. Desktop-first.
 *
 * Deliberately hook-free in Wave 0 so it stays a pure function of the flag
 * (also lets unit tests call it directly without a DOM renderer).
 */
import { isV3Enabled } from '../../components/pipeline/flags';
import { STAGE_COLUMNS, BENCH_RAIL } from '../../components/pipeline/stages';
import type { StageColumnDef } from '../../components/pipeline/stages';

function StageColumn({ stage }: { stage: StageColumnDef }) {
  return (
    <section
      aria-label={stage.en}
      className="flex flex-col w-64 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"
    >
      <header className="flex items-baseline justify-between gap-2 ps-3 pe-3 pt-3 pb-2 border-b border-slate-200 dark:border-slate-700">
        <h3 className="min-w-0 text-sm font-semibold text-slate-900 dark:text-white">
          <span dir="auto">{stage.he}</span>{' '}
          <span dir="auto" className="font-normal text-slate-500 dark:text-slate-400">
            {stage.en}
          </span>
        </h3>
        {/* Per-column count placeholder — WIP signals (count + ΣEV) land with real data in Wave 1+. */}
        <span
          dir="auto"
          className="text-xs tabular-nums text-slate-400 dark:text-slate-500"
        >
          0
        </span>
      </header>
      <div className="flex-1 ps-3 pe-3 py-3">
        <p dir="auto" className="text-xs text-slate-400 dark:text-slate-500 text-start">
          אין עסקאות עדיין
        </p>
      </div>
    </section>
  );
}

export function PipelineView() {
  if (!isV3Enabled()) return null;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Board header */}
      <header className="flex items-baseline gap-3">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          <span dir="auto">לוח עסקאות</span>{' '}
          <span dir="auto" className="text-brand-600 dark:text-brand-400">
            Pipeline
          </span>
        </h2>
        <p dir="auto" className="text-sm text-slate-500 dark:text-slate-400 text-start">
          Wave 0 scaffold — board frame only
        </p>
      </header>

      {/* Columns + Bench rail */}
      <div className="flex flex-1 min-h-0 gap-4 items-stretch">
        <div className="flex-1 min-w-0 overflow-x-auto pb-2">
          <div className="flex h-full min-w-max gap-3">
            {STAGE_COLUMNS.map((stage) => (
              <StageColumn key={stage.id} stage={stage} />
            ))}
          </div>
        </div>

        {/* Bench rail placeholder */}
        <aside
          aria-label={BENCH_RAIL.en}
          className="flex flex-col w-56 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900"
        >
          <header className="ps-3 pe-3 pt-3 pb-2 border-b border-amber-200 dark:border-amber-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              <span dir="auto">{BENCH_RAIL.he}</span>{' '}
              <span dir="auto" className="font-normal text-slate-500 dark:text-slate-400">
                {BENCH_RAIL.en}
              </span>
            </h3>
          </header>
          <div className="flex-1 ps-3 pe-3 py-3">
            <p dir="auto" className="text-xs text-slate-400 dark:text-slate-500 text-start">
              מועמדים לשימוש חוזר — Wave 3
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default PipelineView;
