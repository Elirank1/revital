// Wave-1 Screener agent: idempotency, dedupe, audit attribution, suggestions
// (docs/waves/wave1-tasks.md §agents-engine; rails: plan §3 single-writer).
import { describe, it, expect, beforeEach } from 'vitest';
import { create } from 'zustand';
import type { CandidateAnalysis } from '../types';

// ---- in-memory localStorage (vitest runs in node env; no jsdom dep) ----
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
  runScreener,
  attachScreener,
  analysisAlreadyCarded,
  screenerPersonId,
  screenerDealId,
  screenerFlagSuggestionId,
} = await import('./screener');
const { backfillPersonId, backfillDealId } = await import('../lib/backfill');

function makeAnalysis(
  id: string,
  candidateId: string,
  candidateName: string,
  jobTitle = 'Backend Engineer',
  overrides: Partial<CandidateAnalysis> = {},
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
    ...overrides,
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

function flagOn() {
  usePipelineStore.getState().setV3Flag(true);
}

beforeEach(reset);

// A minimal legacy-store stand-in with real zustand getState/subscribe
// semantics (mirrors appStore's newest-first addAnalysis).
function makeLegacyStore(initial: CandidateAnalysis[] = []) {
  const store = create<{ analyses: CandidateAnalysis[] }>(() => ({
    analyses: initial,
  }));
  return {
    store,
    addAnalysis(a: CandidateAnalysis) {
      store.setState({ analyses: [a, ...store.getState().analyses] });
    },
  };
}

// ------------------------------------------------------------------
// Flag gate
// ------------------------------------------------------------------

describe('runScreener flag gate', () => {
  it('is a complete no-op while the v3 flag is off', () => {
    const result = runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    expect(result).toEqual({
      ran: false,
      reason: 'flag_off',
      processed: 0,
      carded: [],
      skipped: [],
    });
    const st = usePipelineStore.getState();
    expect(st.persons).toHaveLength(0);
    expect(st.deals).toHaveLength(0);
    expect(st.suggestions).toHaveLength(0);
    expect(st.auditLog).toHaveLength(0);
    expect(localStorage.getItem('revital_v3_deals')).toBeNull();
  });
});

// ------------------------------------------------------------------
// Carding (the sanctioned Act)
// ------------------------------------------------------------------

describe('runScreener carding', () => {
  it('creates Person + Deal in Screened with deterministic ids', () => {
    flagOn();
    const result = runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    expect(result.ran).toBe(true);
    expect(result.carded).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.carded[0]).toMatchObject({
      analysisId: 'a1',
      personId: screenerPersonId('c1'),
      dealId: screenerDealId('a1'),
      personAction: 'create',
    });

    const st = usePipelineStore.getState();
    const person = st.persons.find((p) => p.id === 'p_scr_c1')!;
    expect(person.name).toBe('רון כהן');
    expect(person.analysisIds).toEqual(['a1']);

    const deal = st.deals.find((d) => d.id === 'd_scr_a1')!;
    expect(deal.stage).toBe('Screened');
    expect(deal.personId).toBe('p_scr_c1');
    expect(deal.analysisId).toBe('a1');
    expect(deal.jobTitle).toBe('Backend Engineer');
    expect(deal.stageEnteredAt).toBeTruthy();
  });

  it('logs a creation StageEvent at Screened with Sourced skipped, actor agent', () => {
    flagOn();
    runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    const ev = usePipelineStore
      .getState()
      .stageEvents.find((e) => e.dealId === 'd_scr_a1')!;
    expect(ev.from).toBeNull();
    expect(ev.to).toBe('Screened');
    expect(ev.actor).toBe('agent');
    expect(ev.skippedStages).toEqual(['Sourced']);
  });

  it('skips analyses with missing fields without touching the store', () => {
    flagOn();
    const broken = makeAnalysis('a1', 'c1', '');
    const noJob = makeAnalysis('a2', 'c2', 'דנה לוי', '', { jobId: '' });
    const result = runScreener([broken, noJob]);
    expect(result.carded).toEqual([]);
    expect(result.skipped).toEqual([
      { analysisId: 'a1', reason: 'missing_fields' },
      { analysisId: 'a2', reason: 'missing_fields' },
    ]);
    expect(usePipelineStore.getState().deals).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Audit attribution
// ------------------------------------------------------------------

describe('runScreener audit', () => {
  it("attributes every action to actor 'ai', agent 'screener'", () => {
    flagOn();
    runScreener([
      makeAnalysis('a1', 'c1', 'רון כהן', 'Backend Engineer', {
        redFlags: ['פערי העסקה לא מוסברים'],
      }),
    ]);
    const audit = usePipelineStore.getState().auditLog;
    const personCreate = audit.find((e) => e.action === 'person.create')!;
    const dealCreate = audit.find((e) => e.action === 'deal.create')!;
    const suggestionCreate = audit.find((e) => e.action === 'suggestion.create')!;
    for (const entry of [personCreate, dealCreate, suggestionCreate]) {
      expect(entry.actor).toBe('ai');
      expect(entry.agent).toBe('screener');
    }
    expect(personCreate.entityId).toBe('p_scr_c1');
    expect(dealCreate.entityId).toBe('d_scr_a1');
  });
});

// ------------------------------------------------------------------
// Idempotency & dedupe against backfill
// ------------------------------------------------------------------

describe('runScreener idempotency', () => {
  it('run twice → no duplicate persons, deals, suggestions, or merge flags', () => {
    flagOn();
    const analyses = [
      makeAnalysis('a1', 'c1', 'רון כהן', 'Backend Engineer', {
        redFlags: ['דגל'],
      }),
      makeAnalysis('a2', 'c2', 'דנה לוי', 'DevOps'),
    ];
    const first = runScreener(analyses);
    expect(first.carded).toHaveLength(2);

    const snapshot = usePipelineStore.getState();
    const second = runScreener(analyses);
    expect(second.carded).toEqual([]);
    expect(second.skipped).toEqual([
      { analysisId: 'a1', reason: 'already_carded' },
      { analysisId: 'a2', reason: 'already_carded' },
    ]);

    const st = usePipelineStore.getState();
    expect(st.persons).toHaveLength(2);
    expect(st.deals).toHaveLength(2);
    expect(st.suggestions).toHaveLength(1); // the one flag suggestion, once
    // untouched records keep their object identity — nothing was rewritten
    expect(st.deals[0]).toBe(snapshot.deals[0]);
    expect(st.persons[0]).toBe(snapshot.persons[0]);
  });

  it('a duplicated analysis inside one batch cards once', () => {
    flagOn();
    const a = makeAnalysis('a1', 'c1', 'רון כהן');
    const result = runScreener([a, a]);
    expect(result.carded).toHaveLength(1);
    expect(result.skipped).toEqual([{ analysisId: 'a1', reason: 'already_carded' }]);
    expect(usePipelineStore.getState().deals).toHaveLength(1);
  });

  it('skips analyses already carded by backfill (deterministic id + analysisId link)', () => {
    flagOn();
    const store = usePipelineStore.getState();
    // Simulate a backfill-created card: p_bf_/d_bf_ ids, analysisId link.
    const { person } = store.addPerson({
      id: backfillPersonId('c1'),
      name: 'רון כהן',
    });
    store.addDeal({
      id: backfillDealId('a1'),
      personId: person.id,
      jobId: 'job-Backend Engineer',
      jobTitle: 'Backend Engineer',
      stage: 'Screened',
      analysisId: 'a1',
    });

    const result = runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    expect(result.carded).toEqual([]);
    expect(result.skipped).toEqual([{ analysisId: 'a1', reason: 'already_carded' }]);
    expect(usePipelineStore.getState().deals).toHaveLength(1);
    expect(usePipelineStore.getState().persons).toHaveLength(1);
  });

  it('a screener card blocks a later backfill of the same analysis (analysisId link)', async () => {
    flagOn();
    runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    const { backfillDryRun } = await import('../lib/backfill');
    const report = backfillDryRun([makeAnalysis('a1', 'c1', 'רון כהן')]);
    expect(report.skipped).toEqual([{ analysisId: 'a1', reason: 'already_carded' }]);
    expect(report.wouldCreateDeals).toBe(0);
  });

  it('treats tombstoned cards as carded — never resurrects', () => {
    flagOn();
    runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    usePipelineStore.getState().deleteDeal('d_scr_a1');
    const result = runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    expect(result.skipped).toEqual([{ analysisId: 'a1', reason: 'already_carded' }]);
    const deal = usePipelineStore.getState().deals.find((d) => d.id === 'd_scr_a1')!;
    expect(deal.deleted).toBe(true);
  });

  it('analysisAlreadyCarded matches by link, screener id, and backfill id', () => {
    const base = {
      v: 0,
      updatedAt: '',
      personId: 'p',
      jobId: 'j',
      jobTitle: 't',
      stage: 'Screened' as const,
      stageEnteredAt: '',
      createdAt: '',
    };
    expect(
      analysisAlreadyCarded([{ ...base, id: 'x', analysisId: 'a1' }], 'a1'),
    ).toBe(true);
    expect(analysisAlreadyCarded([{ ...base, id: screenerDealId('a1') }], 'a1')).toBe(
      true,
    );
    expect(analysisAlreadyCarded([{ ...base, id: backfillDealId('a1') }], 'a1')).toBe(
      true,
    );
    expect(analysisAlreadyCarded([{ ...base, id: 'y', analysisId: 'a2' }], 'a1')).toBe(
      false,
    );
  });
});

// ------------------------------------------------------------------
// Person dedupe paths
// ------------------------------------------------------------------

describe('runScreener person dedupe', () => {
  it('same candidate across runs reuses the same Person (no dupes, no merge flag)', () => {
    flagOn();
    runScreener([makeAnalysis('a1', 'c1', 'רון כהן', 'Backend Engineer')]);
    const result = runScreener([makeAnalysis('a2', 'c1', 'רון כהן', 'DevOps')]);
    expect(result.carded[0]!.personAction).toBe('attach');
    expect(result.carded[0]!.personId).toBe('p_scr_c1');

    const st = usePipelineStore.getState();
    expect(st.persons).toHaveLength(1);
    expect(st.deals).toHaveLength(2);
    expect(st.deals.every((d) => d.personId === 'p_scr_c1')).toBe(true);
    expect(st.suggestions.filter((x) => x.kind === 'merge_person')).toHaveLength(0);
  });

  it('reuses a backfill-created person for the same candidateId', () => {
    flagOn();
    usePipelineStore.getState().addPerson({
      id: backfillPersonId('c1'),
      name: 'רון כהן',
    });
    const result = runScreener([makeAnalysis('a9', 'c1', 'רון כהן', 'DevOps')]);
    expect(result.carded[0]!.personAction).toBe('attach');
    expect(result.carded[0]!.personId).toBe('p_bf_c1');
    expect(usePipelineStore.getState().persons).toHaveLength(1);
  });

  it('name-only collision with a DIFFERENT person creates + files a merge_person suggestion', () => {
    flagOn();
    // A distinct human who happens to share the name (has her own phone).
    usePipelineStore.getState().addPerson({ name: 'דנה לוי', phone: '052-1111111' });
    const result = runScreener([makeAnalysis('a1', 'c9', 'דנה לוי')]);

    expect(result.carded[0]!.personAction).toBe('flag');
    expect(result.carded[0]!.personId).toBe('p_scr_c9');
    const st = usePipelineStore.getState();
    expect(st.persons).toHaveLength(2); // never auto-merged (D-014)
    const merge = st.suggestions.find((x) => x.kind === 'merge_person')!;
    expect(merge.status).toBe('pending');
    expect(merge.agent).toBe('screener');
  });

  it('never reuses a taken person id when the name differs (falls back to store id)', () => {
    flagOn();
    // p_scr_c1 exists but belongs to a differently-named person (edge:
    // candidate renamed between analyses is NOT assumed to be safe).
    usePipelineStore.getState().addPerson({ id: 'p_scr_c1', name: 'שם ישן' });
    usePipelineStore.getState().deletePerson('p_scr_c1');
    const result = runScreener([makeAnalysis('a1', 'c1', 'שם חדש')]);
    // tombstoned id is never resurrected and never duplicated
    expect(result.carded[0]!.personId).not.toBe('p_scr_c1');
    const ids = usePipelineStore.getState().persons.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ------------------------------------------------------------------
// Flag explanations → Suggestions (Propose)
// ------------------------------------------------------------------

describe('runScreener flag suggestions', () => {
  it('emits ONE flag suggestion with evidence citing the analysis', () => {
    flagOn();
    runScreener([
      makeAnalysis('a1', 'c1', 'רון כהן', 'Backend Engineer', {
        matchScore: 55,
        verdict: 'Potential',
        redFlags: ['שלוש החלפות עבודה בשנתיים'],
        autoRedFlags: [
          {
            type: 'employment_gap',
            description: 'פער העסקה של 14 חודשים',
            severity: 'critical',
          },
        ],
      }),
    ]);
    const st = usePipelineStore.getState();
    expect(st.suggestions).toHaveLength(1);
    const sug = st.suggestions[0]!;
    expect(sug.id).toBe(screenerFlagSuggestionId('a1'));
    expect(sug.agent).toBe('screener');
    expect(sug.kind).toBe('flag');
    expect(sug.status).toBe('pending');
    expect(sug.dealId).toBe('d_scr_a1');
    expect(sug.personId).toBe('p_scr_c1');
    expect(sug.body).toContain('שלוש החלפות עבודה בשנתיים');
    expect(sug.body).toContain('פער העסקה של 14 חודשים');
    expect(sug.body).toContain('(חמור)');
    expect(sug.evidence.length).toBeGreaterThanOrEqual(3); // score + 2 flags
    expect(sug.evidence.every((e) => e.sourceId === 'a1')).toBe(true);
    expect(sug.evidence.every((e) => e.sourceType === 'analysis')).toBe(true);
  });

  it('emits no suggestion for a clean analysis', () => {
    flagOn();
    runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);
    expect(usePipelineStore.getState().suggestions).toHaveLength(0);
  });

  it('flags a Reject verdict even without explicit red flags', () => {
    flagOn();
    runScreener([
      makeAnalysis('a1', 'c1', 'רון כהן', 'Backend Engineer', {
        verdict: 'Reject',
        matchScore: 20,
      }),
    ]);
    const sug = usePipelineStore.getState().suggestions[0]!;
    expect(sug.kind).toBe('flag');
    expect(sug.body).toContain('Reject');
  });

  it('strips BiDi direction-control characters from suggestion text', () => {
    flagOn();
    runScreener([
      makeAnalysis('a1', 'c1', 'רון‮כהן', 'Backend⁦Engineer', {
        redFlags: ['דגל‪עם הזרקה'],
      }),
    ]);
    const sug = usePipelineStore.getState().suggestions[0]!;
    for (const ch of ['‮', '‪', '⁦']) {
      expect(sug.title).not.toContain(ch);
      expect(sug.body).not.toContain(ch);
      for (const e of sug.evidence) expect(e.claim).not.toContain(ch);
    }
  });
});

// ------------------------------------------------------------------
// Single-writer rail: never moves/edits existing cards
// ------------------------------------------------------------------

describe('runScreener single-writer rail', () => {
  it('never touches existing cards — creation only', () => {
    flagOn();
    const store = usePipelineStore.getState();
    const { person } = store.addPerson({ name: 'איש קיים', phone: '052-2222222' });
    const existing = store.addDeal({
      personId: person.id,
      jobId: 'job-x',
      jobTitle: 'QA',
      stage: 'Outreach',
      analysisId: 'a-old',
    });
    const before = usePipelineStore.getState().deals.find((d) => d.id === existing.id)!;

    runScreener([makeAnalysis('a1', 'c1', 'רון כהן')]);

    const after = usePipelineStore.getState().deals.find((d) => d.id === existing.id)!;
    expect(after).toBe(before); // untouched object identity
    expect(after.stage).toBe('Outreach');
  });
});

// ------------------------------------------------------------------
// attachScreener — event-driven wiring
// ------------------------------------------------------------------

describe('attachScreener', () => {
  it('does not card pre-existing analyses by default (backfill territory), cards new ones', () => {
    flagOn();
    const legacy = makeLegacyStore([makeAnalysis('a0', 'c0', 'ותיק ותיק')]);
    const detach = attachScreener(legacy.store);

    expect(usePipelineStore.getState().deals).toHaveLength(0);

    legacy.addAnalysis(makeAnalysis('a1', 'c1', 'רון כהן'));
    const st = usePipelineStore.getState();
    expect(st.deals.map((d) => d.id)).toEqual(['d_scr_a1']);
    expect(st.deals[0]!.stage).toBe('Screened');
    detach();
  });

  it('processExisting: true cards the backlog at attach', () => {
    flagOn();
    const legacy = makeLegacyStore([makeAnalysis('a0', 'c0', 'ותיק ותיק')]);
    const detach = attachScreener(legacy.store, usePipelineStore, {
      processExisting: true,
    });
    expect(usePipelineStore.getState().deals.map((d) => d.id)).toEqual(['d_scr_a0']);
    detach();
  });

  it('detach stops carding', () => {
    flagOn();
    const legacy = makeLegacyStore();
    const detach = attachScreener(legacy.store);
    detach();
    legacy.addAnalysis(makeAnalysis('a1', 'c1', 'רון כהן'));
    expect(usePipelineStore.getState().deals).toHaveLength(0);
  });

  it('retries flag-gated analyses on the next event once the flag is on', () => {
    const legacy = makeLegacyStore();
    const detach = attachScreener(legacy.store);

    legacy.addAnalysis(makeAnalysis('a1', 'c1', 'רון כהן')); // flag off — gated
    expect(usePipelineStore.getState().deals).toHaveLength(0);

    flagOn();
    legacy.addAnalysis(makeAnalysis('a2', 'c2', 'דנה לוי')); // drains backlog too
    const ids = usePipelineStore
      .getState()
      .deals.map((d) => d.id)
      .sort();
    expect(ids).toEqual(['d_scr_a1', 'd_scr_a2']);
    detach();
  });

  it('re-processing is safe: analysis edits do not double-card', () => {
    flagOn();
    const legacy = makeLegacyStore();
    const detach = attachScreener(legacy.store);
    legacy.addAnalysis(makeAnalysis('a1', 'c1', 'רון כהן'));
    // legacy updateAnalysis replaces the array with same ids
    legacy.store.setState({
      analyses: legacy.store
        .getState()
        .analyses.map((a) => ({ ...a, recruiterComment: 'עודכן' })),
    });
    expect(usePipelineStore.getState().deals).toHaveLength(1);
    detach();
  });

  it('NEVER mutates the legacy app store (read-only rail)', () => {
    flagOn();
    const legacy = makeLegacyStore([makeAnalysis('a0', 'c0', 'ותיק ותיק')]);
    const stateBefore = legacy.store.getState();
    const analysesBefore = stateBefore.analyses;

    const detach = attachScreener(legacy.store, usePipelineStore, {
      processExisting: true,
    });
    expect(legacy.store.getState()).toBe(stateBefore);
    expect(legacy.store.getState().analyses).toBe(analysesBefore);
    expect(analysesBefore[0]).toEqual(makeAnalysis('a0', 'c0', 'ותיק ותיק'));
    detach();
  });
});
