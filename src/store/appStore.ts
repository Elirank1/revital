import { create } from 'zustand';
import type {
  AppView,
  AppSettings,
  JobDescription,
  Candidate,
  CandidateAnalysis,
  AnalysisLog,
} from '../types';
import type { OutreachDraft } from '../modules/outreach/outreachTypes';
import type { InterviewSummaryData } from '../modules/interview/interviewTypes';
import type { ProfileIntelligence } from '../modules/profile-intel/profileTypes';

interface AppState {
  // Navigation
  currentView: AppView;
  setView: (view: AppView) => void;

  // Settings
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;

  // Job Description (current working JD for analyze tab)
  currentJob: JobDescription | null;
  setCurrentJob: (job: JobDescription | null) => void;

  // Saved Jobs (persisted)
  savedJobs: JobDescription[];
  saveJob: (job: JobDescription) => void;
  removeJob: (id: string) => void;

  // Candidates
  candidates: Candidate[];
  addCandidate: (candidate: Candidate) => void;
  removeCandidate: (id: string) => void;
  clearCandidates: () => void;

  // Analyses
  analyses: CandidateAnalysis[];
  addAnalysis: (analysis: CandidateAnalysis) => void;
  currentAnalysis: CandidateAnalysis | null;
  setCurrentAnalysis: (analysis: CandidateAnalysis | null) => void;
  updateAnalysisComment: (id: string, comment: string) => void;
  linkAnalysisToJob: (analysisId: string, jobId: string, jobTitle: string) => void;
  updateAnalysisName: (analysisId: string, candidateName: string) => void;

  // History log
  analysisLog: AnalysisLog[];
  addToLog: (entry: AnalysisLog) => void;
  clearLog: () => void;

  // UI state
  isAnalyzing: boolean;
  setIsAnalyzing: (v: boolean) => void;
  analysisProgress: string;
  setAnalysisProgress: (msg: string) => void;
  error: string | null;
  setError: (msg: string | null) => void;

  // Cloud sync
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  lastSyncAt: string | null;
  syncFromCloud: () => Promise<void>;
  syncToCloud: () => Promise<void>;

  // Module: Outreach
  outreachDrafts: OutreachDraft[];
  addOutreachDraft: (draft: OutreachDraft) => void;

  // Module: Interview Summary
  interviewSummaries: InterviewSummaryData[];
  addInterviewSummary: (summary: InterviewSummaryData) => void;

  // Module: Profile Intelligence
  profileIntelligence: ProfileIntelligence[];
  addProfileIntel: (intel: ProfileIntelligence) => void;
}

const loadFromStorage = <T>(key: string, fallback: T): T => {
  try {
    const data = localStorage.getItem(`revital_${key}`);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
};

const saveToStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(`revital_${key}`, JSON.stringify(value));
  } catch {
    // localStorage full or unavailable
  }
};

/** Check if we're on Vercel (proxy mode available) */
function isProxyMode(): boolean {
  return window.location.hostname.includes('vercel.app') ||
    window.location.hostname === 'localhost';
}

/** Sync data to cloud via /api/data */
async function pushToCloud(accessCode: string, data: { analyses: CandidateAnalysis[]; savedJobs: JobDescription[]; log: AnalysisLog[] }) {
  const response = await fetch(`${window.location.origin}/api/data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Code': accessCode,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Cloud sync failed');
  return response.json();
}

/** Pull data from cloud via /api/data */
async function pullFromCloud(accessCode: string) {
  const response = await fetch(`${window.location.origin}/api/data`, {
    method: 'GET',
    headers: { 'X-Access-Code': accessCode },
  });
  if (!response.ok) throw new Error('Cloud fetch failed');
  return response.json();
}

export const useAppStore = create<AppState>((set, get) => ({
  // Navigation
  currentView: 'dashboard',
  setView: (view) => set({ currentView: view }),

  // Settings
  settings: loadFromStorage('settings', {
    apiKey: '',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    mode: 'auto' as const,
  }),
  updateSettings: (partial) => {
    const updated = { ...get().settings, ...partial };
    saveToStorage('settings', updated);
    set({ settings: updated });
  },

  // Job (current working JD)
  currentJob: null,
  setCurrentJob: (job) => set({ currentJob: job }),

  // Saved Jobs
  savedJobs: loadFromStorage('savedJobs', []),
  saveJob: (job) => {
    const existing = get().savedJobs;
    if (existing.some((j) => j.id === job.id)) return;
    const updated = [job, ...existing];
    saveToStorage('savedJobs', updated.slice(0, 50));
    set({ savedJobs: updated });
    get().syncToCloud();
  },
  removeJob: (id) => {
    const updated = get().savedJobs.filter((j) => j.id !== id);
    saveToStorage('savedJobs', updated);
    set({ savedJobs: updated });
    get().syncToCloud();
  },

  // Candidates
  candidates: [],
  addCandidate: (candidate) =>
    set((s) => ({ candidates: [...s.candidates, candidate] })),
  removeCandidate: (id) =>
    set((s) => ({ candidates: s.candidates.filter((c) => c.id !== id) })),
  clearCandidates: () => set({ candidates: [] }),

  // Analyses
  analyses: loadFromStorage('analyses', []),
  addAnalysis: (analysis) => {
    const updated = [analysis, ...get().analyses];
    saveToStorage('analyses', updated.slice(0, 100));
    set({ analyses: updated });
    get().syncToCloud();
  },
  currentAnalysis: null,
  setCurrentAnalysis: (analysis) => set({ currentAnalysis: analysis }),
  updateAnalysisComment: (id, comment) => {
    const updated = get().analyses.map((a) =>
      a.id === id ? { ...a, recruiterComment: comment } : a
    );
    saveToStorage('analyses', updated.slice(0, 100));
    set({ analyses: updated });
    const current = get().currentAnalysis;
    if (current && current.id === id) {
      set({ currentAnalysis: { ...current, recruiterComment: comment } });
    }
    get().syncToCloud();
  },
  linkAnalysisToJob: (analysisId, jobId, jobTitle) => {
    const updated = get().analyses.map((a) =>
      a.id === analysisId ? { ...a, jobId, jobTitle } : a
    );
    saveToStorage('analyses', updated.slice(0, 100));
    set({ analyses: updated });
    // Also update the log entry
    const updatedLog = get().analysisLog.map((l) =>
      l.id === analysisId ? { ...l, jobId, jobTitle } : l
    );
    saveToStorage('log', updatedLog.slice(0, 200));
    set({ analysisLog: updatedLog });
    // Update currentAnalysis if viewing it
    const current = get().currentAnalysis;
    if (current && current.id === analysisId) {
      set({ currentAnalysis: { ...current, jobId, jobTitle } });
    }
    get().syncToCloud();
  },
  updateAnalysisName: (analysisId, candidateName) => {
    const updated = get().analyses.map((a) =>
      a.id === analysisId ? { ...a, candidateName } : a
    );
    saveToStorage('analyses', updated.slice(0, 100));
    set({ analyses: updated });
    const updatedLog = get().analysisLog.map((l) =>
      l.id === analysisId ? { ...l, candidateName, summary: l.summary.replace(/^[^→]+/, candidateName + ' ') } : l
    );
    saveToStorage('log', updatedLog.slice(0, 200));
    set({ analysisLog: updatedLog });
    const current = get().currentAnalysis;
    if (current && current.id === analysisId) {
      set({ currentAnalysis: { ...current, candidateName } });
    }
    get().syncToCloud();
  },

  // History log
  analysisLog: loadFromStorage('log', []),
  addToLog: (entry) => {
    const updated = [entry, ...get().analysisLog];
    saveToStorage('log', updated.slice(0, 200));
    set({ analysisLog: updated });
    // synced together with analyses
  },
  clearLog: () => {
    saveToStorage('log', []);
    set({ analysisLog: [] });
  },

  // UI
  isAnalyzing: false,
  setIsAnalyzing: (v) => set({ isAnalyzing: v }),
  analysisProgress: '',
  setAnalysisProgress: (msg) => set({ analysisProgress: msg }),
  error: null,
  setError: (msg) => set({ error: msg }),

  // Cloud sync
  syncStatus: 'idle',
  lastSyncAt: null,

  syncFromCloud: async () => {
    if (!isProxyMode()) return;
    const { settings } = get();
    if (!settings.apiKey) return;

    set({ syncStatus: 'syncing' });
    try {
      const data = await pullFromCloud(settings.apiKey);
      // Merge cloud data with local (cloud wins for conflicts)
      if (data.analyses?.length) {
        const local = get().analyses;
        const merged = mergeById(local, data.analyses, 100);
        saveToStorage('analyses', merged);
        set({ analyses: merged });
      }
      if (data.savedJobs?.length) {
        const local = get().savedJobs;
        const merged = mergeById(local, data.savedJobs, 50);
        saveToStorage('savedJobs', merged);
        set({ savedJobs: merged });
      }
      if (data.log?.length) {
        const local = get().analysisLog;
        const merged = mergeById(local, data.log, 200);
        saveToStorage('log', merged);
        set({ analysisLog: merged });
      }
      set({ syncStatus: 'synced', lastSyncAt: new Date().toISOString() });
    } catch {
      set({ syncStatus: 'error' });
    }
  },

  syncToCloud: async () => {
    if (!isProxyMode()) return;
    const { settings, analyses, savedJobs, analysisLog } = get();
    if (!settings.apiKey) return;

    set({ syncStatus: 'syncing' });
    try {
      await pushToCloud(settings.apiKey, {
        analyses,
        savedJobs,
        log: analysisLog,
      });
      set({ syncStatus: 'synced', lastSyncAt: new Date().toISOString() });
    } catch {
      set({ syncStatus: 'error' });
    }
  },

  // Module: Outreach
  outreachDrafts: loadFromStorage('outreach', []),
  addOutreachDraft: (draft) => {
    const existing = get().outreachDrafts;
    // Replace if same analysisId exists, otherwise prepend
    const filtered = existing.filter((d) => d.analysisId !== draft.analysisId);
    const updated = [draft, ...filtered].slice(0, 200);
    saveToStorage('outreach', updated);
    set({ outreachDrafts: updated });
  },

  // Module: Interview Summary
  interviewSummaries: loadFromStorage('interviews', []),
  addInterviewSummary: (summary) => {
    const existing = get().interviewSummaries;
    const filtered = existing.filter((s) => s.analysisId !== summary.analysisId);
    const updated = [summary, ...filtered].slice(0, 100);
    saveToStorage('interviews', updated);
    set({ interviewSummaries: updated });
  },

  // Module: Profile Intelligence
  profileIntelligence: loadFromStorage('profileIntel', []),
  addProfileIntel: (intel) => {
    const existing = get().profileIntelligence;
    const filtered = existing.filter((p) => p.analysisId !== intel.analysisId);
    const updated = [intel, ...filtered].slice(0, 100);
    saveToStorage('profileIntel', updated);
    set({ profileIntelligence: updated });
  },
}));

/** Merge two arrays by id, newest first, capped at maxItems */
function mergeById<T extends { id: string; timestamp?: string; createdAt?: string }>(
  local: T[], remote: T[], maxItems: number
): T[] {
  const map = new Map<string, T>();
  for (const item of local) {
    if (item?.id) map.set(item.id, item);
  }
  for (const item of remote) {
    if (item?.id) map.set(item.id, item);
  }
  return Array.from(map.values())
    .sort((a, b) => (b.timestamp || b.createdAt || '').localeCompare(a.timestamp || a.createdAt || ''))
    .slice(0, maxItems);
}
