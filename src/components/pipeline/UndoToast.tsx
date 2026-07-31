/**
 * UndoToast — 6-second undo affordance after a board move — Wave 1 (kanban-ui).
 *
 * Appears after any drag; the ביטול button calls the store's `undoLast()`
 * via the callback. Auto-dismisses after `durationMs` (default 6000 per the
 * Wave-1 task list). Fixed centered via symmetric physical insets
 * (inset-x-0 + mx-auto) — direction-independent, so logical-CSS-safe.
 */

import { useEffect } from 'react';

export const UNDO_TOAST_MS = 6000;

export interface UndoToastProps {
  /** Toast text, e.g. "הכרטיס עבר לשלב הוגשו". */
  message: string;
  onUndo: () => void;
  onClose: () => void;
  durationMs?: number;
}

export function UndoToast({
  message,
  onUndo,
  onClose,
  durationMs = UNDO_TOAST_MS,
}: UndoToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [onClose, durationMs]);

  return (
    <div
      role="status"
      data-testid="undo-toast"
      className="fixed bottom-4 inset-x-0 mx-auto w-fit z-50 flex items-center gap-3 rounded-lg bg-slate-900 text-white dark:bg-slate-700 shadow-lg ps-4 pe-2 py-2"
    >
      <span dir="auto" className="text-sm">
        {message}
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-md bg-white/10 hover:bg-white/20 px-2.5 py-1 text-sm font-semibold text-brand-200"
      >
        ביטול
      </button>
      <button
        type="button"
        aria-label="סגירה"
        onClick={onClose}
        className="rounded-md hover:bg-white/10 px-1.5 py-1 text-xs text-slate-300"
      >
        ✕
      </button>
    </div>
  );
}

export default UndoToast;
