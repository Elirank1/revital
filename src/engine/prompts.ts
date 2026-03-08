import type { JobDescription, EvaluationPillar } from '../types';

// ============================================================
// Prompt: Extract pillars from a Job Description
// Max 5 pillars — focused, not diluted
// ============================================================
export function buildPillarExtractionPrompt(jdText: string): string {
  return `You are a Senior Technical Recruiter at a Tier-1 tech company. Analyze this job description and extract exactly 4-5 evaluation pillars for candidate screening.

RULES:
- Extract ONLY the 4-5 most important pillars. Fewer pillars = sharper evaluation.
- Each pillar should represent a DISTINCT capability area — no overlap.
- Weight reflects how critical the pillar is for this specific role.
- Keywords should include BOTH specific tools AND broader capability terms. A candidate at a large company may use internal equivalents of named tools — match on capability, not just tool names.

For each pillar, provide:
- name: short label (e.g., "Production AI at Scale", "Agentic Systems & LLM Ops")
- description: what to look for (1-2 sentences). Focus on demonstrated capability, not specific product names.
- weight: CRITICAL / HIGH / MEDIUM
- keywords: 4-6 terms mixing specific tools AND capability-level terms

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
// Calibrated for real-world recruiter scoring
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

  return `You are a Senior Technical Recruiting Expert screening candidates for a specific role. Provide a calibrated, evidence-based analysis.

ROLE: ${job.title}

EVALUATION PILLARS:
${pillarBlock}

CANDIDATE CV:
${cvText}
${linkedinUrl ? `\nLINKEDIN: ${linkedinUrl}` : ''}

CRITICAL SCORING CALIBRATION RULES — READ CAREFULLY:

1. SCORE CAPABILITY, NOT KEYWORD MATCHES.
   A candidate who "architected a RAG-based Co-Pilot with evaluation framework and DLP layer" has RAG experience — even if they don't name Pinecone or LangChain. Large companies (PayPal, Google, Meta, Amazon, Intuit, etc.) use internal tools. Never penalize for not naming specific open-source tools when the capability is clearly demonstrated.

2. CALIBRATE FOR SENIORITY.
   At Staff/Principal level in Tier-1 companies, the job IS architecture, technical direction, and cross-org leadership. This is NOT a red flag — it's the expected operating mode. "Hands-on" at Staff level means designing systems, reviewing code, mentoring teams, and building POCs — not writing production code daily.

3. COMPANY CONTEXT MATTERS.
   15 years at PayPal operating on their transaction pipeline = proven high-scale experience (billions of transactions). You don't need to see "microservices" written on the CV when the context makes it obvious. Read between the lines — the environment IS the evidence.

4. ADJACENT EXPERIENCE COUNTS.
   If the JD asks for "agentic AI" and the candidate built a Co-Pilot with RAG, model orchestration, and evaluation — that IS agentic-adjacent even if they didn't use the word "agent". Score based on transferable capability, not exact terminology.

5. CAREER TRAJECTORY IS SIGNAL.
   A clear progression (Engineer → Tech Lead → Architect → Senior Staff) at a single Tier-1 company for 15 years is an extremely strong signal of consistent high performance. Weight this heavily.

OUTPUT FORMAT — keep it concise. Respond in valid JSON only:
{
  "profileSummary": "2 sentences max. Who they are and why they matter for this role.",
  "matchScore": 85,
  "verdict": "Strong Fit | Potential | Reject",
  "pillarScores": [
    {
      "pillarName": "pillar name",
      "score": 8,
      "evidence": "1 sentence: specific CV evidence",
      "gap": "1 sentence: what's missing, or 'None' if no gap",
      "riskLevel": "HIGH (strong match, score 7+) | MEDIUM (partial, score 5-6) | LOW (weak, score 1-4)"
    }
  ],
  "greenFlags": ["max 4 items — strongest matches only"],
  "redFlags": ["max 3 items — real concerns only, not nitpicks"],
  "autoRedFlags": [
    {
      "type": "job_hopping | title_inflation | buzzword_padding | employment_gap | regression | overqualified",
      "description": "brief explanation",
      "severity": "warning | critical"
    }
  ],
  "truthTestQuestions": [
    {
      "question": "interview question as a recruiter would ask it",
      "intent": "what this verifies (keep short)"
    }
  ],
  "recruiterQuestions": [
    {
      "question": "screening question a senior recruiter would ask in a first call",
      "purpose": "what the recruiter is trying to assess (keep short)"
    }
  ],
  "recruiterNotes": {
    "outreachAngle": "1-2 sentences: best angle for reaching out",
    "salaryEstimate": "range based on seniority + market",
    "additionalNotes": "1 sentence max, or empty string"
  }
}

SCORING SCALE (be generous when evidence supports it):
- 9-10: Exceptional. Exceeds requirements with clear, strong evidence.
- 7-8: Strong match. Meets requirements with solid evidence, minor gaps at most.
- 5-6: Partial match. Some relevant experience but meaningful gaps.
- 3-4: Weak. Tangential experience only.
- 1-2: No relevant experience.

A candidate who checks MOST boxes for a pillar should score 7-8, not 5-6. Reserve 5-6 for genuinely partial matches. A 5 should feel like "maybe" — not like "solid but uses different tools."

VERDICT RULES:
- Strong Fit: matchScore >= 78 AND no CRITICAL pillar below 6
- Potential: matchScore >= 55 AND no CRITICAL pillar below 4
- Reject: below Potential thresholds

MAX OUTPUT SIZES — be concise:
- truthTestQuestions: exactly 3 (not more)
- recruiterQuestions: exactly 3 — practical screening questions a senior recruiter would ask on a first phone call (motivation, availability, compensation expectations, culture fit, relocation, etc.)
- greenFlags: max 4
- redFlags: max 3
- autoRedFlags: only include if genuinely concerning. Do NOT flag "buzzword_padding" for senior engineers who describe architecture-level work. Do NOT flag "limited_scope" for Staff-level engineers doing architecture and POCs at Tier-1 companies.

RED FLAG RULES — only flag if genuinely concerning:
- job_hopping: 3+ roles with < 1.5 years each (rotation programs at same company do NOT count)
- title_inflation: senior titles at tiny/unknown companies without substance
- buzzword_padding: ONLY if technologies are listed with zero evidence of use anywhere in the CV
- employment_gap: unexplained gaps > 12 months
- regression: moved from senior to significantly junior roles without explanation`;
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
