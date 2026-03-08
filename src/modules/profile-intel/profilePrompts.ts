import type { EvaluationPillar } from '../../types';

export function buildProfileIntelPrompt(
  profileText: string,
  jobTitle: string,
  pillars: EvaluationPillar[]
): string {
  const pillarBlock = pillars
    .map((p, i) => `${i + 1}. ${p.name} [${p.weight}]`)
    .join('\n');

  return `You are a senior recruiting strategist analyzing a LinkedIn profile for career intelligence. This is NOT a match score — that's already done. Your job is to understand WHO this person is professionally and provide actionable recruiting insights.

ROLE WE'RE HIRING FOR: ${jobTitle}

KEY PILLARS:
${pillarBlock}

LINKEDIN PROFILE:
${profileText}

Generate career intelligence. Respond in valid JSON only:
{
  "careerArc": "One sentence synthesizing their full career trajectory. e.g., 'Rising through IC track at enterprise companies with a pivot to AI in the last 3 years'",
  "seniorityProgression": "Concise progression. e.g., 'IC → Senior → Staff in 8 years' or 'Manager track, consistent promotion every 2-3 years'",
  "companyPattern": "What kind of companies they've worked at. e.g., 'Tier-1 enterprise, long tenure' or 'Startup-hopper, seed to Series B'",
  "domainExpertise": ["3-5 domain areas. e.g., 'payments', 'ML infrastructure', 'distributed systems'"],
  "likelyMotivations": ["2-4 inferred motivations based on career moves. e.g., 'seeking technical leadership', 'wants smaller company impact'. Mark all as probabilistic."],
  "openToChange": "likely | possible | unlikely | unknown",
  "openToChangeReasoning": "Why you assessed their openness this way. Be conservative — use 'unknown' unless there are real signals like short recent tenure, role changes, or profile activity.",
  "locationConfidence": "How confident we are about their location and flexibility. e.g., 'High — consistent Bay Area for 10+ years' or 'Medium — recent relocation suggests flexibility'",
  "salaryBand": "Estimated total comp range based on seniority + company tier + location. e.g., 'Senior Staff at Tier-1: $350-450K TC'",
  "noticeRisk": "Assessment of how hard they might be to recruit. e.g., 'Long tenure suggests strong retention — may need compelling pitch' or 'Recent move — likely still evaluating options'",
  "bestApproachAngle": "Specific to THIS person. What would make them take a call? Lead with what? e.g., 'Lead with the technical challenge of building from zero, not comp'",
  "thingsToVerify": ["2-4 things a recruiter should ask on the first call to validate assumptions. e.g., 'hands-on coding frequency', 'team size preference', 'geographic flexibility'"]
}

RULES:
- ALL inferences must use probabilistic language: "likely", "suggests", "pattern indicates"
- Do NOT make generic statements. Every insight must be specific to this person's actual profile data.
- If the data is insufficient to make an inference, say so explicitly rather than guessing.
- Career intelligence is about patterns and trajectory, not keyword matching.`;
}
