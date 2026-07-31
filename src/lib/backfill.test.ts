// Wave-1 backfill: flag-gated, dry-run-first, Screened only (plan §2)
import { describe, it, expect, beforeEach } from 'vitest';
import type { CandidateAnalysis } from '../types';

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

const { usePipelineStore } = await import('../store/pipelineStore');
const {
  backfillDryRun,
  backfillApply,
  backfillDealId,
  BACKFILL_BACKUP_KEY,
} = await import('./backfill');
const { setV3Enabled } = await import('./persistence/keys');

function makeAnalysis(
  id: string,
  candidateId: string,
  candidateName: string,
  jobTitle = 'Backend Engineer',
): CandidateAnalysis {
  return {
    id,
    candidateId,
    jobId: `job-${jobTitle}`,
    candidateName,
    jobTitle,
    timestamp: '2026-07-30T10:00:00.000Z',
    profileSummary: '',
    matchScore: 80,
    verdict: 'Strong Fit',
    pillarScores: [],
    greenFlags: [],
    redFlags: [],
    autoRedFlags: [],
    truthTestQuestions: [],
    recruiterQuestions: [],
    recruiterNotes: { outreachAngle: '', salaryEstimate: '', additionalNotes: '' },
    recruiterComment: '',
    rawResponse: '',
  };
}

function reset() {
  localStorage.clear();
  usePipelineStore.setState({
    v3Enabled: false,
    persons: [],
    deals: [],
    stageEvents: [],
    suggestions: [],
    auditLog: [],
    undoStack: [],
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
}

beforeEach(reset);

describe('backfillDryRun', () => {
  it('plans creates/deals without mutating anything', () => {
    const analyses = [
      makeAnalysis('a1', 'c1', 'רון כהן'),
      makeAnalysis('a2', 'c2', 'דנה לוי', 'DevOps'),
    ];
    const report = backfillDryRun(analyses);
    expect(report.totalAnalyses).toBe(2);
    expect(report.wouldCreatePersons).toBe(2);
    expect(report.wouldCreateDeals).toBe(2);
    expect(report.skipped).toEqual([]);
    // zero mutation
    const st = usePipelineStore.getState();
    expect(st.persons).toHaveLength(0);
    expect(st.deals).toHaveLength(0);
    expect(localStorage.length).toBe(0);
  });

  it('groups analyses of the same legacy candidate into one person', () => {
    const analyses = [
      makeAnalysis('a1', 'c1', 'רון כהן', 'Backend'),
      makeAnalysis('a2', 'c1', 'רון כהן', 'DevOps'),
    ];
    const report = backfillDryRun(analyses);
    expect(report.wouldCreatePersons).toBe(1);
    expect(report.wouldCreateDeals).toBe(2);
    expect(report.items[1]!.personAction).toBe('attach');
  });

  it('flags cross-candidate name collisions instead of merging', () => {
    const analyses = [
      makeAnalysis('a1', 'c1', 'רון כהן'),
      makeAnalysis('a2', 'c2', 'רון כהן'),
    ];
    const report = backfillDryRun(analyses);
    expect(report.wouldCreatePersons).toBe(2);
    expect(report.wouldFlagMergePersons).toBe(1);
    expect(report.items[1]!.personAction).toBe('flag');
  });

  it('skips analyses already carded (incl. tombstoned) and malformed rows', () => {
    setV3Enabled(true);
    usePipelineStore.setState({ v3Enabled: true });
    backfillApply([makeAnalysis('a1', 'c1', 'רון כהן')], { confirm: true });
    const report = backfillDryRun([
      makeAnalysis('a1', 'c1', 'רון כהן'),
      makeAnalysis('a3', 'c3', ''),
    ]);
    expect(report.skipped).toEqual([
      { analysisId: 'a1', reason: 'already_carded' },
      { analysisId: 'a3', reason: 'missing_fields' },
    ]);
    expect(report.wouldCreateDeals).toBe(0);
  });
});

describe('backfillApply gating', () => {
  it('refuses with the flag off', () => {
    const result = backfillApply([makeAnalysis('a1', 'c1', 'רון כהן')], { confirm: true });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('flag_off');
    expect(usePipelineStore.getState().persons).toHaveLength(0);
  });

  it('refuses without explicit confirm: true', () => {
    setV3Enabled(true);
    usePipelineStore.setState({ v3Enabled: true });
    const result = backfillApply([makeAnalysis('a1', 'c1', 'רון כהן')]);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('not_confirmed');
    expect(usePipelineStore.getState().persons).toHaveLength(0);
  });
});

describe('backfillApply', () => {
  beforeEach(() => {
    setV3Enabled(true);
    usePipelineStore.setState({ v3Enabled: true });
  });

  it('creates deduped persons + deals in Screened ONLY, with an automatic backup', () => {
    const analyses = [
      makeAnalysis('a1', 'c1', 'רון כהן', 'Backend'),
      makeAnalysis('a2', 'c1', 'רון כהן', 'DevOps'),
      makeAnalysis('a3', 'c2', 'דנה לוי', 'Frontend'),
    ];
    const result = backfillApply(analyses, { confirm: true });
    expect(result.applied).toBe(true);
    expect(result.createdPersonIds).toHaveLength(2);
    expect(result.createdDealIds).toHaveLength(3);
    const st = usePipelineStore.getState();
    expect(st.persons.filter((p) => !p.deleted)).toHaveLength(2);
    expect(st.deals).toHaveLength(3);
    for (const d of st.deals) {
      expect(d.stage).toBe('Screened'); // plan §2 — Screened only
      expect(d.analysisId).toBeTruthy();
    }
    // creation events carry the skipped Sourced stage
    const creationEvents = st.stageEvents.filter((e) => e.from === null);
    expect(creationEvents).toHaveLength(3);
    for (const e of creationEvents) expect(e.skippedStages).toEqual(['Sourced']);
    // automatic backup written before mutation
    expect(localStorage.getItem(BACKFILL_BACKUP_KEY)).toBeTruthy();
  });

  it('is idempotent — a second apply skips everything', () => {
    const analyses = [makeAnalysis('a1', 'c1', 'רון כהן')];
    backfillApply(analyses, { confirm: true });
    const again = backfillApply(analyses, { confirm: true });
    expect(again.applied).toBe(true);
    expect(again.report.skipped).toEqual([{ analysisId: 'a1', reason: 'already_carded' }]);
    expect(again.createdDealIds).toHaveLength(0);
    expect(usePipelineStore.getState().deals).toHaveLength(1);
    expect(usePipelineStore.getState().persons.filter((p) => !p.deleted)).toHaveLength(1);
  });

  it('never resurrects a tombstoned backfill card', () => {
    const analyses = [makeAnalysis('a1', 'c1', 'רון כהן')];
    backfillApply(analyses, { confirm: true });
    usePipelineStore.getState().deleteDeal(backfillDealId('a1'));
    const again = backfillApply(analyses, { confirm: true });
    expect(again.createdDealIds).toHaveLength(0);
    const deal = usePipelineStore.getState().deals.find((d) => d.id === backfillDealId('a1'))!;
    expect(deal.deleted).toBe(true);
  });

  it('files a merge_person suggestion on cross-candidate name collisions', () => {
    const analyses = [
      makeAnalysis('a1', 'c1', 'רון כהן'),
      makeAnalysis('a2', 'c2', 'רון כהן'),
    ];
    backfillApply(analyses, { confirm: true });
    const st = usePipelineStore.getState();
    expect(st.persons.filter((p) => !p.deleted)).toHaveLength(2);
    const merges = st.suggestions.filter((s) => s.kind === 'merge_person');
    expect(merges).toHaveLength(1);
    expect(merges[0]!.status).toBe('pending');
  });
});
