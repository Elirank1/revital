/**
 * FeeCapture — mandate fee modal — Wave 2 (kanban-ui).
 *
 * Two entry points: automatically when a card is dragged into Placed
 * (the moment fee/invoice reality changes) and on demand as the
 * mandate-level fee editor (Money Board lane header). Writes go through
 * `useMoneyStore.setFee` — audited, persisted `revital_v3_fees`.
 * Cancel/Escape/backdrop close WITHOUT mutating anything.
 *
 * The computed-fee preview renders ONLY when the typed draft is complete
 * (feeAmount != null) — this form is the calibration instrument, so the
 * derived amount of the numbers being typed is shown, but never a 0 and
 * never a placeholder. Board surfaces stay gated by mandateCalibrated.
 *
 * BiDi: labels dir="auto", numeric/date inputs dir="ltr"; logical CSS.
 */

import { useEffect, useState } from 'react';
import {
  feeAmount,
  useMoneyStore,
  type MandateFee,
  type MandateFeeKind,
  type MandateInvoiceStatus,
} from '../../lib/money';
import { formatILS } from './money';

export interface FeeCaptureProps {
  jobId: string;
  jobTitle: string;
  /** 'placed' = opened by a drag into Placed; 'edit' = mandate fee editor. */
  context?: 'placed' | 'edit';
  onClose: () => void;
}

const INVOICE_OPTIONS: { value: MandateInvoiceStatus; label: string }[] = [
  { value: 'none', label: 'ללא חשבונית' },
  { value: 'due', label: 'לתשלום' },
  { value: 'sent', label: 'נשלחה' },
  { value: 'paid', label: 'שולמה' },
];

function numOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Draft → the MandateFee shape feeAmount validates (preview + save payload). */
export function draftFee(args: {
  jobId: string;
  kind: MandateFeeKind;
  percent: string;
  expectedSalary: string;
  fixedAmount: string;
}): Pick<MandateFee, 'jobId' | 'kind' | 'percent' | 'expectedSalary' | 'fixedAmount'> {
  return {
    jobId: args.jobId,
    kind: args.kind,
    ...(args.kind === 'percent'
      ? {
          percent: numOrUndefined(args.percent),
          expectedSalary: numOrUndefined(args.expectedSalary),
        }
      : { fixedAmount: numOrUndefined(args.fixedAmount) }),
  };
}

export function FeeCapture({ jobId, jobTitle, context = 'edit', onClose }: FeeCaptureProps) {
  const existing = useMoneyStore((s) => s.fees[jobId]);
  const setFee = useMoneyStore((s) => s.setFee);

  const [kind, setKind] = useState<MandateFeeKind>(existing?.kind ?? 'percent');
  const [percent, setPercent] = useState(existing?.percent != null ? String(existing.percent) : '');
  const [expectedSalary, setExpectedSalary] = useState(
    existing?.expectedSalary != null ? String(existing.expectedSalary) : '',
  );
  const [fixedAmount, setFixedAmount] = useState(
    existing?.fixedAmount != null ? String(existing.fixedAmount) : '',
  );
  const [guaranteeDays, setGuaranteeDays] = useState(
    existing?.guaranteeDays != null ? String(existing.guaranteeDays) : '0',
  );
  const [invoiceStatus, setInvoiceStatus] = useState<MandateInvoiceStatus>(
    existing?.invoiceStatus ?? 'none',
  );
  const [invoiceDueAt, setInvoiceDueAt] = useState(existing?.invoiceDueAt?.slice(0, 10) ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const preview = feeAmount({
    ...draftFee({ jobId, kind, percent, expectedSalary, fixedAmount }),
    currency: 'ILS',
    guaranteeDays: 0,
    invoiceStatus: 'none',
    updatedAt: '',
  });

  const onSave = () => {
    const base = draftFee({ jobId, kind, percent, expectedSalary, fixedAmount });
    setFee({
      jobId,
      kind: base.kind,
      ...(base.percent !== undefined ? { percent: base.percent } : {}),
      ...(base.expectedSalary !== undefined ? { expectedSalary: base.expectedSalary } : {}),
      ...(base.fixedAmount !== undefined ? { fixedAmount: base.fixedAmount } : {}),
      guaranteeDays: numOrUndefined(guaranteeDays) ?? 0,
      invoiceStatus,
      ...(invoiceDueAt ? { invoiceDueAt } : {}),
    });
    onClose();
  };

  const inputClass =
    'rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2 py-1 text-sm tabular-nums';

  return (
    <div
      data-testid="fee-capture"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        data-testid="fee-capture-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="עמלת מנדט"
        className="relative z-10 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl ps-4 pe-4 py-3 flex flex-col gap-2.5"
      >
        <header className="flex flex-col gap-0.5">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            <span dir="auto">
              {context === 'placed' ? 'הושמה! עדכון עמלת המנדט' : 'עמלת מנדט'}
            </span>
          </h3>
          <p dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
            {jobTitle}
          </p>
        </header>

        {/* Fee kind */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="fee-kind"
              data-testid="fee-kind-percent"
              checked={kind === 'percent'}
              onChange={() => setKind('percent')}
            />
            <span dir="auto">אחוז מהשכר</span>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="radio"
              name="fee-kind"
              data-testid="fee-kind-fixed"
              checked={kind === 'fixed'}
              onChange={() => setKind('fixed')}
            />
            <span dir="auto">סכום קבוע</span>
          </label>
        </div>

        {kind === 'percent' ? (
          <div className="flex items-center gap-2">
            <label className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span dir="auto">אחוז</span>
              <input
                type="number"
                dir="ltr"
                inputMode="decimal"
                min={0}
                data-testid="fee-percent"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className={`w-20 ${inputClass}`}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400 flex-1">
              <span dir="auto">שכר שנתי צפוי (ש״ח)</span>
              <input
                type="number"
                dir="ltr"
                inputMode="numeric"
                min={0}
                data-testid="fee-salary"
                value={expectedSalary}
                onChange={(e) => setExpectedSalary(e.target.value)}
                className={`w-full ${inputClass}`}
              />
            </label>
          </div>
        ) : (
          <label className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span dir="auto">סכום קבוע (ש״ח)</span>
            <input
              type="number"
              dir="ltr"
              inputMode="numeric"
              min={0}
              data-testid="fee-fixed"
              value={fixedAmount}
              onChange={(e) => setFixedAmount(e.target.value)}
              className={`w-full ${inputClass}`}
            />
          </label>
        )}

        {preview !== null && (
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <span dir="auto">עמלה מחושבת: </span>
            <span
              dir="ltr"
              data-testid="fee-preview"
              className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300"
            >
              {formatILS(preview)}
            </span>
          </p>
        )}

        <div className="flex items-center gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span dir="auto">ימי אחריות</span>
            <input
              type="number"
              dir="ltr"
              inputMode="numeric"
              min={0}
              data-testid="fee-guarantee"
              value={guaranteeDays}
              onChange={(e) => setGuaranteeDays(e.target.value)}
              className={`w-20 ${inputClass}`}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400 flex-1">
            <span dir="auto">סטטוס חשבונית</span>
            <select
              data-testid="fee-invoice-status"
              value={invoiceStatus}
              onChange={(e) => setInvoiceStatus(e.target.value as MandateInvoiceStatus)}
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2 py-1 text-sm"
            >
              {INVOICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(invoiceStatus === 'due' || invoiceStatus === 'sent') && (
          <label className="flex flex-col gap-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span dir="auto">תאריך יעד לתשלום</span>
            <input
              type="date"
              dir="ltr"
              data-testid="fee-invoice-due"
              value={invoiceDueAt}
              onChange={(e) => setInvoiceDueAt(e.target.value)}
              className={inputClass}
            />
          </label>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="fee-save"
            onClick={onSave}
            className="rounded-md bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 text-sm font-medium"
          >
            שמירה
          </button>
          <button
            type="button"
            data-testid="fee-cancel"
            onClick={onClose}
            className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1.5 text-sm"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

export default FeeCapture;
