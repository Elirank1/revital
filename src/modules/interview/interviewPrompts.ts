import type { EvaluationPillar } from '../../types';

export function buildInterviewSummaryPrompt(
  transcript: string,
  candidateName: string,
  jobTitle: string,
  pillars: EvaluationPillar[],
  analysisContext: string
): string {
  const pillarBlock = pillars
    .map((p, i) => `${i + 1}. ${p.name} [${p.weight}]: ${p.description}`)
    .join('\n');

  return `You are a senior recruiter writing a structured interview summary. Be factual, specific, and actionable.

CANDIDATE: ${candidateName}
ROLE: ${jobTitle}

EVALUATION PILLARS FOR THIS ROLE:
${pillarBlock}

${analysisContext ? `PRIOR ANALYSIS CONTEXT:\n${analysisContext}\n` : ''}
INTERVIEW TRANSCRIPT:
${transcript}

Generate a structured summary. Respond in valid JSON only:
{
  "overview": "2-3 sentences. Who is this person and what was the overall impression from the conversation. Factual, not generic.",
  "strengths": ["Max 5 bullet points. Specific evidence from the conversation. Quote or reference what was said."],
  "concerns": ["Max 4 bullet points. Real concerns only — things that were unclear, contradictory, or missing. Don't manufacture issues."],
  "openQuestions": ["Max 3. Things that weren't covered or remain ambiguous after the conversation."],
  "recommendation": "1-2 sentences. Clear and actionable. 'Advance to next round because...' or 'Pass because...' or 'Needs a follow-up call to clarify...'",
  "cultureFit": "1-2 sentences. Based on communication style, motivations, and values expressed in the conversation. Not generic personality labels.",
  "managerSummary": "5-8 sentences MAX. Written as if forwarding to the hiring manager. Professional, concise. Format: 'I spoke with [name] about the [role] position. [key findings]. [recommendation].' Should work copy-pasted into WhatsApp or email. No bullet points, no headers — just flowing text."
}

RULES:
- Every point in strengths/concerns must reference something specific from the transcript
- The manager summary is the MOST IMPORTANT output — it needs to be polished and ready to send
- Don't repeat the same information across sections
- Be honest. If the interview was weak, say so clearly.`;
}
