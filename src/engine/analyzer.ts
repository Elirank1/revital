// ============================================================
// Core Analysis Engine
// Orchestrates: JD parsing → Pillar extraction → CV analysis
// Supports two modes:
//   1. Proxy mode (Vercel) — API key on server, user provides access code
//   2. Direct mode — user provides their own API key
// ============================================================

import type {
  JobDescription,
  Candidate,
  CandidateAnalysis,
  EvaluationPillar,
  AnalysisLog,
} from '../types';
import { buildPillarExtractionPrompt, buildAnalysisPrompt } from './prompts';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Detect if we're running on Vercel (proxy available)
 * or on GitHub Pages (direct API calls only)
 */
function getApiMode(): 'proxy' | 'direct' {
  // If /api/analyze endpoint exists (Vercel), use proxy
  // On GitHub Pages, this won't exist
  return window.location.hostname.includes('vercel.app') ||
    window.location.hostname === 'localhost'
    ? 'proxy'
    : 'direct';
}

/**
 * Call Claude via the Vercel proxy
 */
async function callClaudeProxy(
  accessCode: string,
  model: string,
  prompt: string,
  maxTokens: number = 4096
): Promise<string> {
  const baseUrl = window.location.origin;
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Code': accessCode,
    },
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

/**
 * Call Claude directly (user provides their own key)
 */
async function callClaudeDirect(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number = 4096
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
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

/**
 * Universal call — picks the right mode automatically
 * apiKeyOrCode: either an API key (direct) or access code (proxy)
 */
async function callClaude(
  apiKeyOrCode: string,
  model: string,
  prompt: string,
  maxTokens: number = 4096
): Promise<string> {
  const mode = getApiMode();
  if (mode === 'proxy') {
    return callClaudeProxy(apiKeyOrCode, model, prompt, maxTokens);
  }
  return callClaudeDirect(apiKeyOrCode, model, prompt, maxTokens);
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
function parseJSON<T>(text: string): T {
  // Strip markdown code blocks if present
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(clean);
}

/**
 * Step 1: Extract evaluation pillars from JD
 */
export async function extractPillars(
  jdText: string,
  apiKey: string,
  model: string
): Promise<{ jobTitle: string; pillars: EvaluationPillar[] }> {
  const prompt = buildPillarExtractionPrompt(jdText);
  const response = await callClaude(apiKey, model, prompt, 2048);
  return parseJSON(response);
}

/**
 * Step 2: Analyze a single candidate against a job
 */
export async function analyzeCandidate(
  job: JobDescription,
  candidate: Candidate,
  apiKey: string,
  model: string
): Promise<CandidateAnalysis> {
  const prompt = buildAnalysisPrompt(job, candidate.rawText, candidate.linkedinUrl);
  const response = await callClaude(apiKey, model, prompt, 4096);
  const parsed = parseJSON<any>(response);

  const analysis: CandidateAnalysis = {
    id: generateId(),
    candidateId: candidate.id,
    jobId: job.id,
    candidateName: candidate.name,
    jobTitle: job.title,
    timestamp: new Date().toISOString(),
    profileSummary: parsed.profileSummary || '',
    matchScore: Math.min(100, Math.max(0, parsed.matchScore || 0)),
    verdict: parsed.verdict || 'Reject',
    pillarScores: parsed.pillarScores || [],
    greenFlags: parsed.greenFlags || [],
    redFlags: parsed.redFlags || [],
    autoRedFlags: parsed.autoRedFlags || [],
    truthTestQuestions: parsed.truthTestQuestions || [],
    recruiterNotes: parsed.recruiterNotes || {
      outreachAngle: '',
      salaryEstimate: '',
      additionalNotes: '',
    },
    rawResponse: response,
  };

  return analysis;
}

/**
 * Check if the proxy is available
 */
export async function checkProxyAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${window.location.origin}/api/analyze`, {
      method: 'OPTIONS',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create a log entry from an analysis
 */
export function createLogEntry(analysis: CandidateAnalysis): AnalysisLog {
  return {
    id: analysis.id,
    jobTitle: analysis.jobTitle,
    candidateName: analysis.candidateName,
    matchScore: analysis.matchScore,
    verdict: analysis.verdict,
    timestamp: analysis.timestamp,
    summary: `${analysis.candidateName} → ${analysis.jobTitle}: ${analysis.matchScore}% (${analysis.verdict})`,
  };
}
