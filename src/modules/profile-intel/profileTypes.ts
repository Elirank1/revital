export interface ProfileIntelligence {
  id: string;
  analysisId: string;
  candidateName: string;
  timestamp: string;

  careerArc: string;
  seniorityProgression: string;
  companyPattern: string;
  domainExpertise: string[];

  likelyMotivations: string[];
  openToChange: 'likely' | 'possible' | 'unlikely' | 'unknown';
  openToChangeReasoning: string;

  locationConfidence: string;
  salaryBand: string;
  noticeRisk: string;

  bestApproachAngle: string;
  thingsToVerify: string[];
}
