import type { EvaluationPillar } from '../../types';
import type { InterviewSummaryData } from './interviewTypes';
import { buildInterviewSummaryPrompt } from './interviewPrompts';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getApiMode(): 'proxy' | 'direct' {
  return window.location.hostname.includes('vercel.app') ||
    window.location.hostname === 'localhost'
    ? 'proxy'
    : 'direct';
}

async function callClaude(
  apiKeyOrCode: string,
  model: string,
  prompt: string,
  maxTokens: number = 4096
): Promise<string> {
  const mode = getApiMode();

  const url = mode === 'proxy'
    ? `${window.location.origin}/api/analyze`
    : 'https://api.anthropic.com/v1/messages';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(mode === 'proxy'
      ? { 'X-Access-Code': apiKeyOrCode }
      : {
          'x-api-key': apiKeyOrCode,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API Error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Empty response from API');
  return text;
}

function parseJSON<T>(text: string): T {
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(clean);
}

export async function generateInterviewSummary(
  transcript: string,
  candidateName: string,
  jobTitle: string,
  pillars: EvaluationPillar[],
  analysisContext: string,
  analysisId: string,
  apiKey: string,
  model: string
): Promise<InterviewSummaryData> {
  const prompt = buildInterviewSummaryPrompt(
    transcript,
    candidateName,
    jobTitle,
    pillars,
    analysisContext
  );

  const response = await callClaude(apiKey, model, prompt, 4096);
  const parsed = parseJSON<any>(response);

  return {
    id: generateId(),
    analysisId,
    candidateName,
    jobTitle,
    timestamp: new Date().toISOString(),
    overview: parsed.overview || '',
    strengths: parsed.strengths || [],
    concerns: parsed.concerns || [],
    openQuestions: parsed.openQuestions || [],
    recommendation: parsed.recommendation || '',
    cultureFit: parsed.cultureFit || '',
    managerSummary: parsed.managerSummary || '',
    rawTranscript: transcript,
  };
}
