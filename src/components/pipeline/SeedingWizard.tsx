/**
 * SeedingWizard — per-mandate progressive seeding — Wave 3 C-seed (kanban-ui).
 *
 * D-042: the human seeding session is replaced by in-product seeding.
 * When the board is viewed and a mandate is unseeded AND has cards
 * (especially backfilled ones), this surfaces a NON-BLOCKING, dismissible
 * banner panel — never a modal that locks the board; Revital can always
 * keep working. Dismissing leaves a "השלימי הגדרה" chip per unseeded
 * mandate to reopen later.
 *
 * Steps per mandate:
 *   1. ONE fee field — reuses FeeCapture (the existing mandate-level fee
 *      editor, opened on demand; user-initiated + cancellable).
 *   2. Stage confirmation — the mandate's live cards (backfilled ones
 *      badged and listed first) each get a quick stage-picker wired to
 *      `moveDeal` (single writer). Dragging on the board itself works
 *      too: the list renders live store state.
 *   3. Finish → `markMandateSeeded(jobId)` (audited, one-way) →
 *      calibration lifts for THAT mandate only; the done step shows the
 *      auto-derived baseline card (`deriveBaseline`, nulls render '—').
 *
 * The banner also carries the async-form copy button: `buildPendingSeeding`
 * → `asyncSeedingFormText` → clipboard. Composition ONLY — nothing is
 * sent (G4); Revital pastes it into WhatsApp/email herself.
 *
 * HARD RULE: this component renders NO ₪, ever. An unseeded mandate is
 * uncalibrated by definition and the baseline metrics carry no money
 * figures (D-047). The only ₪ in the flow lives inside FeeCapture's own
 * preview — the calibration instrument, unchanged Wave-2 behavior.
 *
 * BiDi: user content dir="auto"; numbers dir="ltr"; logical CSS only.
 */

import { useMemo, useState } from 'react';
import { usePipelineStore } from '../../store/pipelineStore';
import { useAppStore } from '../../store/appStore';
import { backfillDealId } from '../../lib/backfill';
import { flattenContacts } from '../../lib/metrics/leadingIndicators';
import {
  asyncSeedingFormText,
  buildPendingSeeding,
  deriveBaseline,
  feeAmount,
  isSeeded,
  useMoneyStore,
  type BaselineMetrics,
  type SeedingState,
} from '../../lib/money';
import type { Deal, DealStage, PipelineStage } from '../../types/pipeline';
import { PIPELINE_STAGES } from '../../types/pipeline';
import { STAGE_COLUMNS } from './stages';
import { FeeCapture } from './FeeCapture';

// ------------------------------------------------------------
// Pure helpers (exported for tests)
// ------------------------------------------------------------

/** Deterministic backfill id check — a card the importer created. */
export function isBackfilledDeal(deal: Deal): boolean {
  return deal.analysisId != null && deal.id === backfillDealId(deal.analysisId);
}

export interface SeedingWorkItem {
  jobId: string;
  jobTitle: string;
  /** Live pipeline-stage cards awaiting stage confirmation — backfilled
   *  cards first (they are the reason the wizard exists). */
  cards: Deal[];
  hasBackfilled: boolean;
}

const PIPELINE_STAGE_SET = new Set<string>(PIPELINE_STAGES);

/**
 * The wizard worklist: mandates present on the board (≥1 live deal) that
 * are NOT yet seeded. Reactive twin of the store's `unseededMandates()`
 * (which reads getState) — computed from subscribed slices so chips
 * appear/disappear live. Mandates with backfilled cards sort first.
 */
export function seedingWorklist(
  deals: Deal[],
  seeding: SeedingState,
): SeedingWorkItem[] {
  const byJob = new Map<string, SeedingWorkItem>();
  for (const d of deals) {
    if (d.deleted) continue;
    if (isSeeded(d.jobId, seeding)) continue;
    let item = byJob.get(d.jobId);
    if (!item) {
      item = { jobId: d.jobId, jobTitle: d.jobTitle, cards: [], hasBackfilled: false };
      byJob.set(d.jobId, item);
    }
    if (PIPELINE_STAGE_SET.has(d.stage)) item.cards.push(d);
    if (isBackfilledDeal(d)) item.hasBackfilled = true;
  }
  const items = Array.from(byJob.values());
  for (const item of items) {
    item.cards.sort((a, b) => Number(isBackfilledDeal(b)) - Number(isBackfilledDeal(a)));
  }
  // Stable: backfill-carrying mandates first, insertion order otherwise.
  return items.sort((a, b) => Number(b.hasBackfilled) - Number(a.hasBackfilled));
}

/** '—' for null (never fabricated), trimmed decimals otherwise. */
export function formatMetric(value: number | null, digits: 0 | 1 = 1): string {
  if (value === null) return '—';
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

export interface BaselineRow {
  key: string;
  label: string;
  value: string;
}

/** Display rows for the baseline summary card — Hebrew, no ₪, nulls → '—'. */
export function baselineRows(b: BaselineMetrics): BaselineRow[] {
  return [
    { key: 'candidatesPerDay', label: 'מועמדים ביום', value: formatMetric(b.candidatesPerDay, 1) },
    { key: 'followUpLatencyDays', label: 'ימים עד תזכורת', value: formatMetric(b.followUpLatencyDays, 1) },
    { key: 'activeMandateCount', label: 'משרות פעילות', value: formatMetric(b.activeMandateCount, 0) },
    { key: 'inFlightDealCount', label: 'מועמדויות בתהליך', value: formatMetric(b.inFlightDealCount, 0) },
  ];
}

// ------------------------------------------------------------
// Baseline summary card (done step) — no ₪ by construction (D-047)
// ------------------------------------------------------------

function BaselineCard({ baseline }: { baseline: BaselineMetrics }) {
  return (
    <div
      data-testid="baseline-card"
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-3 pe-3 py-2 flex flex-col gap-1.5"
    >
      <h4 dir="auto" className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-start">
        נקודת פתיחה — נגזר מהנתונים הקיימים
      </h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {baselineRows(baseline).map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-2">
            <dt dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
              {row.label}
            </dt>
            <dd
              dir="ltr"
              data-testid={`baseline-${row.key}`}
              className="text-xs font-semibold tabular-nums text-slate-900 dark:text-white"
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p dir="auto" className="text-[11px] text-slate-400 dark:text-slate-500 text-start">
        — = אין מספיק נתונים. השאלות החסרות נכללות בטופס ההשלמה.
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// The wizard host: chips banner + at most one open panel
// ------------------------------------------------------------

export function SeedingWizardHost() {
  const deals = usePipelineStore((s) => s.deals);
  const persons = usePipelineStore((s) => s.persons);
  const stageEvents = usePipelineStore((s) => s.stageEvents);
  const suggestions = usePipelineStore((s) => s.suggestions);
  const moveDeal = usePipelineStore((s) => s.moveDeal);
  // READ-ONLY legacy subscription (Wave-1 rule): history for deriveBaseline.
  const analyses = useAppStore((s) => s.analyses);
  const analysisLog = useAppStore((s) => s.analysisLog);
  const fees = useMoneyStore((s) => s.fees);
  const seeding = useMoneyStore((s) => s.seeding);
  const markMandateSeeded = useMoneyStore((s) => s.markMandateSeeded);

  const worklist = useMemo(() => seedingWorklist(deals, seeding), [deals, seeding]);

  // First-open: auto-surface the first unseeded mandate ONCE per mount —
  // a banner panel, not a modal; dismiss leaves only the chips.
  const [openJobId, setOpenJobId] = useState<string | null>(() => {
    const initial = seedingWorklist(
      usePipelineStore.getState().deals,
      useMoneyStore.getState().seeding,
    );
    return initial[0]?.jobId ?? null;
  });
  const [confirmedStages, setConfirmedStages] = useState<ReadonlySet<string>>(new Set());
  const [feeOpen, setFeeOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const contacts = useMemo(() => flattenContacts(persons), [persons]);
  const baseline = useMemo(
    () =>
      deriveBaseline(analyses, analysisLog, stageEvents, contacts, {
        deals,
        suggestions,
      }),
    [analyses, analysisLog, stageEvents, contacts, deals, suggestions],
  );

  // Remaining questions → shareable Hebrew text ('' when nothing pending).
  const formText = useMemo(
    () =>
      asyncSeedingFormText(
        buildPendingSeeding({ deals, persons, fees, seeding, baseline }),
      ),
    [deals, persons, fees, seeding, baseline],
  );

  const openItem = openJobId
    ? worklist.find((w) => w.jobId === openJobId) ?? null
    : null;
  const openSeeded = openJobId !== null && isSeeded(openJobId, seeding);
  // Title survives completion (the item leaves the worklist once seeded).
  const openTitle =
    openItem?.jobTitle ??
    (openJobId ? deals.find((d) => !d.deleted && d.jobId === openJobId)?.jobTitle ?? openJobId : '');

  if (worklist.length === 0 && formText === '' && !(openJobId && openSeeded)) {
    return null;
  }

  const feeComplete = openJobId ? feeAmount(fees[openJobId] ?? null) !== null : false;
  const stagesOk = openJobId ? confirmedStages.has(openJobId) : false;

  const onCopyForm = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(formText);
      } else {
        // Legacy fallback — still pure composition, nothing leaves the app.
        const ta = document.createElement('textarea');
        ta.value = formText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the button simply stays uncopied */
    }
  };

  const onConfirmStages = () => {
    if (!openJobId) return;
    setConfirmedStages((prev) => new Set(prev).add(openJobId));
  };

  const onFinish = () => {
    if (!openJobId || !feeComplete || !stagesOk) return;
    markMandateSeeded(openJobId); // audited, idempotent, one-way (D-046)
  };

  const personName = (personId: string): string | undefined =>
    persons.find((p) => p.id === personId && !p.deleted)?.name;

  return (
    <div data-testid="seeding-banner" className="flex flex-col gap-2">
      {/* Chips row: one per unseeded mandate + the async-form copy button */}
      {(worklist.length > 0 || formText !== '') && (
        <div className="flex flex-wrap items-center gap-2">
          {worklist.map((item) => (
            <button
              key={item.jobId}
              type="button"
              data-testid={`seeding-chip-${item.jobId}`}
              aria-expanded={openJobId === item.jobId}
              onClick={() => setOpenJobId(item.jobId)}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 ps-3 pe-3 py-1 text-xs text-amber-800 dark:text-amber-200"
            >
              <span dir="auto" className="font-semibold">השלימי הגדרה</span>
              <span dir="auto" className="max-w-40 truncate">{item.jobTitle}</span>
            </button>
          ))}
          {formText !== '' && (
            <button
              type="button"
              data-testid="seeding-copy-form"
              onClick={onCopyForm}
              title="מעתיק את השאלות שנותרו כטקסט לשליחה בוואטסאפ או במייל — לא נשלח דבר אוטומטית"
              className="inline-flex items-center rounded-full border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 ps-3 pe-3 py-1 text-xs text-slate-600 dark:text-slate-300"
            >
              <span dir="auto">{copied ? 'הועתק ✓' : 'העתיקי טופס השלמה'}</span>
            </button>
          )}
        </div>
      )}

      {/* The wizard panel — in-flow, non-blocking, dismissible */}
      {openJobId && (openItem || openSeeded) && (
        <section
          data-testid="seeding-wizard"
          aria-label="אשף הגדרת מנדט"
          className="rounded-xl border border-amber-200 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-900/15 ps-4 pe-4 py-3 flex flex-col gap-2.5"
        >
          <header className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-sm font-bold text-slate-900 dark:text-white">
              <span dir="auto">{openSeeded ? 'המשרה הוגדרה ✓' : 'הגדרה ראשונית'}</span>{' '}
              <span dir="auto" className="font-normal text-slate-600 dark:text-slate-300">
                {openTitle}
              </span>
            </h3>
            <button
              type="button"
              data-testid="seeding-dismiss"
              aria-label="סגירת האשף"
              onClick={() => setOpenJobId(null)}
              className="shrink-0 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1.5 py-0.5 text-sm leading-none"
            >
              ✕
            </button>
          </header>

          {openSeeded ? (
            /* -------- Done step: baseline summary, no ₪ -------- */
            <div data-testid="seeding-done" className="flex flex-col gap-2">
              <p dir="auto" className="text-xs text-slate-600 dark:text-slate-300 text-start">
                הכיול הופעל למשרה הזו — הלוח יציג עבורה צפי כספי מעכשיו.
              </p>
              <BaselineCard baseline={baseline} />
              <div>
                <button
                  type="button"
                  data-testid="seeding-close"
                  onClick={() => setOpenJobId(null)}
                  className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1 text-xs"
                >
                  סגירה
                </button>
              </div>
            </div>
          ) : (
            openItem && (
              <>
                <p dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
                  בלי ההגדרה לא מוצג צפי כספי למשרה. הלוח ממשיך לעבוד כרגיל — אפשר לסגור ולחזור מתי שנוח.
                </p>

                {/* Step 1 — the ONE fee field (FeeCapture reuse) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="auto" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    1 · עמלת המנדט
                  </span>
                  {feeComplete ? (
                    <>
                      <span
                        dir="auto"
                        data-testid="seeding-fee-done"
                        className="text-xs text-emerald-700 dark:text-emerald-300"
                      >
                        עמלה הוזנה ✓
                      </span>
                      <button
                        type="button"
                        data-testid="seeding-fee-edit"
                        onClick={() => setFeeOpen(true)}
                        className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 py-0.5 text-[11px]"
                      >
                        <span dir="auto">עריכה</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-testid="seeding-fee-button"
                      onClick={() => setFeeOpen(true)}
                      className="rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 text-xs font-medium"
                    >
                      <span dir="auto">הזנת עמלה</span>
                    </button>
                  )}
                </div>

                {/* Step 2 — backfilled cards → TRUE stage */}
                <div className="flex flex-col gap-1.5">
                  <span dir="auto" className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    2 · אישור שלבים
                  </span>
                  {openItem.cards.length === 0 ? (
                    <p dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
                      אין כרטיסים פעילים לאישור במשרה הזו.
                    </p>
                  ) : (
                    <>
                      <p dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
                        בדקי שכל מועמד נמצא בשלב הנכון — אפשר לבחור כאן או לגרור את הכרטיס על הלוח.
                      </p>
                      <ul className="flex flex-col gap-1">
                        {openItem.cards.map((deal) => (
                          <li
                            key={deal.id}
                            data-testid={`seeding-card-${deal.id}`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span dir="auto" className="text-xs text-slate-800 dark:text-slate-100 min-w-24">
                              {personName(deal.personId) ?? deal.jobTitle}
                            </span>
                            {isBackfilledDeal(deal) && (
                              <span
                                dir="auto"
                                className="rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 ps-2 pe-2 py-px text-[10px]"
                              >
                                יובא אוטומטית
                              </span>
                            )}
                            <select
                              data-testid={`seeding-stage-${deal.id}`}
                              aria-label="שלב בפועל"
                              value={deal.stage}
                              onChange={(e) => {
                                const to = e.target.value as DealStage;
                                if (to !== deal.stage) {
                                  // Single writer: the audited store move
                                  // (undoable like any board drag).
                                  moveDeal(deal.id, to, {
                                    reason: 'אישור שלב באשף ההגדרה',
                                  });
                                }
                              }}
                              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-1.5 py-0.5 text-xs"
                            >
                              {STAGE_COLUMNS.map((c: { id: PipelineStage; he: string; en: string }) => (
                                <option key={c.id} value={c.id}>
                                  {`${c.he} · ${c.en}`}
                                </option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {stagesOk ? (
                    <span
                      dir="auto"
                      data-testid="seeding-stages-done"
                      className="text-xs text-emerald-700 dark:text-emerald-300"
                    >
                      השלבים אושרו ✓
                    </span>
                  ) : (
                    <div>
                      <button
                        type="button"
                        data-testid="seeding-stages-confirm"
                        onClick={onConfirmStages}
                        className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs"
                      >
                        <span dir="auto">השלבים נכונים ✓</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Finish — lifts calibration for THIS mandate only */}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    data-testid="seeding-finish"
                    disabled={!feeComplete || !stagesOk}
                    onClick={onFinish}
                    title={
                      feeComplete && stagesOk
                        ? undefined
                        : 'נדרשות עמלה ואישור שלבים כדי לסיים'
                    }
                    className="rounded-md bg-emerald-600 enabled:hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 text-xs font-semibold"
                  >
                    <span dir="auto">סיום והפעלה</span>
                  </button>
                </div>
              </>
            )
          )}
        </section>
      )}

      {/* The one fee field — the existing mandate-level editor, on demand */}
      {feeOpen && openJobId && (
        <FeeCapture
          jobId={openJobId}
          jobTitle={openTitle}
          context="edit"
          onClose={() => setFeeOpen(false)}
        />
      )}
    </div>
  );
}

export default SeedingWizardHost;
