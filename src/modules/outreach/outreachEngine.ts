import type { CandidateAnalysis } from '../../types';
import type { OutreachDraft, OutreachTone } from './outreachTypes';
import { buildOutreachPrompt } from './outreachPrompts';

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
  maxTokens: number = 2048
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

export async function generateOutreach(
  analysis: CandidateAnalysis,
  tone: OutreachTone,
  companyContext: string,
  apiKey: string,
  model: string
): Promise<OutreachDraft> {
  const prompt = buildOutreachPrompt(
    analysis.candidateName,
    analysis.jobTitle,
    analysis.profileSummary,
    analysis.greenFlags,
    analysis.matchScore,
    analysis.verdict,
    tone,
    companyContext
  );

  const response = await callClaude(apiKey, model, prompt, 2048);
  const parsed = parseJSON<{ firstMessage: string; followUpMessage: string }>(response);

  return {
    id: generateId(),
    analysisId: analysis.id,
    candidateName: analysis.candidateName,
    jobTitle: analysis.jobTitle,
    firstMessage: parsed.firstMessage || '',
    followUpMessage: parsed.followUpMessage || '',
    tone,
    companyContext,
    timestamp: new Date().toISOString(),
  };
}
