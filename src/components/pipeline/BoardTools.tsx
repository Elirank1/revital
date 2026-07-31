/**
 * BoardTools — board tools menu — Wave 2 (kanban-ui).
 *
 * Two tools behind a "כלים" dropdown in the board header:
 *
 * 1. Export-everything: `exportAllJson()` (platform-data lib — every
 *    revital_* localStorage key, read-only) downloaded as a JSON file via
 *    a transient `<a download>` + Blob URL. Local file save only — no
 *    navigation API, no network (G4-clean by construction). The download
 *    mechanism is injectable for tests/jsdom.
 *
 * 2. Backfill panel: `backfillDryRun` report FIRST (read-only), then an
 *    explicit confirm button calls `backfillApply(..., { confirm: true })`
 *    — the lib itself stays flag-gated + backup-first (G2 discipline).
 *    Legacy analyses come from a READ-ONLY useAppStore subscription.
 *
 * BiDi: names dir="auto"; logical CSS; counts tabular.
 */

import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import {
  exportAllJson,
  exportFilename,
} from '../../lib/persistence/exportAll';
import {
  backfillApply,
  backfillDryRun,
  type BackfillApplyResult,
  type BackfillReport,
} from '../../lib/backfill';

export type DownloadFn = (json: string, filename: string) => void;

/** Default download: Blob URL + transient anchor click (no navigation API). */
export function blobDownload(json: string, filename: string): void {
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch {
    // Storage/Blob unavailable — nothing to download, never throw into UI.
  }
}

const ITEMS_SHOWN = 8;

function ReportRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
      <span dir="auto">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </li>
  );
}

export function BoardTools({ download = blobDownload }: { download?: DownloadFn }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [applyResult, setApplyResult] = useState<BackfillApplyResult | null>(null);
  // READ-ONLY legacy subscription — kanban-ui never writes the legacy store.
  const analyses = useAppStore((s) => s.analyses);

  const onExport = () => {
    download(exportAllJson(), exportFilename());
    setMenuOpen(false);
  };

  const onDryRun = () => {
    setApplyResult(null);
    setReport(backfillDryRun(analyses));
    setMenuOpen(false);
  };

  const closePanel = () => {
    setReport(null);
    setApplyResult(null);
  };

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="board-tools-button"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-sm text-slate-700 dark:text-slate-200"
      >
        <span dir="auto">כלים</span>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div
            data-testid="board-tools-menu"
            className="absolute z-40 top-full mt-1 end-0 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1 flex flex-col"
          >
            <button
              type="button"
              data-testid="export-all-button"
              onClick={onExport}
              className="text-start ps-3 pe-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span dir="auto">ייצוא הכל (JSON)</span>
            </button>
            <button
              type="button"
              data-testid="backfill-dry-run-button"
              onClick={onDryRun}
              className="text-start ps-3 pe-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span dir="auto">ייבוא היסטוריה — הרצה יבשה</span>
            </button>
          </div>
        </>
      )}

      {report && (
        <div
          data-testid="backfill-panel"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-black/40" onClick={closePanel} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ייבוא היסטוריה"
            className="relative z-10 w-[24rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl ps-4 pe-4 py-3 flex flex-col gap-2.5 max-h-[80vh] overflow-y-auto"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              <span dir="auto">ייבוא ניתוחים היסטוריים — הרצה יבשה</span>
            </h3>
            <p dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
              שום דבר עוד לא נכתב. כרטיסים ייווצרו בשלב &quot;סוננו&quot; בלבד,
              עם גיבוי אוטומטי לפני ההחלה.
            </p>

            <ul className="flex flex-col gap-1" data-testid="backfill-report">
              <ReportRow label="ניתוחים בסך הכל" value={report.totalAnalyses} />
              <ReportRow label="מועמדים חדשים" value={report.wouldCreatePersons} />
              <ReportRow label="חיבור למועמד קיים" value={report.wouldAttachPersons} />
              <ReportRow label="חשד לכפילות (ייווצר + דגל)" value={report.wouldFlagMergePersons} />
              <ReportRow label="כרטיסים שייווצרו" value={report.wouldCreateDeals} />
              <ReportRow label="ידולגו" value={report.skipped.length} />
            </ul>

            {report.items.length > 0 && (
              <ul className="flex flex-col gap-0.5 border-t border-slate-200 dark:border-slate-700 pt-2">
                {report.items.slice(0, ITEMS_SHOWN).map((item) => (
                  <li
                    key={item.analysisId}
                    dir="auto"
                    className="truncate text-[11px] text-slate-500 dark:text-slate-400 text-start"
                  >
                    {item.candidateName} · {item.jobTitle}
                  </li>
                ))}
                {report.items.length > ITEMS_SHOWN && (
                  <li dir="auto" className="text-[11px] text-slate-400 dark:text-slate-500 text-start">
                    ‎+{report.items.length - ITEMS_SHOWN} נוספים
                  </li>
                )}
              </ul>
            )}

            {applyResult && (
              <p
                dir="auto"
                data-testid="backfill-apply-result"
                className="rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 px-2 py-1.5 text-xs text-start"
              >
                {applyResult.applied
                  ? `הייבוא הוחל: ${applyResult.createdDealIds.length} כרטיסים, ${applyResult.createdPersonIds.length} מועמדים חדשים.`
                  : applyResult.reason === 'flag_off'
                    ? 'הייבוא לא הוחל — דגל V3 כבוי.'
                    : 'הייבוא לא הוחל — לא אושר.'}
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              {!applyResult?.applied && (
                <button
                  type="button"
                  data-testid="backfill-apply-button"
                  disabled={report.wouldCreateDeals === 0}
                  onClick={() => setApplyResult(backfillApply(analyses, { confirm: true }))}
                  className="rounded-md bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-3 py-1.5 text-sm font-medium"
                >
                  <span dir="auto">החלת הייבוא</span>
                </button>
              )}
              <button
                type="button"
                data-testid="backfill-close-button"
                onClick={closePanel}
                className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1.5 text-sm"
              >
                <span dir="auto">סגירה</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BoardTools;
