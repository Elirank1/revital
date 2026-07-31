// @vitest-environment jsdom
/**
 * Flag ON/OFF regression seams (quality-gate, Wave 1).
 *
 * The rollback story is "flag off, nothing else" — so flag-off must be
 * PROVABLY inert across every Wave-1 entry point at once, not just per
 * module:
 *
 *   - flag OFF: the full legacy App renders (dashboard, nav without לוח,
 *     pipeline view null), legacy actions write ONLY legacy revital_*
 *     keys, and every v3 entry point (screener, backfill even WITH
 *     confirm, pullV3/pushV3, attachScreener) is a no-op that writes
 *     ZERO revital_v3_* keys and never touches the network.
 *   - flag ON: v3 flows write ONLY revital_v3_* keys — legacy keys stay
 *     byte-identical; legacy store state is never mutated by v3 flows.
 *   - attachScreener retry seam: an analysis arriving while the flag is
 *     off is not lost — it cards on the first event after flag-on.
 *
 * Synthetic fixtures only. fetch is spied per test and asserted idle
 * wherever the flag gate must prevent network (G2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CandidateAnalysis, JobDescription } from '../../types';
import App from '../../App';
import { useAppStore } from '../../store/appStore';
import { usePipelineStore } from '../../store/pipelineStore';
import { runScreener, attachScreener } from '../../agents/screener';
import { backfillApply, BACKFILL_BACKUP_KEY } from '../../lib/backfill';
import { pullV3, pushV3, syncV3OnLoad } from '../../lib/persistence/sync';
import { resetPipelineStore, seedPersonWithDeal } from './storeTestKit';

function makeAnalysis(
  id: string,
  candidateId: string,
  candidateName: string,
): CandidateAnalysis {
  return {
    id,
    candidateId,
    jobId: `job-${id}`,
    candidateName,
    jobTitle: 'Backend Engineer',
    timestamp: '2026-07-30T10:00:00.000Z',
    profileSummary: '',
    matchScore: 75,
    verdict: 'Potential',
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

function makeJob(id: string): JobDescription {
  return {
    id,
    title: 'Backend Engineer',
    rawText: 'synthetic job text',
    pillars: [],
    createdAt: '2026-07-30T10:00:00.000Z',
  };
}

const v3Keys = () =>
  Object.keys(localStorage).filter((k) => k.startsWith('revital_v3_'));

/** Snapshot of every localStorage key → value. */
const storageSnapshot = () => {
  const snap: Record<string, string> = {};
  for (const k of Object.keys(localStorage)) snap[k] = localStorage.getItem(k)!;
  return snap;
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((() =>
    Promise.reject(new Error('network disabled in tests (G2)'))) as never);
});

afterEach(() => {
  fetchSpy.mockRestore();
  cleanup();
});

// ------------------------------------------------------------------
// Flag OFF
// ------------------------------------------------------------------

describe('flag OFF — legacy untouched, v3 fully inert', () => {
  beforeEach(() => {
    resetPipelineStore({ enabled: false });
    useAppStore.setState({ analyses: [], currentView: 'dashboard' });
  });

  it('the legacy App renders its dashboard and the nav has no board button', () => {
    render(<App />);
    // Legacy hero + header brand are intact…
    expect(screen.getAllByText('CV Analyzer').length).toBeGreaterThan(0);
    // …and the flag-gated לוח nav entry is absent.
    expect(screen.queryByText('לוח')).toBeNull();
    // Rendering the app wrote no v3 keys.
    expect(v3Keys()).toEqual([]);
  });

  it('the pipeline view renders literally nothing', () => {
    useAppStore.setState({ currentView: 'pipeline' });
    render(<App />);
    expect(document.querySelector('[data-testid="column-Sourced"]')).toBeNull();
    expect(document.querySelector('[data-testid="deal-card"]')).toBeNull();
    expect(v3Keys()).toEqual([]);
  });

  it('legacy actions write only legacy revital_* keys, never revital_v3_*', () => {
    const app = useAppStore.getState();
    app.saveJob(makeJob('j1'));
    app.addAnalysis(makeAnalysis('a1', 'c1', 'נועה כהן'));

    const keys = Object.keys(localStorage);
    expect(keys).toContain('revital_savedJobs');
    expect(keys).toContain('revital_analyses');
    expect(v3Keys()).toEqual([]);
    // apiKey is unset in tests, so legacy sync must not have fired either.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('every v3 entry point is a no-op: screener, backfill (even confirmed), sync', async () => {
    const analyses = [makeAnalysis('a1', 'c1', 'נועה כהן')];

    const scr = runScreener(analyses);
    expect(scr).toMatchObject({ ran: false, reason: 'flag_off', carded: [] });

    const bf = backfillApply(analyses, { confirm: true });
    expect(bf.applied).toBe(false);
    expect(bf.reason).toBe('flag_off');
    expect(localStorage.getItem(BACKFILL_BACKUP_KEY)).toBeNull();

    const pull = await pullV3('code');
    const push = await pushV3('code');
    const onLoad = await syncV3OnLoad('code');
    expect(pull).toEqual({ ok: false, skipped: 'flag_off' });
    expect(push).toEqual({ ok: false, skipped: 'flag_off' });
    expect(onLoad.pull.skipped).toBe('flag_off');
    expect(onLoad.push.skipped).toBe('flag_off');
    expect(fetchSpy).not.toHaveBeenCalled();

    // Store never touched, storage never touched.
    const s = usePipelineStore.getState();
    expect(s.persons).toEqual([]);
    expect(s.deals).toEqual([]);
    expect(s.suggestions).toEqual([]);
    expect(s.auditLog).toEqual([]);
    expect(v3Keys()).toEqual([]);
  });

  it('attachScreener holds analyses arriving flag-off and cards them after flag-on', () => {
    const detach = attachScreener(useAppStore);
    const a = makeAnalysis('late1', 'c-late', 'דנה לוי');

    // Arrives while the flag is off → nothing happens, nothing written.
    useAppStore.setState({ analyses: [a] });
    expect(usePipelineStore.getState().deals).toEqual([]);
    expect(v3Keys()).toEqual([]);

    // Flag flips on; the NEXT legacy event drains the pending queue.
    usePipelineStore.getState().setV3Flag(true);
    useAppStore.setState({ analyses: [...useAppStore.getState().analyses] });

    const deals = usePipelineStore.getState().deals;
    expect(deals).toHaveLength(1);
    expect(deals[0].stage).toBe('Screened');
    expect(deals[0].analysisId).toBe('late1');
    detach();
  });
});

// ------------------------------------------------------------------
// Flag ON
// ------------------------------------------------------------------

describe('flag ON — v3 writes stay inside the revital_v3_* namespace', () => {
  beforeEach(() => {
    resetPipelineStore({ enabled: true });
    useAppStore.setState({ analyses: [] });
  });

  it('a full v3 flow changes only revital_v3_* keys; legacy keys stay byte-identical', () => {
    // Plant legacy state FIRST and snapshot it.
    useAppStore.getState().saveJob(makeJob('j1'));
    useAppStore.getState().addAnalysis(makeAnalysis('a1', 'c1', 'נועה כהן'));
    const before = storageSnapshot();

    // Exercise every mutation family: screener carding, manual seed, move,
    // suggestion accept, reply chip, contact log, undo.
    runScreener(useAppStore.getState().analyses);
    const { person, deal } = seedPersonWithDeal({
      name: 'Extra Person',
      phone: '0521111111',
      jobTitle: 'QA',
      stage: 'Sourced',
    });
    const store = usePipelineStore.getState();
    store.moveDeal(deal.id, 'Submitted');
    const sug = store.addSuggestion({
      agent: 'screener',
      kind: 'next_action',
      dealId: deal.id,
      title: 'פעולה',
      body: '',
    });
    store.acceptSuggestion(sug.id);
    store.setReplyState(person.id, 'replied');
    store.logContact(person.id, 'whatsapp', 'deadbeef');
    store.undoLast();

    const after = storageSnapshot();
    // Every changed/added key is namespaced revital_v3_*.
    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) {
        expect(key.startsWith('revital_v3_'), `non-v3 key mutated: ${key}`).toBe(true);
      }
    }
    // No legacy key vanished either.
    for (const key of Object.keys(before)) {
      expect(after[key], `legacy key removed: ${key}`).toBe(before[key]);
    }
    // Sanity: the flow really did persist v3 data.
    expect(v3Keys().length).toBeGreaterThan(0);
  });

  it('v3 flows never mutate the legacy store state (read-only seam)', () => {
    useAppStore.getState().addAnalysis(makeAnalysis('a2', 'c2', 'רון כהן'));
    const legacyBefore = useAppStore.getState();
    const analysesRef = legacyBefore.analyses;

    runScreener(analysesRef);
    const { deal } = seedPersonWithDeal({ name: 'X Y', jobTitle: 'Dev', stage: 'Sourced' });
    usePipelineStore.getState().moveDeal(deal.id, 'Screened');

    // Same state object, same analyses array reference — untouched.
    expect(useAppStore.getState().analyses).toBe(analysesRef);
    expect(useAppStore.getState().analyses[0].candidateName).toBe('רון כהן');
  });

  it('the board nav entry appears with the flag on (Header seam)', () => {
    useAppStore.setState({ currentView: 'dashboard' });
    render(<App />);
    expect(screen.getByText('לוח')).toBeTruthy();
  });
});
