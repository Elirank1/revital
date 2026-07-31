// Wave 2 (lead-granted) — CSV stage column: legacy columns byte-identical,
// Stage appended LAST. Node env with MemStorage.
import { describe, it, expect, beforeEach } from 'vitest';
import type { AnalysisLog } from '../types';
import type { Deal } from '../types/pipeline';

class MemStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}
(globalThis as { localStorage?: Storage }).localStorage = new MemStorage();

const { logToCSV, dealStageForAnalysis } = await import('./export');
const { setV3Enabled, V3_KEYS, saveV3 } = await import(
  '../lib/persistence/keys'
);
const { usePipelineStore } = await import('../store/pipelineStore');

const LOG: AnalysisLog[] = [
  {
    id: 'an-1',
    jobId: 'J1',
    jobTitle: 'Backend Dev',
    candidateName: 'Dana Levi',
    matchScore: 82,
    verdict: 'Strong',
    timestamp: '2026-07-01T10:00:00.000Z',
    summary: 'Dana Levi → Backend Dev: 82% (Strong)',
  },
  {
    id: 'an-2',
    jobId: 'J1',
    jobTitle: 'Backend Dev',
    candidateName: 'Ron Cohen',
    matchScore: 61,
    verdict: 'Potential',
    timestamp: '2026-07-02T10:00:00.000Z',
    summary: 'Ron Cohen → Backend Dev: 61% (Potential)',
  },
];

/** EXACT Wave-1 legacy row template — pinned so any drift fails loudly. */
function legacyRow(e: AnalysisLog): string {
  return `"${new Date(e.timestamp).toLocaleDateString()}","${e.candidateName}","${e.jobTitle}",${e.matchScore},"${e.verdict}","${e.summary}"`;
}
const LEGACY_HEADER = 'Date,Candidate,Job Title,Score,Verdict,Summary';

function makeDeal(id: string, analysisId: string, over: Partial<Deal> = {}): Deal {
  return {
    id,
    v: 0,
    updatedAt: '2026-07-03T10:00:00.000Z',
    personId: 'p1',
    jobId: 'J1',
    jobTitle: 'Backend Dev',
    stage: 'Submitted',
    stageEnteredAt: '2026-07-03T10:00:00.000Z',
    createdAt: '2026-07-03T10:00:00.000Z',
    analysisId,
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  usePipelineStore.setState({
    persons: [],
    deals: [],
    stageEvents: [],
    suggestions: [],
    auditLog: [],
    undoStack: [],
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
});

describe('logToCSV — stage column', () => {
  it('legacy columns stay byte-identical; Stage is appended last', () => {
    const csv = logToCSV(LOG, [makeDeal('d1', 'an-1')]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(`${LEGACY_HEADER},Stage`);
    // Every row = the EXACT legacy row + one appended cell.
    expect(lines[1]).toBe(`${legacyRow(LOG[0])},"Submitted"`);
    expect(lines[2]).toBe(`${legacyRow(LOG[1])},""`);
    expect(lines[1].startsWith(legacyRow(LOG[0]))).toBe(true);
  });

  it('flag off with no injected deals → stage cells are empty, never guessed', () => {
    // A v3 deal EXISTS in the store, but the flag is off → not consulted.
    usePipelineStore.setState({ deals: [makeDeal('d1', 'an-1')] });
    const csv = logToCSV(LOG);
    const lines = csv.split('\n');
    expect(lines[1]).toBe(`${legacyRow(LOG[0])},""`);
    expect(lines[2]).toBe(`${legacyRow(LOG[1])},""`);
  });

  it('flag on with no injected deals → reads the pipeline store', () => {
    setV3Enabled(true);
    usePipelineStore.setState({ deals: [makeDeal('d1', 'an-2', { stage: 'Offer' })] });
    const csv = logToCSV(LOG);
    const lines = csv.split('\n');
    expect(lines[1]).toBe(`${legacyRow(LOG[0])},""`);
    expect(lines[2]).toBe(`${legacyRow(LOG[1])},"Offer"`);
  });
});

describe('dealStageForAnalysis', () => {
  it('ignores tombstoned deals; latest-updated live deal wins', () => {
    const deals = [
      makeDeal('d1', 'an-1', { stage: 'Placed', deleted: true }),
      makeDeal('d2', 'an-1', {
        stage: 'Outreach',
        updatedAt: '2026-07-02T00:00:00.000Z',
      }),
      makeDeal('d3', 'an-1', {
        stage: 'ClientInterview',
        updatedAt: '2026-07-05T00:00:00.000Z',
      }),
    ];
    expect(dealStageForAnalysis('an-1', deals)).toBe('ClientInterview');
    expect(dealStageForAnalysis('an-404', deals)).toBe('');
  });

  it('reads only revital_v3 state — persisted v3 deals surface after flag-on', () => {
    saveV3(V3_KEYS.deals, [makeDeal('d1', 'an-1', { stage: 'Paid' })]);
    setV3Enabled(true);
    usePipelineStore.setState({
      deals: [makeDeal('d1', 'an-1', { stage: 'Paid' })],
    });
    expect(dealStageForAnalysis('an-1')).toBe('Paid');
  });
});
