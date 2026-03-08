import type { OutreachTone } from './outreachTypes';

export function buildOutreachPrompt(
  candidateName: string,
  jobTitle: string,
  profileSummary: string,
  greenFlags: string[],
  matchScore: number,
  verdict: string,
  tone: OutreachTone,
  companyContext: string
): string {
  const toneGuide: Record<OutreachTone, string> = {
    professional: 'Polished and formal. Respectful of seniority. Clear value proposition.',
    warm: 'Friendly, genuine, conversational. Like a trusted contact reaching out. Light but not casual.',
    direct: 'Get to the point fast. Lead with the opportunity. No fluff. Respect their time.',
    consultative: 'Position yourself as understanding their career. Ask a thoughtful question. Frame the role as a natural next step.',
  };

  return `You are a senior technical recruiter crafting a personalized outreach message. Write as a real human — not a bot, not a template.

CANDIDATE: ${candidateName}
ROLE: ${jobTitle}
MATCH SCORE: ${matchScore}% (${verdict})
PROFILE SUMMARY: ${profileSummary}
STRENGTHS: ${greenFlags.join('; ')}

HIRING COMPANY CONTEXT:
${companyContext || 'Not provided — keep the message focused on the candidate and role.'}

TONE: ${tone}
${toneGuide[tone]}

Generate two messages. Respond in valid JSON only:
{
  "firstMessage": "LinkedIn InMail or message. 3-5 sentences. Personalized to THIS person — reference something specific from their profile. ${tone === 'consultative' ? 'End with a thoughtful question.' : 'End with a clear call to action.'}",
  "followUpMessage": "Follow-up if no response after 5-7 days. 2-3 sentences. Different angle than the first message. Lighter touch."
}

RULES:
- Reference specific things from the candidate's profile. Generic = trash.
- Never mention the match score or that they were "analyzed"
- Never use phrases like "I came across your profile" or "I was impressed by your background"
- Keep first message under 150 words
- Keep follow-up under 80 words
- Sound like a real person, not a recruiting automation tool`;
}
