// ============================================================
// Legacy smoke suite — engine/analyzer (quality-gate, Wave 0)
// Pins the response-parsing path with canned Claude JSON.
// fetch is mocked — NO real API calls, ever (gate G2).
// window.location.hostname is 'localhost' => proxy mode.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobDescription, Candidate, CandidateAnalysis } from '../types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('window', {
  location: { hostname: 'localhost', origin: 'http://localhost:3000' },
});

const analyzer = await import('./analyzer');

const syntheticJob: JobDescription = {
  id: 'job-1',
  title: 'Synthetic Backend Role',
  rawText: 'Synthetic JD.',
  pillars: [
    { name: 'Backend', description: 'APIs', weight: 'CRITICAL', keywords: ['node'] },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const syntheticCandidate: Candidate = {
  id: 'cand-1',
  name: 'Synthetic Candidate',
  fileName: 'cv.txt',
  rawText: 'Synthetic CV text.',
  uploadedAt: '2026-01-01T00:00:00.000Z',
};

/** Wrap a model answer in the proxy's Claude response envelope */
function claudeEnvelope(text: string) {
  return { ok: true, json: async () => ({ content: [{ text }] }), text: async () => '' };
}

const fullModelAnswer = {
  profileSummary: 'Solid synthetic profile.',
  matchScore: 82,
  verdict: 'Strong Fit',
  pillarScores: [
    { pillarName: 'Backend', score: 8, evidence: 'built APIs', gap: 'none', riskLevel: 'LOW' },
  ],
  greenFlags: ['ships fast'],
  redFlags: ['short tenure'],
  autoRedFlags: [{ type: 'job_hopping', description: '3 jobs in 2 years', severity: 'warning' }],
  truthTestQuestions: [{ question: 'What did you build?', intent: 'verify depth' }],
  recruiterQuestions: [{ question: 'Salary range?', purpose: 'fit' }],
  recruiterNotes: { outreachAngle: 'growth', salaryEstimate: '30k', additionalNotes: 'n/a' },
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe('analyzeCandidate — response parsing (proxy mode, mocked fetch)', () => {
  it('calls the local proxy with model, tokens, prompt, and access-code header', async () => {
    fetchMock.mockResolvedValue(claudeEnvelope(JSON.stringify(fullModelAnswer)));
    await analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'synthetic-code', 'claude-sonnet-4-6');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/analyze');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Access-Code']).toBe('synthetic-code');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('Synthetic CV text.');
  });

  it('maps a full canned response into a CandidateAnalysis', async () => {
    const raw = JSON.stringify(fullModelAnswer);
    fetchMock.mockResolvedValue(claudeEnvelope(raw));
    const a: CandidateAnalysis = await analyzer.analyzeCandidate(
      syntheticJob, syntheticCandidate, 'code', 'model-x'
    );

    expect(a.candidateId).toBe('cand-1');
    expect(a.jobId).toBe('job-1');
    expect(a.candidateName).toBe('Synthetic Candidate');
    expect(a.jobTitle).toBe('Synthetic Backend Role');
    expect(a.profileSummary).toBe('Solid synthetic profile.');
    expect(a.matchScore).toBe(82);
    expect(a.verdict).toBe('Strong Fit');
    expect(a.pillarScores).toEqual(fullModelAnswer.pillarScores);
    expect(a.greenFlags).toEqual(['ships fast']);
    expect(a.redFlags).toEqual(['short tenure']);
    expect(a.autoRedFlags).toEqual(fullModelAnswer.autoRedFlags);
    expect(a.truthTestQuestions).toEqual(fullModelAnswer.truthTestQuestions);
    expect(a.recruiterQuestions).toEqual(fullModelAnswer.recruiterQuestions);
    expect(a.recruiterNotes).toEqual(fullModelAnswer.recruiterNotes);
    expect(a.recruiterComment).toBe('');
    expect(a.rawResponse).toBe(raw);
    expect(a.id).toBeTruthy();
    expect(() => new Date(a.timestamp).toISOString()).not.toThrow();
  });

  it('strips markdown ```json fences before parsing', async () => {
    fetchMock.mockResolvedValue(
      claudeEnvelope('```json\n' + JSON.stringify(fullModelAnswer) + '\n```')
    );
    const a = await analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm');
    expect(a.matchScore).toBe(82);
    expect(a.verdict).toBe('Strong Fit');
  });

  it('strips bare ``` fences too', async () => {
    fetchMock.mockResolvedValue(
      claudeEnvelope('```\n' + JSON.stringify(fullModelAnswer) + '\n```')
    );
    const a = await analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm');
    expect(a.profileSummary).toBe('Solid synthetic profile.');
  });

  it('clamps matchScore into 0–100', async () => {
    fetchMock.mockResolvedValue(claudeEnvelope(JSON.stringify({ ...fullModelAnswer, matchScore: 250 })));
    expect((await analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm')).matchScore).toBe(100);

    fetchMock.mockResolvedValue(claudeEnvelope(JSON.stringify({ ...fullModelAnswer, matchScore: -12 })));
    expect((await analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm')).matchScore).toBe(0);
  });

  it('fills safe defaults when the model omits fields (empty object response)', async () => {
    fetchMock.mockResolvedValue(claudeEnvelope('{}'));
    const a = await analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm');
    expect(a.profileSummary).toBe('');
    expect(a.matchScore).toBe(0);
    expect(a.verdict).toBe('Reject'); // missing verdict defaults to Reject
    expect(a.pillarScores).toEqual([]);
    expect(a.greenFlags).toEqual([]);
    expect(a.redFlags).toEqual([]);
    expect(a.autoRedFlags).toEqual([]);
    expect(a.truthTestQuestions).toEqual([]);
    expect(a.recruiterQuestions).toEqual([]);
    expect(a.recruiterNotes).toEqual({ outreachAngle: '', salaryEstimate: '', additionalNotes: '' });
    expect(a.rawResponse).toBe('{}');
  });

  it('propagates a SyntaxError when the model returns non-JSON', async () => {
    fetchMock.mockResolvedValue(claudeEnvelope('Sorry, I cannot produce JSON today.'));
    await expect(
      analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm')
    ).rejects.toThrow(SyntaxError);
  });

  it('throws API Error with status on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    await expect(
      analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm')
    ).rejects.toThrow('API Error (429): rate limited');
  });

  it('throws on an empty content array', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: [] }) });
    await expect(
      analyzer.analyzeCandidate(syntheticJob, syntheticCandidate, 'c', 'm')
    ).rejects.toThrow('Empty response from API');
  });
});

describe('extractPillars', () => {
  it('parses jobTitle + pillars from a canned response, using 2048 max tokens', async () => {
    const answer = {
      jobTitle: 'Synthetic QA Lead',
      pillars: [
        { name: 'Automation', description: 'e2e', weight: 'CRITICAL', keywords: ['playwright'] },
      ],
    };
    fetchMock.mockResolvedValue(claudeEnvelope(JSON.stringify(answer)));

    const result = await analyzer.extractPillars('Synthetic JD text', 'synthetic-code', 'model-x');
    expect(result).toEqual(answer);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(2048);
    expect(body.messages[0].content).toContain('Synthetic JD text');
  });
});

describe('createLogEntry', () => {
  it('derives the one-line summary and copies identity fields', () => {
    const analysis: CandidateAnalysis = {
      id: 'an-9',
      candidateId: 'cand-9',
      jobId: 'job-9',
      candidateName: 'Synthetic Person',
      jobTitle: 'Synthetic Role',
      timestamp: '2026-03-01T10:00:00.000Z',
      profileSummary: '',
      matchScore: 77,
      verdict: 'Potential',
      pillarScores: [],
      greenFlags: [],
      redFlags: [],
      autoRedFlags: [],
      truthTestQuestions: [],
      recruiterQuestions: [],
      recruiterNotes: { outreachAngle: '', salaryEstimate: '', additionalNotes: '' },
      recruiterComment: '',
      rawResponse: '{}',
    };
    expect(analyzer.createLogEntry(analysis)).toEqual({
      id: 'an-9',
      jobId: 'job-9',
      jobTitle: 'Synthetic Role',
      candidateName: 'Synthetic Person',
      matchScore: 77,
      verdict: 'Potential',
      timestamp: '2026-03-01T10:00:00.000Z',
      summary: 'Synthetic Person → Synthetic Role: 77% (Potential)',
    });
  });
});
