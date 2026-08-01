import type { EvaluationPillar } from '../../types';

export function buildProfileIntelPrompt(
  profileText: string,
  jobTitle: string,
  pillars: EvaluationPillar[]
): string {
  const pillarContext = pillars
    .map((p) => `- ${p.name} (${p.weight}): ${p.description}`)
    .join('\n');

  return `You are a senior recruiter intelligence analyst. Given a candidate's profile and a target role, produce a deep profile intelligence report.

TARGET ROLE: ${jobTitle}

EVALUATION PILLARS:
${pillarContext}

CANDIDATE PROFILE:
${profileText}

Analyze the candidate's profile and return a JSON object with:

1. "careerArc" (string): Describe the candidate's career trajectory in 2-3 sentences. What pattern do you see?
2. "seniorityProgression" (string): How has their seniority evolved? Fast climber, steady, lateral moves, or stagnant?
3. "companyPattern" (string): What types of companies have they worked at? Startups, scale-ups, enterprise, consulting? Any pattern?
4. "domainExpertise" (string[]): List 3-6 specific domains they have deep expertise in.
5. "likelyMotivations" (string[]): Based on their career pattern, what likely motivates them? List 3-5 motivations.
6. "openToChange" ("likely" | "possible" | "unlikely" | "unknown"): How likely are they to be open to a new opportunity right now?
7. "openToChangeReasoning" (string): Why do you assess their openness to change this way? 1-2 sentences.
8. "locationConfidence" (string): What can you infer about their location and willingness to relocate?
9. "salaryBand" (string): Based on their seniority, industry, and location, estimate a reasonable salary range.
10. "noticeRisk" (string): What risks should a recruiter be aware of? (e.g., likely in notice period, golden handcuffs, non-compete, etc.)
11. "bestApproachAngle" (string): What's the best way to approach this candidate? What would resonate with them given their career pattern?
12. "thingsToVerify" (string[]): List 3-5 things a recruiter should verify or dig deeper on during outreach or interview.

Be specific, not generic. Base every assessment on actual signals from the profile, not assumptions.

Return ONLY valid JSON, no markdown, no explanation.`;
}
