// ============================================================
// Revital — Type Definitions
// ============================================================

export interface JobDescription {
  id: string;
  title: string;
  rawText: string;
  pillars: EvaluationPillar[];
  sourceUrl?: string; // if imported from URL
  createdAt: string;
}

export interface EvaluationPillar {
  name: string;
  description: string;
  weight: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  keywords: string[];
}

export interface Candidate {
  id: string;
  name: string;
  fileName: string;
  rawText: string;
  linkedinUrl?: string;
  uploadedAt: string;
}

export interface CandidateAnalysis {
  id: string;
  candidateId: string;
  jobId: string;
  candidateName: string;
  jobTitle: string;
  timestamp: string;

  // Core output
  profileSummary: string;
  matchScore: number; // 0-100
  verdict: 'Strong Fit' | 'Potential' | 'Reject';

  // Pillar breakdown
  pillarScores: PillarScore[];

  // Flags
  greenFlags: string[];
  redFlags: string[];

  // Red flag detection
  autoRedFlags: AutoRedFlag[];

  // Interview questions
  truthTestQuestions: TruthTestQuestion[];

  // AI-generated recruiter notes
  recruiterNotes: {
    outreachAngle: string;
    salaryEstimate: string;
    additionalNotes: string;
  };

  // Recruiter's own free-text comment
  recruiterComment: string;

  // Raw response for debugging
  rawResponse: string;
}

export interface PillarScore {
  pillarName: string;
  score: number; // 1-10
  evidence: string;
  gap: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface AutoRedFlag {
  type: 'job_hopping' | 'title_inflation' | 'buzzword_padding' | 'employment_gap' | 'regression' | 'overqualified' | 'limited_scope';
  description: string;
  severity: 'warning' | 'critical';
}

export interface TruthTestQuestion {
  question: string;
  intent: string; // what you're trying to verify
}

export interface AnalysisLog {
  id: string;
  jobId: string;
  jobTitle: string;
  candidateName: string;
  matchScore: number;
  verdict: string;
  timestamp: string;
  summary: string; // 1-line for sharing
}

export interface AppSettings {
  apiKey: string;       // API key (direct mode) or access code (proxy mode)
  model: string;
  maxTokens: number;
  mode: 'auto' | 'proxy' | 'direct';  // auto detects based on hostname
}

export type AppView = 'dashboard' | 'analyze' | 'results' | 'jobs' | 'history' | 'comparison' | 'settings';
