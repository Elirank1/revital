/**
 * DataPanel — retention + per-person deletion — Wave 3 (kanban-ui).
 *
 * Lives behind the board tools menu. Surfaces the platform-data Wave-3
 * contract:
 *
 * 1. RETENTION — `retentionMonths` (null = off, the default) set via
 *    `setRetentionMonths`, plus an explicit purge button running
 *    `purgeExpired()` and reporting EXACTLY what was physically removed
 *    (tombstones past the window + their PII-carrying audit snapshots).
 *    Retention never touches live data — the copy says so.
 *
 * 2. PER-PERSON DELETION — the full cascade, gated three ways:
 *    (a) export FIRST: the delete flow is disabled until she downloads
 *        the full backup (exportAllJson via the injectable download fn —
 *        local file only, no navigation API, G4-clean);
 *    (b) typed confirmation: the person's exact name;
 *    (c) the store's own `{ confirm: true }` gate.
 *    The result panel shows the CascadeResult counts and offers one-click
 *    undo (`undoLast` — the cascade pushed full snapshots).
 *
 * BiDi: user content dir="auto"; logical CSS only.
 */

import { useMemo, useState } from 'react';
import { usePipelineStore, type CascadeResult, type PurgeResult } from '../../store/pipelineStore';
import { exportAllJson, exportFilename } from '../../lib/persistence/exportAll';
import { blobDownload, type DownloadFn } from './download';

/** Retention choices — '' is OFF (the default; storing forever is a choice). */
const RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'ללא מחיקה אוטומטית (ברירת המחדל)' },
  { value: '3', label: '3 חודשים' },
  { value: '6', label: '6 חודשים' },
  { value: '12', label: '12 חודשים' },
  { value: '24', label: '24 חודשים' },
];

export interface DataPanelProps {
  onClose: () => void;
  download?: DownloadFn;
}

export function DataPanel({ onClose, download = blobDownload }: DataPanelProps) {
  const persons = usePipelineStore((s) => s.persons);
  const retentionMonths = usePipelineStore((s) => s.retentionMonths);
  const setRetentionMonths = usePipelineStore((s) => s.setRetentionMonths);
  const purgeExpired = usePipelineStore((s) => s.purgeExpired);
  const deletePersonCascade = usePipelineStore((s) => s.deletePersonCascade);
  const undoLast = usePipelineStore((s) => s.undoLast);

  const livePersons = useMemo(
    () =>
      persons
        .filter((p) => !p.deleted)
        .sort((a, b) => a.name.localeCompare(b.name, 'he')),
    [persons],
  );

  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [exported, setExported] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [cascade, setCascade] = useState<CascadeResult | null>(null);
  const [undone, setUndone] = useState(false);

  const selectedPerson = livePersons.find((p) => p.id === selectedId);
  const confirmMatches =
    selectedPerson !== undefined && confirmText.trim() === selectedPerson.name;

  const onSelectPerson = (id: string) => {
    setSelectedId(id);
    setExported(false);
    setConfirmText('');
    setCascade(null);
    setUndone(false);
  };

  const onExport = () => {
    download(exportAllJson(), exportFilename());
    setExported(true);
  };

  const onDelete = () => {
    if (!selectedPerson || !exported || !confirmMatches) return;
    const result = deletePersonCascade(selectedPerson.id, { confirm: true });
    if (result) {
      setCascade(result);
      setConfirmText('');
    }
  };

  const onUndo = () => {
    if (undoLast()) {
      setUndone(true);
      setCascade(null);
    }
  };

  return (
    <div
      data-testid="data-panel"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ניהול נתונים"
        className="relative z-10 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl ps-4 pe-4 py-3 flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
      >
        <header className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 text-base font-bold text-slate-900 dark:text-white">
            <span dir="auto">ניהול נתונים</span>
          </h3>
          <button
            type="button"
            data-testid="data-panel-close"
            onClick={onClose}
            className="shrink-0 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 py-0.5 text-xs"
          >
            <span dir="auto">סגירה</span>
          </button>
        </header>

        {/* Retention */}
        <section className="flex flex-col gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 ps-3 pe-3 py-2.5">
          <h4 dir="auto" className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-start">
            חלון שמירת נתונים
          </h4>
          <p dir="auto" className="text-[11px] text-slate-500 dark:text-slate-400 text-start">
            מחיקה סופית חלה רק על רשומות שכבר נמחקו (מחיקה רכה) לפני יותר
            מהחלון שנבחר — נתונים חיים לעולם אינם נמחקים אוטומטית.
          </p>
          <select
            data-testid="retention-select"
            aria-label="חלון שמירת נתונים"
            value={retentionMonths === null ? '' : String(retentionMonths)}
            onChange={(e) =>
              setRetentionMonths(e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2 py-1.5 text-xs"
          >
            {RETENTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="purge-button"
              disabled={retentionMonths === null}
              onClick={() => setPurgeResult(purgeExpired())}
              className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1 text-xs font-medium"
            >
              <span dir="auto">מחיקה סופית של פגי-תוקף עכשיו</span>
            </button>
          </div>
          {purgeResult && (
            <p
              dir="auto"
              data-testid="purge-result"
              className="rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-1 text-[11px] text-start"
            >
              {purgeResult.cutoff === null
                ? 'לא בוצעה מחיקה — חלון השמירה כבוי.'
                : `נמחקו סופית: ${purgeResult.persons} מועמדים · ${purgeResult.deals} כרטיסים · ${purgeResult.suggestions} הצעות · ${purgeResult.stageEvents} אירועי שלב · ${purgeResult.auditEntries} רשומות יומן`}
            </p>
          )}
        </section>

        {/* Per-person deletion cascade */}
        <section className="flex flex-col gap-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 ps-3 pe-3 py-2.5">
          <h4 dir="auto" className="text-sm font-semibold text-rose-800 dark:text-rose-300 text-start">
            מחיקת מועמד/ת מכל המערכת
          </h4>
          <p dir="auto" className="text-[11px] text-slate-600 dark:text-slate-400 text-start">
            מוחק את המועמד/ת, הכרטיסים, ההצעות, אירועי השלב ורישום הספסל —
            עם אפשרות ביטול מיידית. לפני מחיקה יש להוריד גיבוי מלא.
          </p>
          <select
            data-testid="cascade-person-select"
            aria-label="בחירת מועמד/ת למחיקה"
            value={selectedId}
            onChange={(e) => onSelectPerson(e.target.value)}
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2 py-1.5 text-xs"
          >
            <option value="">בחרי מועמד/ת…</option>
            {livePersons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {selectedPerson && !cascade && (
            <>
              {/* Step 1 — export first */}
              <button
                type="button"
                data-testid="cascade-export-button"
                onClick={onExport}
                className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 px-2.5 py-1 text-xs font-medium"
              >
                <span dir="auto">
                  {exported ? 'הגיבוי הורד ✓ (אפשר להוריד שוב)' : 'שלב 1: הורדת גיבוי מלא (JSON)'}
                </span>
              </button>

              {/* Step 2 — typed confirmation, enabled only after export */}
              <label dir="auto" className="text-[11px] text-slate-600 dark:text-slate-400 text-start">
                שלב 2: הקלידי את השם המלא לאישור — <bdi>{selectedPerson.name}</bdi>
              </label>
              <input
                dir="auto"
                type="text"
                data-testid="cascade-confirm-input"
                aria-label="אישור מחיקה בהקלדת השם"
                disabled={!exported}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={exported ? selectedPerson.name : 'קודם יש להוריד גיבוי'}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white disabled:opacity-50 px-2 py-1.5 text-xs text-start"
              />
              <button
                type="button"
                data-testid="cascade-delete-button"
                disabled={!exported || !confirmMatches}
                onClick={onDelete}
                className="rounded-md bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white px-2.5 py-1 text-xs font-medium"
              >
                <span dir="auto">מחיקה סופית של {selectedPerson.name}</span>
              </button>
            </>
          )}

          {cascade && (
            <div
              data-testid="cascade-result"
              className="flex flex-col gap-1 rounded-md bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 px-2 py-1.5"
            >
              <p dir="auto" className="text-[11px] text-slate-700 dark:text-slate-200 text-start">
                נמחקו: המועמד/ת · {cascade.dealIds.length} כרטיסים ·{' '}
                {cascade.suggestionIds.length} הצעות · {cascade.stageEventIds.length}{' '}
                אירועי שלב{cascade.benchPurged ? ' · רישום הספסל' : ''}
              </p>
              <button
                type="button"
                data-testid="cascade-undo-button"
                onClick={onUndo}
                className="self-start rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 px-2.5 py-1 text-xs font-medium"
              >
                <span dir="auto">ביטול המחיקה</span>
              </button>
            </div>
          )}

          {undone && (
            <p
              dir="auto"
              data-testid="cascade-undone"
              className="rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 px-2 py-1 text-[11px] text-start"
            >
              המחיקה בוטלה — הכל שוחזר.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export default DataPanel;
