/**
 * Synthetic localStorage seed builders — Wave 3 Batch C (quality-gate).
 *
 * The e2e suite never talks to a network or an API: state is injected by
 * writing the EXACT persisted payload shapes the app loads on boot —
 * legacy `revital_*` keys (src/store/appStore.ts) and v3 `revital_v3_*`
 * keys (src/lib/persistence/keys.ts, src/lib/money/moneyStore.ts).
 * Every record here is synthetic (G4: never real candidate data).
 *
 * Shapes mirror:
 *  - Person / Deal / StageEvent / Suggestion  → src/types/pipeline.ts
 *  - MandateFee (revital_v3_fees)             → src/lib/money/mandateFee.ts
 *  - CandidateAnalysis / AnalysisLog          → src/types/index.ts
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (ms: number): string => new Date(ms).toISOString();

// ------------------------------------------------------------
// v3 records
// ------------------------------------------------------------

export interface SeedPerson {
  id: string;
  v: number;
  updatedAt: string;
  name: string;
  normalizedName: string;
  phone?: string;
  email?: string;
  analysisIds: string[];
  contactEvents: unknown[];
  bench?: {
    reason: string;
    since: string;
    benchedAt: string;
    benchReason: string;
    silverMedalist: boolean;
  };
  deleted?: true;
  deletedAt?: string;
}

export function mkPerson(
  args: { id: string; name: string; phone?: string; now?: number } & Partial<SeedPerson>,
): SeedPerson {
  const now = args.now ?? Date.now();
  const { id, name, phone, now: _n, ...rest } = args;
  return {
    id,
    v: 1,
    updatedAt: iso(now),
    name,
    normalizedName: name.trim().toLowerCase(),
    ...(phone ? { phone } : {}),
    analysisIds: [],
    contactEvents: [],
    ...rest,
  };
}

export interface SeedDeal {
  id: string;
  v: number;
  updatedAt: string;
  personId: string;
  jobId: string;
  jobTitle: string;
  stage: string;
  stageEnteredAt: string;
  createdAt: string;
  analysisId?: string;
  deleted?: true;
  deletedAt?: string;
}

export function mkDeal(args: {
  id: string;
  personId: string;
  jobId: string;
  jobTitle: string;
  stage?: string;
  /** Days ago the deal entered its current stage (aging determinism). */
  enteredDaysAgo?: number;
  now?: number;
}): SeedDeal {
  const now = args.now ?? Date.now();
  const entered = iso(now - (args.enteredDaysAgo ?? 0) * DAY_MS);
  return {
    id: args.id,
    v: 1,
    updatedAt: iso(now),
    personId: args.personId,
    jobId: args.jobId,
    jobTitle: args.jobTitle,
    stage: args.stage ?? 'Sourced',
    stageEnteredAt: entered,
    createdAt: entered,
  };
}

export interface SeedStageEvent {
  id: string;
  v: number;
  updatedAt: string;
  dealId: string;
  from: string | null;
  to: string;
  ts: string;
  actor: string;
  skippedStages: string[];
  reason?: string;
}

export function mkStageEvent(args: {
  id: string;
  dealId: string;
  from: string | null;
  to: string;
  daysAgo?: number;
  reason?: string;
  now?: number;
}): SeedStageEvent {
  const now = args.now ?? Date.now();
  const ts = iso(now - (args.daysAgo ?? 0) * DAY_MS);
  return {
    id: args.id,
    v: 1,
    updatedAt: ts,
    dealId: args.dealId,
    from: args.from,
    to: args.to,
    ts,
    actor: 'human',
    skippedStages: [],
    ...(args.reason ? { reason: args.reason } : {}),
  };
}

export interface SeedSuggestion {
  id: string;
  v: number;
  updatedAt: string;
  agent: string;
  kind: string;
  dealId?: string;
  personId?: string;
  title: string;
  body: string;
  evidence: { claim: string; sourceType: string; sourceId: string }[];
  status: string;
  createdAt: string;
}

export function mkSuggestion(args: {
  id: string;
  agent: string;
  kind: string;
  title: string;
  body: string;
  dealId?: string;
  personId?: string;
  evidence?: { claim: string; sourceType: string; sourceId: string }[];
  minutesAgo?: number;
  now?: number;
}): SeedSuggestion {
  const now = args.now ?? Date.now();
  const ts = iso(now - (args.minutesAgo ?? 0) * 60_000);
  return {
    id: args.id,
    v: 1,
    updatedAt: ts,
    agent: args.agent,
    kind: args.kind,
    ...(args.dealId ? { dealId: args.dealId } : {}),
    ...(args.personId ? { personId: args.personId } : {}),
    title: args.title,
    body: args.body,
    evidence: args.evidence ?? [],
    status: 'pending',
    createdAt: ts,
  };
}

export interface SeedFee {
  jobId: string;
  kind: 'percent' | 'fixed';
  percent?: number;
  expectedSalary?: number;
  fixedAmount?: number;
  currency: 'ILS';
  guaranteeDays: number;
  invoiceStatus: 'none' | 'due' | 'sent' | 'paid';
  invoiceDueAt?: string;
  updatedAt: string;
}

/**
 * Build the v3 localStorage payload. `flag` defaults ON (raw 'on' string —
 * the flag key is NOT JSON, see src/components/pipeline/flags.ts).
 */
export function v3Storage(args: {
  persons?: SeedPerson[];
  deals?: SeedDeal[];
  events?: SeedStageEvent[];
  suggestions?: SeedSuggestion[];
  fees?: Record<string, SeedFee>;
  flag?: boolean;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (args.flag !== false) out['revital_v3_flag'] = 'on';
  if (args.persons) out['revital_v3_persons'] = JSON.stringify(args.persons);
  if (args.deals) out['revital_v3_deals'] = JSON.stringify(args.deals);
  if (args.events) out['revital_v3_events'] = JSON.stringify(args.events);
  if (args.suggestions) {
    out['revital_v3_suggestions'] = JSON.stringify(args.suggestions);
  }
  if (args.fees) out['revital_v3_fees'] = JSON.stringify(args.fees);
  return out;
}

// ------------------------------------------------------------
// Legacy records (flag-off regression + score chips)
// ------------------------------------------------------------

/** A complete synthetic CandidateAnalysis (every field the views touch). */
export function mkAnalysis(args: {
  id: string;
  candidateName: string;
  jobTitle: string;
  jobId?: string;
  matchScore?: number;
  verdict?: 'Strong Fit' | 'Potential' | 'Reject';
  now?: number;
}) {
  const now = args.now ?? Date.now();
  return {
    id: args.id,
    candidateId: `cand_${args.id}`,
    jobId: args.jobId ?? 'job_legacy_1',
    candidateName: args.candidateName,
    jobTitle: args.jobTitle,
    timestamp: iso(now - DAY_MS),
    profileSummary: 'מהנדס/ת תוכנה עם ניסיון סינתטי לבדיקות בלבד.',
    matchScore: args.matchScore ?? 87,
    verdict: args.verdict ?? 'Strong Fit',
    pillarScores: [
      {
        pillarName: 'Backend Experience',
        score: 8,
        evidence: 'Synthetic evidence line.',
        gap: 'None material.',
        riskLevel: 'LOW',
      },
    ],
    greenFlags: ['ניסיון רלוונטי (סינתטי)'],
    redFlags: [],
    autoRedFlags: [],
    truthTestQuestions: [
      { question: 'שאלת אימות סינתטית?', intent: 'בדיקת עקביות' },
    ],
    recruiterQuestions: [
      { question: 'שאלת סינון סינתטית?', purpose: 'התאמה טכנית' },
    ],
    recruiterNotes: {
      outreachAngle: 'זווית פנייה סינתטית.',
      salaryEstimate: '30-35K',
      additionalNotes: 'הערות סינתטיות.',
    },
    recruiterComment: '',
    rawResponse: '{}',
  };
}

export function mkLogEntry(args: {
  id: string;
  candidateName: string;
  jobTitle: string;
  jobId?: string;
  matchScore?: number;
  verdict?: string;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  return {
    id: args.id,
    jobId: args.jobId ?? 'job_legacy_1',
    jobTitle: args.jobTitle,
    candidateName: args.candidateName,
    matchScore: args.matchScore ?? 87,
    verdict: args.verdict ?? 'Strong Fit',
    timestamp: iso(now - DAY_MS),
    summary: `${args.candidateName} → ${args.jobTitle}`,
  };
}

/** Legacy localStorage payload (apiKey stays '' so no sync fetch fires). */
export function legacyStorage(args: {
  analyses?: unknown[];
  log?: unknown[];
  darkMode?: boolean;
}): Record<string, string> {
  const out: Record<string, string> = {
    revital_settings: JSON.stringify({
      apiKey: '',
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
      mode: 'auto',
      darkMode: args.darkMode ?? false,
    }),
  };
  if (args.analyses) out['revital_analyses'] = JSON.stringify(args.analyses);
  if (args.log) out['revital_log'] = JSON.stringify(args.log);
  return out;
}
