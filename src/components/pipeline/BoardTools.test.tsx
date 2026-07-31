// @vitest-environment jsdom
/**
 * BoardTools DOM tests (jsdom) — kanban-ui, Wave 2.
 *
 * Export-everything (injected download fn — no Blob/URL dependency in
 * jsdom) and the backfill dry-run panel → explicit confirm apply through
 * the platform-data lib (flag-gated + backup by the lib itself).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { usePipelineStore } from '../../store/pipelineStore';
import { useAppStore } from '../../store/appStore';
import type { CandidateAnalysis } from '../../types';
import { BoardTools } from './BoardTools';
import { resetPipelineStore } from '../../views/Pipeline/storeTestKit';

function legacyAnalysis(
  id: string,
  candidateId: string,
  candidateName: string,
  jobTitle: string,
): CandidateAnalysis {
  return {
    id,
    candidateId,
    jobId: `legacy_job_${jobTitle}`,
    candidateName,
    jobTitle,
    timestamp: '2026-06-01T00:00:00.000Z',
  } as unknown as CandidateAnalysis;
}

beforeEach(() => {
  resetPipelineStore();
  useAppStore.setState({ analyses: [] });
});
afterEach(cleanup);

describe('export everything', () => {
  it('downloads one JSON blob of every revital_* key via the injected fn', () => {
    localStorage.setItem('revital_legacy_thing', JSON.stringify({ a: 1 }));
    const download = vi.fn();
    render(<BoardTools download={download} />);
    fireEvent.click(screen.getByTestId('board-tools-button'));
    fireEvent.click(screen.getByTestId('export-all-button'));

    expect(download).toHaveBeenCalledOnce();
    const [json, filename] = download.mock.calls[0];
    expect(filename).toMatch(/^revital-export-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const blob = JSON.parse(json);
    expect(blob.app).toBe('revital');
    expect(blob.keys['revital_v3_flag']).toBe('on');
    expect(blob.keys['revital_legacy_thing']).toEqual({ a: 1 });
  });
});

describe('backfill dry-run panel', () => {
  it('dry-run reports without mutating; apply creates Screened cards', () => {
    useAppStore.setState({
      analyses: [
        legacyAnalysis('a1', 'c1', 'נועה כהן', 'Backend Engineer'),
        legacyAnalysis('a2', 'c2', 'דנה לוי', 'QA Lead'),
      ],
    });
    render(<BoardTools />);
    fireEvent.click(screen.getByTestId('board-tools-button'));
    fireEvent.click(screen.getByTestId('backfill-dry-run-button'));

    const panel = screen.getByTestId('backfill-panel');
    expect(panel.textContent).toContain('נועה כהן');
    const report = screen.getByTestId('backfill-report');
    expect(report.textContent).toContain('2'); // deals to create
    // dry-run mutated NOTHING
    expect(usePipelineStore.getState().deals).toHaveLength(0);

    fireEvent.click(screen.getByTestId('backfill-apply-button'));
    expect(screen.getByTestId('backfill-apply-result').textContent).toContain(
      'הייבוא הוחל',
    );
    const deals = usePipelineStore.getState().deals;
    expect(deals).toHaveLength(2);
    expect(deals.every((d) => d.stage === 'Screened')).toBe(true);

    fireEvent.click(screen.getByTestId('backfill-close-button'));
    expect(screen.queryByTestId('backfill-panel')).toBeNull();
  });

  it('apply button is disabled when there is nothing to import', () => {
    render(<BoardTools />);
    fireEvent.click(screen.getByTestId('board-tools-button'));
    fireEvent.click(screen.getByTestId('backfill-dry-run-button'));
    expect(
      (screen.getByTestId('backfill-apply-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
