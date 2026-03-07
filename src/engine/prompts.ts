import type { JobDescription, EvaluationPillar } from '../types';

// ============================================================
// Prompt: Extract pillars from a Job Description
// ============================================================
export function buildPillarExtractionPrompt(jdText: string): string {
  return `You are a Senior Technical Recruiter. Analyze this job description and extract 5-7 evaluation pillars that should be used to screen candidates.

For each pillar, provide:
- name: short label (e.g., "Agentic AI Mastery", "High Scale Backend")
- description: what specifically to look for (1-2 sentences)
- weight: CRITICAL / HIGH / MEDIUM / LOW
- keywords: 3-5 technical keywords to search for in CVs

Respond in valid JSON only. No markdown, no explanation. Format:
{
  "jobTitle": "extracted job title",
  "pillars": [
    {
      "name": "...",
      "description": "...",
      "weight": "HIGH",
      "keywords": ["...", "..."]
    }
  ]
}

JOB DESCRIPTION:
${jdText}`;
}

// ============================================================
// Prompt: Full candidate analysis
// ============================================================
export function buildAnalysisPrompt(
  job: JobDescription,
  cvText: string,
  linkedinUrl?: string
): string {
  const pillarBlock = job.pillars
    .map(
      (p: EvaluationPillar, i: number) =>
        `${i + 1}. ${p.name} [${p.weight}]: ${p.description}\n   Keywords: ${p.keywords.join(', ')}`
    )
    .join('\n');

  return `You are a Senior Technical Recruiting Expert. Your goal is to provide a rigorous, data-driven analysis of a candidate's fit for a specific role.

ROLE: ${job.title}

EVALUATION PILLARS (use these to score the candidate):
${pillarBlock}

CANDIDATE CV:
${cvText}
${linkedinUrl ? `\nLINKEDIN: ${linkedinUrl}` : ''}

INSTRUCTIONS:
Analyze the candidate against each pillar. Be analytical and direct. No sugar-coating.

Respond in valid JSON only. No markdown wrapping. Format:

{
  "profileSummary": "2-3 sentence high-level summary of background and seniority",
  "matchScore": 72,
  "verdict": "Strong Fit | Potential | Reject",
  "pillarScores": [
    {
      "pillarName": "pillar name from above",
      "score": 8,
      "evidence": "specific evidence from CV supporting this score",
      "gap": "what's missing or weak",
      "riskLevel": "LOW | MEDIUM | HIGH"
    }
  ],
  "greenFlags": [
    "specific strength that directly matches the role"
  ],
  "redFlags": [
    "specific concern or gap"
  ],
  "autoRedFlags": [
    {
      "type": "job_hopping | title_inflation | buzzword_padding | employment_gap | regression | overqualified | limited_scope",
      "description": "explanation",
      "severity": "warning | critical"
    }
  ],
  "truthTestQuestions": [
    {
      "question": "interview question phrased as a recruiter would ask",
      "intent": "what this question verifies"
    }
  ],
  "recruiterNotes": {
    "outreachAngle": "best angle to approach this candidate",
    "salaryEstimate": "estimated range based on seniority and market",
    "additionalNotes": "any other observations"
  }
}

SCORING GUIDELINES:
- 9-10: Exceptional match, clear evidence, exceeds requirements
- 7-8: Strong match with minor gaps
- 5-6: Partial match, significant gaps but potential
- 3-4: Weak match, major gaps
- 1-2: No relevant experience

VERDICT RULES:
- Strong Fit: matchScore >= 80 AND no pillar below 5
- Potential: matchScore >= 55 AND no CRITICAL pillar below 4
- Reject: below Potential thresholds

RED FLAG AUTO-DETECTION (check for these regardless of pillars):
- job_hopping: 3+ roles with < 1.5 years each
- title_inflation: senior titles at very small/unknown companies without evidence
- buzzword_padding: lists many technologies without evidence of depth
- employment_gap: unexplained gaps > 6 months
- regression: moved from senior to junior roles
- overqualified: significantly above role requirements
- limited_scope: only POCs/prototypes, no production systems`;
}

// ============================================================
// Prompt: JD Quality Check
// ============================================================
export function buildJDQualityPrompt(jdText: string): string {
  return `You are a recruiting expert. Evaluate this job description for quality and screening effectiveness.

JD:
${jdText}

Respond in valid JSON:
{
  "score": 7,
  "strengths": ["what's good about this JD"],
  "weaknesses": ["what's vague or problematic"],
  "suggestions": ["specific improvements"],
  "isUnicornWishlist": false,
  "unicornNote": "if true, explain what's unrealistic"
}`;
}
