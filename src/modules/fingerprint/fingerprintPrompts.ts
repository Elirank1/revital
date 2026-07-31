// ============================================================
// Prompts for Candidate Fingerprint extraction
// and Search Criteria generation
// ============================================================

import type { JobDescription, EvaluationPillar } from '../../types';

/**
 * Extract a structured fingerprint from a CV or LinkedIn profile.
 * This is the foundation for look-alike search.
 */
export function buildFingerprintPrompt(cvText: string, linkedinUrl?: string): string {
  return `You are a Senior Technical Recruiter. Extract a structured candidate fingerprint from this profile. Be precise and evidence-based — only include what the CV clearly demonstrates.

PROFILE:
${cvText}
${linkedinUrl ? `\nLINKEDIN: ${linkedinUrl}` : ''}

Extract the following and respond in valid JSON only. No markdown, no explanation.

{
  "currentTitle": "their most recent/current title",
  "seniorityLevel": "Junior | Mid | Senior | Staff | Principal | Director | VP | C-Level",
  "totalYearsExperience": 12,

  "primarySkills": ["max 8 — their strongest, most demonstrated technical skills"],
  "secondarySkills": ["max 8 — supporting skills that appear in their work"],
  "tools": ["max 10 — specific tools, frameworks, platforms they used"],
  "languages": ["max 6 — programming languages"],

  "domains": ["max 5 — domain expertise areas, e.g. 'payments', 'ML infrastructure', 'computer vision'"],
  "industries": ["max 4 — industries they worked in, e.g. 'financial services', 'healthcare'"],

  "companyTier": "Tier-1 | Scale-up | Startup | Enterprise | Mixed",
  "companyNames": ["max 4 — most recent/notable companies"],
  "teamSize": "IC | Small Team | Large Team | Org-Level | Unknown",

  "trajectoryPattern": "e.g. 'IC → Tech Lead → Staff Engineer → Architect'",
  "tenurePattern": "Long tenure | Medium tenure | Short tenure | Mixed",
  "careerArc": "Rising | Stable senior | Lateral | Transitioning | Early career",

  "location": "best guess from CV, e.g. 'Tel Aviv, Israel' or 'San Francisco Bay Area'",
  "remotePreference": "On-site | Hybrid | Remote | Unknown",

  "educationLevel": "PhD | Masters | Bachelors | Bootcamp | Self-taught | Unknown",
  "educationField": "e.g. 'Computer Science', 'Electrical Engineering'"
}

RULES:
- primarySkills: only skills with CLEAR evidence of hands-on use. Not buzzwords.
- tools: specific named tools (e.g., "Kubernetes", "Spark", "PyTorch"), not generic terms.
- companyTier: Tier-1 = FAANG/top-50 tech. Scale-up = well-funded growth stage. Startup = early stage. Enterprise = large non-tech.
- tenurePattern: Long = 4+ years avg, Medium = 2-4, Short = under 2.
- If something is unclear from the CV, use your best inference but never fabricate.`;
}

/**
 * Generate search criteria from a Job Description.
 * Produces titles, skills, boolean query — ready to search.
 */
export function buildSearchCriteriaFromJDPrompt(
  job: JobDescription
): string {
  const pillarBlock = job.pillars
    .map(
      (p: EvaluationPillar, i: number) =>
        `${i + 1}. ${p.name} [${p.weight}]: ${p.description}\n   Keywords: ${p.keywords.join(', ')}`
    )
    .join('\n');

  return `You are a Senior Technical Recruiter building a candidate search strategy. Given this job and its evaluation pillars, generate precise search criteria.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${job.rawText}

EVALUATION PILLARS:
${pillarBlock}

Generate search criteria and respond in valid JSON only:

{
  "targetTitles": ["max 5 — job titles a matching candidate might hold. Include variations (e.g., 'Staff Engineer', 'Senior Staff Engineer', 'Principal Engineer')"],
  "requiredSkills": ["max 8 — must-have skills based on CRITICAL and HIGH pillars"],
  "preferredSkills": ["max 6 — nice-to-have skills from MEDIUM pillars"],
  "domains": ["max 4 — domain areas the ideal candidate would have"],
  "seniorityRange": ["e.g., ['Senior', 'Staff', 'Principal'] — the seniority levels that fit"],
  "experienceRange": { "min": 8, "max": 20 },
  "companyTierPreference": ["which company tiers would likely produce good candidates"],
  "locationPreference": "extracted from JD or 'Any'",
  "industries": ["target industries"],
  "booleanQuery": "A LinkedIn Recruiter boolean search string. Use AND, OR, NOT, quotes for phrases. Example: ('Staff Engineer' OR 'Principal Engineer') AND ('machine learning' OR 'deep learning') AND ('distributed systems' OR 'large scale')",
  "searchSummary": "2 sentences: who we're looking for and why"
}

RULES:
- booleanQuery should be directly usable in LinkedIn Recruiter search.
- targetTitles should include the actual JD title PLUS realistic variations.
- requiredSkills must map to CRITICAL/HIGH pillars — not generic terms.
- Be specific enough to avoid false positives, broad enough to not miss good candidates.`;
}

/**
 * Generate search criteria from a candidate fingerprint (look-alike search).
 * "Find more people like this person."
 */
export function buildSearchCriteriaFromFingerprintPrompt(
  fingerprintJson: string,
  candidateName: string
): string {
  return `You are a Senior Technical Recruiter. A recruiter found a strong candidate and wants to find similar professionals. Given this candidate's profile fingerprint, generate search criteria to find look-alikes.

REFERENCE CANDIDATE: ${candidateName}

CANDIDATE FINGERPRINT:
${fingerprintJson}

Generate search criteria to find SIMILAR candidates. Respond in valid JSON only:

{
  "targetTitles": ["max 5 — titles similar candidates would hold"],
  "requiredSkills": ["max 8 — core skills that define this profile type"],
  "preferredSkills": ["max 6 — additional skills that would make a stronger match"],
  "domains": ["max 4 — domains to search in"],
  "seniorityRange": ["seniority levels that would be comparable"],
  "experienceRange": { "min": 8, "max": 20 },
  "companyTierPreference": ["company tiers where similar candidates would be"],
  "locationPreference": "same region or 'Any'",
  "industries": ["industries to target"],
  "booleanQuery": "LinkedIn Recruiter boolean search string to find similar profiles",
  "searchSummary": "2 sentences: who we're looking for, based on the reference candidate"
}

RULES:
- The goal is SIMILAR candidates, not exact clones. Broaden slightly.
- If the reference is a Staff Engineer at a Tier-1 company, search for Staff/Senior at Tier-1 AND Scale-ups.
- booleanQuery should be practical and directly usable in LinkedIn Recruiter.
- Focus on the candidate's STRONGEST skills and domain, not everything they've ever done.
- Include both the reference candidate's exact title AND adjacent titles.`;
}

/**
 * Generate search criteria from raw CV text (look-alike without prior fingerprint).
 */
export function buildSearchCriteriaFromCVPrompt(cvText: string): string {
  return `You are a Senior Technical Recruiter. A recruiter wants to find candidates similar to the person described in this CV. Analyze the CV and generate search criteria.

CV:
${cvText}

Generate search criteria to find SIMILAR candidates. Respond in valid JSON only:

{
  "targetTitles": ["max 5 — titles similar candidates would hold"],
  "requiredSkills": ["max 8 — core skills that define this profile type"],
  "preferredSkills": ["max 6 — additional skills for stronger match"],
  "domains": ["max 4 — target domains"],
  "seniorityRange": ["comparable seniority levels"],
  "experienceRange": { "min": 8, "max": 20 },
  "companyTierPreference": ["target company tiers"],
  "locationPreference": "based on CV or 'Any'",
  "industries": ["target industries"],
  "booleanQuery": "LinkedIn Recruiter boolean search string",
  "searchSummary": "2 sentences: the profile type we are searching for"
}

RULES:
- Broaden slightly beyond the exact profile — we want similar, not identical.
- booleanQuery must be directly usable in LinkedIn Recruiter.
- Focus on the strongest 3-4 skill clusters, not every keyword.`;
}
