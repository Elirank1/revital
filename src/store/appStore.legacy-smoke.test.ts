// ============================================================
// Legacy smoke suite — appStore (quality-gate, Wave 0)
// Pins V2 store behavior: action semantics, caps, localStorage
// round-trip, and cloud-sync merge semantics.
// Node environment; window/localStorage/fetch are stubbed —
// NO real network, NO real data (gate G2).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobDescription, CandidateAnalysis, AnalysisLog } from '../types';

// ---- global stubs (must exist BEFORE the store module loads) ----

function makeLocalStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
    _map: map,
  };
}

const storageMock = makeLocalStorageMock();
const fetchMock = vi.fn();

vi.stubGlobal('localStorage', storageMock);
vi.stubGlobal('window', {
  location: { hostname: 'localhost', origin: 'http://localhost:3000' },
});
vi.stubGlobal('fetch', fetchMock);

// Store module loads AFTER stubs are in place.
const { useAppStore } = await import('./appStore');

const initialState = useAppStore.getState();

// ---- synthetic fixtures (never real candidate data) ----

let seq = 0;
function makeJob(overrides: Partial<JobDescription> = {}): JobDescription {
  seq += 1;
  return {
    id: `job-${seq}`,
    title: `Synthetic Role ${seq}`,
    rawText: 'Synthetic JD text.',
    pillars: [],
    createdAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<CandidateAnalysis> = {}): CandidateAnalysis {
  seq += 1;
  return {
    id: `an-${seq}`,
    candidateId: `cand-${seq}`,
    jobId: `job-${seq}`,
    candidateName: `Synthetic Candidate ${seq}`,
    jobTitle: `Synthetic Role ${seq}`,
    timestamp: `2026-01-02T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    profileSummary: 'synthetic',
    matchScore: 50,
    verdict: 'Potential',
    pillarScores: [],
    greenFlags: [],
    redFlags: [],
    autoRedFlags: [],
    truthTestQuestions: [],
    recruiterQuestions: [],
    recruiterNotes: { outreachAngle: '', salaryEstimate: '', additionalNotes: '' },
    recruiterComment: '',
    rawResponse: '{}',
    ...overrides,
  };
}

function makeLogEntry(overrides: Partial<AnalysisLog> = {}): AnalysisLog {
  seq += 1;
  return {
    id: `an-${seq}`,
    jobId: `job-${seq}`,
    jobTitle: `Synthetic Role ${seq}`,
    candidateName: `Synthetic Candidate ${seq}`,
    matchScore: 50,
    verdict: 'Potential',
    timestamp: `2026-01-03T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    summary: `Synthetic Candidate ${seq} → Synthetic Role ${seq}: 50% (Potential)`,
    ...overrides,
  };
}

function stored<T>(key: string): T | null {
  const raw = storageMock.getItem(`revital_${key}`);
  return raw ? (JSON.parse(raw) as T) : null;
}

beforeEach(() => {
  // Full reset: state (including default apiKey '' so fire-and-forget
  // syncToCloud early-returns in action tests), storage, fetch.
  useAppStore.setState(initialState, true);
  useAppStore.setState({
    settings: { apiKey: '', model: 'claude-sonnet-4-6', maxTokens: 4096, mode: 'auto', darkMode: false },
    savedJobs: [],
    analyses: [],
    analysisLog: [],
    currentAnalysis: null,
    syncStatus: 'idle',
    lastSyncAt: null,
  });
  storageMock.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

// ============================================================
// saveJob / removeJob
// ============================================================

describe('saveJob', () => {
  it('prepends a new job and persists it', () => {
    const a = makeJob();
    const b = makeJob();
    useAppStore.getState().saveJob(a);
    useAppStore.getState().saveJob(b);
    expect(useAppStore.getState().savedJobs.map((j) => j.id)).toEqual([b.id, a.id]);
    expect(stored<JobDescription[]>('savedJobs')!.map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it('dedupes by id — saving an existing id is a no-op (state and storage untouched)', () => {
    const a = makeJob();
    useAppStore.getState().saveJob(a);
    const storageBefore = storageMock.getItem('revital_savedJobs');
    useAppStore.getState().saveJob({ ...a, title: 'Changed Title' });
    expect(useAppStore.getState().savedJobs).toHaveLength(1);
    expect(useAppStore.getState().savedJobs[0].title).toBe(a.title); // NOT updated
    expect(storageMock.getItem('revital_savedJobs')).toBe(storageBefore);
  });

  it('caps persisted jobs at 50 (legacy quirk: in-memory state may exceed the cap; only storage is sliced)', () => {
    const fifty = Array.from({ length: 50 }, () => makeJob());
    useAppStore.setState({ savedJobs: fifty });
    const extra = makeJob();
    useAppStore.getState().saveJob(extra);
    // Storage: capped at 50, newest first, oldest dropped
    const persisted = stored<JobDescription[]>('savedJobs')!;
    expect(persisted).toHaveLength(50);
    expect(persisted[0].id).toBe(extra.id);
    expect(persisted.map((j) => j.id)).not.toContain(fifty[49].id);
    // In-memory state: 51 (documented legacy behavior — cap applies to storage only)
    expect(useAppStore.getState().savedJobs).toHaveLength(51);
  });
});

describe('removeJob', () => {
  it('removes by id from state and storage', () => {
    const a = makeJob();
    const b = makeJob();
    useAppStore.getState().saveJob(a);
    useAppStore.getState().saveJob(b);
    useAppStore.getState().removeJob(a.id);
    expect(useAppStore.getState().savedJobs.map((j) => j.id)).toEqual([b.id]);
    expect(stored<JobDescription[]>('savedJobs')!.map((j) => j.id)).toEqual([b.id]);
  });

  it('is a no-op for an unknown id', () => {
    const a = makeJob();
    useAppStore.getState().saveJob(a);
    useAppStore.getState().removeJob('does-not-exist');
    expect(useAppStore.getState().savedJobs).toHaveLength(1);
  });
});

// ============================================================
// addAnalysis / updateAnalysisComment / linkAnalysisToJob
// ============================================================

describe('addAnalysis', () => {
  it('prepends and persists', () => {
    const a1 = makeAnalysis();
    const a2 = makeAnalysis();
    useAppStore.getState().addAnalysis(a1);
    useAppStore.getState().addAnalysis(a2);
    expect(useAppStore.getState().analyses.map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(stored<CandidateAnalysis[]>('analyses')!.map((a) => a.id)).toEqual([a2.id, a1.id]);
  });

  it('caps persisted analyses at 100 (storage sliced; state uncapped — legacy quirk)', () => {
    const hundred = Array.from({ length: 100 }, () => makeAnalysis());
    useAppStore.setState({ analyses: hundred });
    const extra = makeAnalysis();
    useAppStore.getState().addAnalysis(extra);
    const persisted = stored<CandidateAnalysis[]>('analyses')!;
    expect(persisted).toHaveLength(100);
    expect(persisted[0].id).toBe(extra.id);
    expect(useAppStore.getState().analyses).toHaveLength(101);
  });
});

describe('updateAnalysisComment', () => {
  it('updates the comment on the matching analysis only, and persists', () => {
    const a1 = makeAnalysis();
    const a2 = makeAnalysis();
    useAppStore.setState({ analyses: [a1, a2] });
    useAppStore.getState().updateAnalysisComment(a1.id, 'good phone screen');
    const s = useAppStore.getState();
    expect(s.analyses.find((a) => a.id === a1.id)!.recruiterComment).toBe('good phone screen');
    expect(s.analyses.find((a) => a.id === a2.id)!.recruiterComment).toBe('');
    expect(stored<CandidateAnalysis[]>('analyses')!.find((a) => a.id === a1.id)!.recruiterComment).toBe(
      'good phone screen'
    );
  });

  it('mirrors the comment into currentAnalysis when it is the same record', () => {
    const a1 = makeAnalysis();
    useAppStore.setState({ analyses: [a1], currentAnalysis: a1 });
    useAppStore.getState().updateAnalysisComment(a1.id, 'note');
    expect(useAppStore.getState().currentAnalysis!.recruiterComment).toBe('note');
  });

  it('does not touch currentAnalysis when it is a different record', () => {
    const a1 = makeAnalysis();
    const a2 = makeAnalysis();
    useAppStore.setState({ analyses: [a1, a2], currentAnalysis: a2 });
    useAppStore.getState().updateAnalysisComment(a1.id, 'note');
    expect(useAppStore.getState().currentAnalysis!.recruiterComment).toBe('');
  });
});

describe('linkAnalysisToJob', () => {
  it('updates analysis, matching log entry, and currentAnalysis consistently', () => {
    const a1 = makeAnalysis();
    const log1 = makeLogEntry({ id: a1.id });
    const logOther = makeLogEntry();
    useAppStore.setState({ analyses: [a1], analysisLog: [log1, logOther], currentAnalysis: a1 });

    useAppStore.getState().linkAnalysisToJob(a1.id, 'job-X', 'Linked Role');

    const s = useAppStore.getState();
    expect(s.analyses[0]).toMatchObject({ jobId: 'job-X', jobTitle: 'Linked Role' });
    expect(s.analysisLog.find((l) => l.id === a1.id)).toMatchObject({ jobId: 'job-X', jobTitle: 'Linked Role' });
    expect(s.analysisLog.find((l) => l.id === logOther.id)!.jobId).toBe(logOther.jobId); // untouched
    expect(s.currentAnalysis).toMatchObject({ jobId: 'job-X', jobTitle: 'Linked Role' });
    // Both persisted
    expect(stored<CandidateAnalysis[]>('analyses')![0].jobId).toBe('job-X');
    expect(stored<AnalysisLog[]>('log')!.find((l) => l.id === a1.id)!.jobTitle).toBe('Linked Role');
  });
});

// ============================================================
// addToLog / clearLog
// ============================================================

describe('addToLog', () => {
  it('prepends and persists', () => {
    const l1 = makeLogEntry();
    const l2 = makeLogEntry();
    useAppStore.getState().addToLog(l1);
    useAppStore.getState().addToLog(l2);
    expect(useAppStore.getState().analysisLog.map((l) => l.id)).toEqual([l2.id, l1.id]);
    expect(stored<AnalysisLog[]>('log')!.map((l) => l.id)).toEqual([l2.id, l1.id]);
  });

  it('caps persisted log at 200 (storage sliced; state uncapped — legacy quirk)', () => {
    const twoHundred = Array.from({ length: 200 }, () => makeLogEntry());
    useAppStore.setState({ analysisLog: twoHundred });
    const extra = makeLogEntry();
    useAppStore.getState().addToLog(extra);
    const persisted = stored<AnalysisLog[]>('log')!;
    expect(persisted).toHaveLength(200);
    expect(persisted[0].id).toBe(extra.id);
    expect(useAppStore.getState().analysisLog).toHaveLength(201);
  });

  it('does not trigger cloud sync on its own (synced together with analyses)', () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, apiKey: 'synthetic-code' },
    });
    useAppStore.getState().addToLog(makeLogEntry());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('clearLog', () => {
  it('empties state and storage', () => {
    useAppStore.getState().addToLog(makeLogEntry());
    useAppStore.getState().clearLog();
    expect(useAppStore.getState().analysisLog).toEqual([]);
    expect(stored<AnalysisLog[]>('log')).toEqual([]);
  });
});

// ============================================================
// localStorage round-trip — a fresh store instance rehydrates
// ============================================================

describe('localStorage round-trip', () => {
  it('a freshly loaded store reads back persisted jobs/analyses/log/settings', async () => {
    const job = makeJob();
    const analysis = makeAnalysis();
    const entry = makeLogEntry();
    useAppStore.getState().saveJob(job);
    useAppStore.getState().addAnalysis(analysis);
    useAppStore.getState().addToLog(entry);
    useAppStore.getState().updateSettings({ darkMode: true });

    // Re-evaluate the module against the SAME mocked localStorage.
    vi.resetModules();
    const fresh = await import('./appStore');
    const s = fresh.useAppStore.getState();
    expect(s.savedJobs.map((j) => j.id)).toEqual([job.id]);
    expect(s.analyses.map((a) => a.id)).toEqual([analysis.id]);
    expect(s.analysisLog.map((l) => l.id)).toEqual([entry.id]);
    expect(s.settings.darkMode).toBe(true);
  });

  it('corrupt storage falls back to defaults instead of throwing', async () => {
    storageMock.setItem('revital_savedJobs', '{not valid json');
    vi.resetModules();
    const fresh = await import('./appStore');
    expect(fresh.useAppStore.getState().savedJobs).toEqual([]);
  });
});

// ============================================================
// Cloud sync — mocked fetch only (gate G2: never the real /api)
// ============================================================

describe('syncToCloud', () => {
  it('POSTs the exact local arrays with the access code header', async () => {
    const job = makeJob();
    const analysis = makeAnalysis();
    const entry = makeLogEntry();
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, apiKey: 'synthetic-code' },
      savedJobs: [job],
      analyses: [analysis],
      analysisLog: [entry],
    });

    await useAppStore.getState().syncToCloud();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/data');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Access-Code']).toBe('synthetic-code');
    expect(JSON.parse(init.body)).toEqual({
      analyses: [analysis],
      savedJobs: [job],
      log: [entry],
    });
    expect(useAppStore.getState().syncStatus).toBe('synced');
    expect(useAppStore.getState().lastSyncAt).toBeTruthy();
  });

  it('is a no-op without an access code', async () => {
    await useAppStore.getState().syncToCloud();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().syncStatus).toBe('idle');
  });

  it('sets syncStatus=error on a failed response and does not throw', async () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, apiKey: 'synthetic-code' },
    });
    fetchMock.mockResolvedValue({ ok: false, text: async () => 'boom' });
    await useAppStore.getState().syncToCloud();
    expect(useAppStore.getState().syncStatus).toBe('error');
  });
});

describe('syncFromCloud merge semantics', () => {
  function withApiKey() {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, apiKey: 'synthetic-code' },
    });
  }

  function mockCloud(data: unknown) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });
  }

  it('merges by id, newest timestamp first; cloud wins on id conflict; nothing invented', async () => {
    withApiKey();
    const localOld = makeAnalysis({ id: 'shared', timestamp: '2026-01-01T00:00:00.000Z', recruiterComment: 'local' });
    const localOnly = makeAnalysis({ id: 'local-only', timestamp: '2026-01-05T00:00:00.000Z' });
    const cloudShared = { ...localOld, timestamp: '2026-01-03T00:00:00.000Z', recruiterComment: 'cloud' };
    const cloudOnly = makeAnalysis({ id: 'cloud-only', timestamp: '2026-01-04T00:00:00.000Z' });
    useAppStore.setState({ analyses: [localOld, localOnly] });
    mockCloud({ analyses: [cloudShared, cloudOnly], savedJobs: [], log: [] });

    await useAppStore.getState().syncFromCloud();

    const merged = useAppStore.getState().analyses;
    // No invented records: ids are exactly the union
    expect(merged.map((a) => a.id).sort()).toEqual(['cloud-only', 'local-only', 'shared']);
    // Cloud version wins the id conflict
    expect(merged.find((a) => a.id === 'shared')!.recruiterComment).toBe('cloud');
    // Newest-first ordering by timestamp
    expect(merged.map((a) => a.id)).toEqual(['local-only', 'cloud-only', 'shared']);
    // Persisted too
    expect(stored<CandidateAnalysis[]>('analyses')!.map((a) => a.id)).toEqual([
      'local-only',
      'cloud-only',
      'shared',
    ]);
    expect(useAppStore.getState().syncStatus).toBe('synced');
  });

  it('holds the caps: analyses 100, savedJobs 50, log 200 — keeping the newest', async () => {
    withApiKey();
    const pad = (n: number) => String(n).padStart(3, '0');
    const localAnalyses = Array.from({ length: 60 }, (_, i) =>
      makeAnalysis({ id: `la-${i}`, timestamp: `2026-02-01T00:00:00.${pad(i)}Z` })
    );
    const cloudAnalyses = Array.from({ length: 60 }, (_, i) =>
      makeAnalysis({ id: `ca-${i}`, timestamp: `2026-02-02T00:00:00.${pad(i)}Z` })
    );
    const localJobs = Array.from({ length: 30 }, (_, i) =>
      makeJob({ id: `lj-${i}`, createdAt: `2026-02-01T00:00:00.${pad(i)}Z` })
    );
    const cloudJobs = Array.from({ length: 30 }, (_, i) =>
      makeJob({ id: `cj-${i}`, createdAt: `2026-02-02T00:00:00.${pad(i)}Z` })
    );
    const localLog = Array.from({ length: 120 }, (_, i) =>
      makeLogEntry({ id: `ll-${i}`, timestamp: `2026-02-01T00:00:00.${pad(i)}Z` })
    );
    const cloudLog = Array.from({ length: 120 }, (_, i) =>
      makeLogEntry({ id: `cl-${i}`, timestamp: `2026-02-02T00:00:00.${pad(i)}Z` })
    );
    useAppStore.setState({ analyses: localAnalyses, savedJobs: localJobs, analysisLog: localLog });
    mockCloud({ analyses: cloudAnalyses, savedJobs: cloudJobs, log: cloudLog });

    await useAppStore.getState().syncFromCloud();

    const s = useAppStore.getState();
    expect(s.analyses).toHaveLength(100);
    expect(s.savedJobs).toHaveLength(50);
    expect(s.analysisLog).toHaveLength(200);
    // Newest survive: every cloud analysis (newer day) is retained
    expect(s.analyses.filter((a) => a.id.startsWith('ca-'))).toHaveLength(60);
    // Jobs sort by createdAt fallback — all 30 newer cloud jobs retained
    expect(s.savedJobs.filter((j) => j.id.startsWith('cj-'))).toHaveLength(30);
  });

  it('leaves local data untouched when cloud arrays are empty or missing', async () => {
    withApiKey();
    const a = makeAnalysis();
    const j = makeJob();
    useAppStore.setState({ analyses: [a], savedJobs: [j] });
    mockCloud({ analyses: [], log: [] }); // savedJobs missing entirely

    await useAppStore.getState().syncFromCloud();

    expect(useAppStore.getState().analyses).toEqual([a]);
    expect(useAppStore.getState().savedJobs).toEqual([j]);
    expect(useAppStore.getState().syncStatus).toBe('synced');
  });

  it('sets syncStatus=error on fetch failure and keeps local data', async () => {
    withApiKey();
    const a = makeAnalysis();
    useAppStore.setState({ analyses: [a] });
    fetchMock.mockRejectedValue(new Error('network down'));

    await useAppStore.getState().syncFromCloud();

    expect(useAppStore.getState().analyses).toEqual([a]);
    expect(useAppStore.getState().syncStatus).toBe('error');
  });

  it('is a no-op without an access code', async () => {
    await useAppStore.getState().syncFromCloud();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
