// ============================================================
// Candidate Fingerprint — Structured profile representation
// Used for look-alike search and candidate-to-JD matching
// ============================================================

export interface CandidateFingerprint {
  id: string;
  candidateId: string;
  analysisId?: string;
  candidateName: string;
  timestamp: string;

  // Core identity
  currentTitle: string;
  seniorityLevel: 'Junior' | 'Mid' | 'Senior' | 'Staff' | 'Principal' | 'Director' | 'VP' | 'C-Level';
  totalYearsExperience: number;

  // Skills — separated by type for better matching
  primarySkills: string[];       // Core technical skills (max 8)
  secondarySkills: string[];     // Supporting skills (max 8)
  tools: string[];               // Specific tools, frameworks, platforms (max 10)
  languages: string[];           // Programming languages (max 6)

  // Domain & industry
  domains: string[];             // e.g., ["fintech", "payments", "ML infrastructure"] (max 5)
  industries: string[];          // e.g., ["financial services", "healthcare"] (max 4)

  // Company pattern
  companyTier: 'Tier-1' | 'Scale-up' | 'Startup' | 'Enterprise' | 'Mixed';
  companyNames: string[];        // Recent companies (max 4)
  teamSize: 'IC' | 'Small Team' | 'Large Team' | 'Org-Level' | 'Unknown';

  // Career trajectory
  trajectoryPattern: string;     // e.g., "IC → Tech Lead → Staff → Architect"
  tenurePattern: 'Long tenure' | 'Medium tenure' | 'Short tenure' | 'Mixed';
  careerArc: 'Rising' | 'Stable senior' | 'Lateral' | 'Transitioning' | 'Early career';

  // Location & logistics
  location: string;
  remotePreference: 'On-site' | 'Hybrid' | 'Remote' | 'Unknown';

  // Education signal
  educationLevel: 'PhD' | 'Masters' | 'Bachelors' | 'Bootcamp' | 'Self-taught' | 'Unknown';
  educationField: string;

  // Source
  sourceType: 'cv' | 'linkedin';
  linkedinUrl?: string;
}

/**
 * Search criteria generated from a JD, CV, or fingerprint.
 * Used to query LinkedIn Recruiter, third-party APIs, or internal DB.
 */
export interface SearchCriteria {
  id: string;
  sourceType: 'jd' | 'cv' | 'fingerprint';
  sourceId: string; // jobId, candidateId, or fingerprintId
  sourceName: string; // job title or candidate name
  timestamp: string;

  // What to search for
  targetTitles: string[];           // Job titles to search (max 5)
  requiredSkills: string[];         // Must-have skills (max 8)
  preferredSkills: string[];        // Nice-to-have skills (max 6)
  domains: string[];                // Target domains (max 4)
  seniorityRange: string[];         // e.g., ["Senior", "Staff", "Principal"]
  experienceRange: { min: number; max: number };

  // Filters
  companyTierPreference: string[];  // e.g., ["Tier-1", "Scale-up"]
  locationPreference: string;
  industries: string[];

  // Ready-to-use query
  booleanQuery: string;             // LinkedIn Recruiter boolean search string
  searchSummary: string;            // Human-readable 2-sentence summary
}
