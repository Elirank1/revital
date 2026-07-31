// ============================================================
// Fingerprint & Search Criteria Engine
// Orchestrates extraction and search criteria generation
// ============================================================

import type { JobDescription, Candidate } from '../../types';
import type { CandidateFingerprint, SearchCriteria } from './fingerprintTypes';
import {
  buildFingerprintPrompt,
  buildSearchCriteriaFromJDPrompt,
  buildSearchCriteriaFromFingerprintPrompt,
  buildSearchCriteriaFromCVPrompt,
} from './fingerprintPrompts';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseJSON<T>(text: string): T {
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(clean);
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

  const url =
    mode === 'proxy'
      ? `${window.location.origin}/api/analyze`
      : 'https://api.anthropic.com/v1/messages';

  const headers: Record<string, string> =
    mode === 'proxy'
      ? {
          'Content-Type': 'application/json',
          'X-Access-Code': apiKeyOrCode,
        }
      : {
          'Content-Type': 'application/json',
          'x-api-key': apiKeyOrCode,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
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

// ============================================================
// Public API
// ============================================================

/**
 * Extract a fingerprint from a candidate's CV/profile.
 */
export async function extractFingerprint(
  candidate: Candidate,
  apiKey: string,
  model: string,
  analysisId?: string
): Promise<CandidateFingerprint> {
  const prompt = buildFingerprintPrompt(candidate.rawText, candidate.linkedinUrl);
  const response = await callClaude(apiKey, model, prompt);
  const parsed = parseJSON<any>(response);

  return {
    id: generateId(),
    candidateId: candidate.id,
    analysisId,
    candidateName: candidate.name,
    timestamp: new Date().toISOString(),
    sourceType: candidate.linkedinUrl ? 'linkedin' : 'cv',
    linkedinUrl: candidate.linkedinUrl,

    currentTitle: parsed.currentTitle || '',
    seniorityLevel: parsed.seniorityLevel || 'Mid',
    totalYearsExperience: parsed.totalYearsExperience || 0,

    primarySkills: parsed.primarySkills || [],
    secondarySkills: parsed.secondarySkills || [],
    tools: parsed.tools || [],
    languages: parsed.languages || [],

    domains: parsed.domains || [],
    industries: parsed.industries || [],

    companyTier: parsed.companyTier || 'Mixed',
    companyNames: parsed.companyNames || [],
    teamSize: parsed.teamSize || 'Unknown',

    trajectoryPattern: parsed.trajectoryPattern || '',
    tenurePattern: parsed.tenurePattern || 'Mixed',
    careerArc: parsed.careerArc || 'Stable senior',

    location: parsed.location || 'Unknown',
    remotePreference: parsed.remotePreference || 'Unknown',

    educationLevel: parsed.educationLevel || 'Unknown',
    educationField: parsed.educationField || '',
  };
}

/**
 * Generate search criteria from a Job Description.
 */
export async function generateSearchFromJD(
  job: JobDescription,
  apiKey: string,
  model: string
): Promise<SearchCriteria> {
  const prompt = buildSearchCriteriaFromJDPrompt(job);
  const response = await callClaude(apiKey, model, prompt);
  const parsed = parseJSON<any>(response);

  return {
    id: generateId(),
    sourceType: 'jd',
    sourceId: job.id,
    sourceName: job.title,
    timestamp: new Date().toISOString(),

    targetTitles: parsed.targetTitles || [],
    requiredSkills: parsed.requiredSkills || [],
    preferredSkills: parsed.preferredSkills || [],
    domains: parsed.domains || [],
    seniorityRange: parsed.seniorityRange || [],
    experienceRange: parsed.experienceRange || { min: 0, max: 30 },

    companyTierPreference: parsed.companyTierPreference || [],
    locationPreference: parsed.locationPreference || 'Any',
    industries: parsed.industries || [],

    booleanQuery: parsed.booleanQuery || '',
    searchSummary: parsed.searchSummary || '',
  };
}

/**
 * Generate search criteria from an existing fingerprint (look-alike).
 */
export async function generateSearchFromFingerprint(
  fingerprint: CandidateFingerprint,
  apiKey: string,
  model: string
): Promise<SearchCriteria> {
  const fpJson = JSON.stringify(fingerprint, null, 2);
  const prompt = buildSearchCriteriaFromFingerprintPrompt(fpJson, fingerprint.candidateName);
  const response = await callClaude(apiKey, model, prompt);
  const parsed = parseJSON<any>(response);

  return {
    id: generateId(),
    sourceType: 'fingerprint',
    sourceId: fingerprint.id,
    sourceName: `Similar to ${fingerprint.candidateName}`,
    timestamp: new Date().toISOString(),

    targetTitles: parsed.targetTitles || [],
    requiredSkills: parsed.requiredSkills || [],
    preferredSkills: parsed.preferredSkills || [],
    domains: parsed.domains || [],
    seniorityRange: parsed.seniorityRange || [],
    experienceRange: parsed.experienceRange || { min: 0, max: 30 },

    companyTierPreference: parsed.companyTierPreference || [],
    locationPreference: parsed.locationPreference || 'Any',
    industries: parsed.industries || [],

    booleanQuery: parsed.booleanQuery || '',
    searchSummary: parsed.searchSummary || '',
  };
}

/**
 * Generate search criteria from raw CV text (no prior fingerprint needed).
 */
export async function generateSearchFromCV(
  cvText: string,
  candidateName: string,
  candidateId: string,
  apiKey: string,
  model: string
): Promise<SearchCriteria> {
  const prompt = buildSearchCriteriaFromCVPrompt(cvText);
  const response = await callClaude(apiKey, model, prompt);
  const parsed = parseJSON<any>(response);

  return {
    id: generateId(),
    sourceType: 'cv',
    sourceId: candidateId,
    sourceName: `Similar to ${candidateName}`,
    timestamp: new Date().toISOString(),

    targetTitles: parsed.targetTitles || [],
    requiredSkills: parsed.requiredSkills || [],
    preferredSkills: parsed.preferredSkills || [],
    domains: parsed.domains || [],
    seniorityRange: parsed.seniorityRange || [],
    experienceRange: parsed.experienceRange || { min: 0, max: 30 },

    companyTierPreference: parsed.companyTierPreference || [],
    locationPreference: parsed.locationPreference || 'Any',
    industries: parsed.industries || [],

    booleanQuery: parsed.booleanQuery || '',
    searchSummary: parsed.searchSummary || '',
  };
}
