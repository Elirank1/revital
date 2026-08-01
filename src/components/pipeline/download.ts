/**
 * Local-file download seam — Wave 3 (kanban-ui; extracted from BoardTools
 * so BoardTools and DataPanel share it without a circular import).
 *
 * Blob URL + transient `<a download>` click. Local file save only — no
 * navigation API, no network (G4-clean by construction). Injectable
 * (`DownloadFn`) so jsdom tests never touch Blob/URL.
 */

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
