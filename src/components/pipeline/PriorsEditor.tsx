/**
 * PriorsEditor — per-stage probability range editor — Wave 2 (kanban-ui).
 *
 * Popover panel over the money store's editable stage priors
 * (persisted `revital_v3_priors`, sanitized by the lib). Edits go through
 * `setStagePrior` (audited per stage); "reset" restores the defaults.
 *
 * Percentages only — this panel deliberately contains no ₪: priors are
 * probabilities and are editable regardless of calibration state.
 * A stage that has blended with ≥10 observed outcomes shows a chip —
 * its DISPLAYED probability is the blend, the prior stays editable.
 *
 * BiDi: labels dir="auto"; numeric inputs dir="ltr"; logical CSS only.
 */

import { useMemo, useState } from 'react';
import type { PipelineStage } from '../../types/pipeline';
import {
  BLEND_MIN_OBSERVATIONS,
  useMoneyStore,
  type ObservedByStage,
} from '../../lib/money';
import { STAGE_COLUMNS } from './stages';

interface DraftRange {
  lo: string;
  hi: string;
}

function toPercentString(p: number): string {
  return String(parseFloat((p * 100).toFixed(2)));
}

function parsePercent(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return parseFloat((n / 100).toFixed(4));
}

/** Valid ⇒ {lo,hi} in 0..1 with lo ≤ hi; otherwise null. */
export function draftToRange(draft: DraftRange): { lo: number; hi: number } | null {
  const lo = parsePercent(draft.lo);
  const hi = parsePercent(draft.hi);
  if (lo === null || hi === null || lo > hi) return null;
  return { lo, hi };
}

export function PriorsEditor({
  observed,
  onClose,
}: {
  observed?: ObservedByStage;
  onClose: () => void;
}) {
  const priors = useMoneyStore((s) => s.priors);
  const setStagePrior = useMoneyStore((s) => s.setStagePrior);
  const resetPriors = useMoneyStore((s) => s.resetPriors);

  const initial = useMemo(() => {
    const out = {} as Record<PipelineStage, DraftRange>;
    for (const col of STAGE_COLUMNS) {
      out[col.id] = {
        lo: toPercentString(priors[col.id].lo),
        hi: toPercentString(priors[col.id].hi),
      };
    }
    return out;
  }, [priors]);

  const [draft, setDraft] = useState<Record<PipelineStage, DraftRange>>(initial);

  const invalidStages = STAGE_COLUMNS.filter(
    (c) => draftToRange(draft[c.id]) === null,
  ).map((c) => c.id);

  const setField = (stage: PipelineStage, field: 'lo' | 'hi', value: string) => {
    setDraft((d) => ({ ...d, [stage]: { ...d[stage], [field]: value } }));
  };

  const onSave = () => {
    if (invalidStages.length > 0) return;
    for (const col of STAGE_COLUMNS) {
      const range = draftToRange(draft[col.id]);
      if (!range) continue;
      const current = priors[col.id];
      if (range.lo !== current.lo || range.hi !== current.hi) {
        setStagePrior(col.id, range);
      }
    }
    onClose();
  };

  return (
    <>
      {/* transparent click-away backdrop */}
      <div
        data-testid="priors-backdrop"
        className="fixed inset-0 z-30"
        onClick={onClose}
      />
      <div
        data-testid="priors-editor"
        role="dialog"
        aria-label="הסתברויות שלב"
        className="absolute z-40 top-full mt-1 start-0 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg ps-4 pe-4 py-3 flex flex-col gap-2"
      >
        <header className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            <span dir="auto">הסתברות הגעה לתשלום, לפי שלב</span>
          </h4>
        </header>
        <p dir="auto" className="text-[11px] text-slate-500 dark:text-slate-400 text-start">
          טווח באחוזים (נמוך–גבוה). מ-{BLEND_MIN_OBSERVATIONS} תוצאות אמת השלב
          משתקלל אוטומטית עם הנתונים.
        </p>
        <ul className="flex flex-col gap-1">
          {STAGE_COLUMNS.map((col) => {
            const blended =
              (observed?.[col.id]?.n ?? 0) >= BLEND_MIN_OBSERVATIONS;
            const invalid = invalidStages.includes(col.id);
            return (
              <li key={col.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">
                  <span dir="auto">{col.he}</span>{' '}
                  <span dir="auto" className="text-slate-400 dark:text-slate-500">
                    {col.en}
                  </span>
                </span>
                {blended && (
                  <span
                    dir="auto"
                    title={`שוקלל מ-${observed?.[col.id]?.n} תוצאות`}
                    className="shrink-0 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 px-1.5 py-px text-[10px]"
                  >
                    משוקלל
                  </span>
                )}
                <input
                  type="number"
                  dir="ltr"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  aria-label={`${col.en} lower percent`}
                  data-testid={`prior-lo-${col.id}`}
                  value={draft[col.id].lo}
                  onChange={(e) => setField(col.id, 'lo', e.target.value)}
                  className={`w-14 shrink-0 rounded-md border px-1 py-0.5 text-xs tabular-nums bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                    invalid
                      ? 'border-rose-400'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                />
                <span className="shrink-0 text-xs text-slate-400">–</span>
                <input
                  type="number"
                  dir="ltr"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  aria-label={`${col.en} upper percent`}
                  data-testid={`prior-hi-${col.id}`}
                  value={draft[col.id].hi}
                  onChange={(e) => setField(col.id, 'hi', e.target.value)}
                  className={`w-14 shrink-0 rounded-md border px-1 py-0.5 text-xs tabular-nums bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${
                    invalid
                      ? 'border-rose-400'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                />
                <span className="shrink-0 text-[10px] text-slate-400">%</span>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="priors-save"
            disabled={invalidStages.length > 0}
            onClick={onSave}
            className="rounded-md bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-2.5 py-1 text-xs font-medium"
          >
            שמירה
          </button>
          <button
            type="button"
            data-testid="priors-reset"
            onClick={() => {
              resetPriors();
              onClose();
            }}
            className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
          >
            איפוס לברירת מחדל
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ms-auto rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1 text-xs"
          >
            סגירה
          </button>
        </div>
      </div>
    </>
  );
}

export default PriorsEditor;
