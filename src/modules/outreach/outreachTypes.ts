export interface OutreachDraft {
  id: string;
  analysisId: string;
  candidateName: string;
  jobTitle: string;
  firstMessage: string;
  followUpMessage: string;
  tone: OutreachTone;
  companyContext: string;
  timestamp: string;
}

export type OutreachTone = 'professional' | 'warm' | 'direct' | 'consultative';
