export interface InterviewSummaryData {
  id: string;
  analysisId: string;
  candidateName: string;
  jobTitle: string;
  timestamp: string;

  overview: string;
  strengths: string[];
  concerns: string[];
  openQuestions: string[];
  recommendation: string;
  cultureFit: string;

  managerSummary: string;

  rawTranscript: string;
}
