import { describe, expect, it, vi } from 'vitest';
import type { JobDescription } from '../types';
import { buildMandateReport } from './mandateReport';
import { polishWithClaude } from './polish';

// ------------------------------------------------------------
// Fixture — a small real report; ALL fetches in this file are mocks.
// ------------------------------------------------------------

const NOW = new Date('2026-07-31T12:00:00.000Z');

const mandate: JobDescription = {
  id: 'job-1',
  title: 'Senior Backend Engineer',
  rawText: '',
  pillars: [],
  createdAt: '2026-07-01T00:00:00.000Z',
};

function makeReport() {
  return buildMandateReport(mandate, [], [], [], { now: NOW });
}

function okResponse(text: string | undefined): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: text === undefined ? [] : [{ text }] }),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

// ------------------------------------------------------------
// Default OFF — the binding rail
// ------------------------------------------------------------

describe('polishWithClaude — default OFF', () => {
  it('without opts: returns the report unchanged and performs no I/O', async () => {
    const report = makeReport();
    const result = await polishWithClaude(report);
    expect(result.polished).toBe(false);
    expect(result.report).toBe(report);
  });

  it('enabled undefined/false/truthy-but-not-true: injected fetch is NEVER called', async () => {
    const report = makeReport();
    const fetchImpl = vi.fn();
    for (const enabled of [undefined, false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
      const result = await polishWithClaude(report, {
        enabled,
        accessCode: 'code-1',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.polished).toBe(false);
      expect(result.report).toBe(report);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enabled but no injected fetch: refuses (no global-fetch fallback)', async () => {
    const report = makeReport();
    const result = await polishWithClaude(report, { enabled: true, accessCode: 'code-1' });
    expect(result.polished).toBe(false);
    expect(result.error).toContain('fetchImpl');
    expect(result.report).toBe(report);
  });

  it('enabled but no access code: refuses without calling fetch (spend-cap accounting)', async () => {
    const report = makeReport();
    const fetchImpl = vi.fn();
    const result = await polishWithClaude(report, {
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.polished).toBe(false);
    expect(result.error).toContain('accessCode');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// Enabled path (mocked transport only)
// ------------------------------------------------------------

describe('polishWithClaude — enabled with mocked fetch', () => {
  it('calls the existing /api/analyze proxy with the exact contract shape', async () => {
    const report = makeReport();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('טקסט מלוטש'));
    await polishWithClaude(report, {
      enabled: true,
      accessCode: 'code-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/analyze');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Access-Code': 'code-1',
    });
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(2048);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain(report.text);
    expect(body.messages[0].content).toContain('אל תשנה שום עובדה');
  });

  it('honors baseUrl/model/maxTokens overrides', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('ok'));
    await polishWithClaude(makeReport(), {
      enabled: true,
      accessCode: 'code-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: 'https://revital.example',
      model: 'claude-haiku-4-5',
      maxTokens: 512,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://revital.example/api/analyze');
    const body = JSON.parse(init.body as string) as { model: string; max_tokens: number };
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.max_tokens).toBe(512);
  });

  it('on success: replaces text + suggestion body ONLY — html, lines, evidence stay deterministic', async () => {
    const report = makeReport();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('  נוסח מלוטש של הדוח  '));
    const result = await polishWithClaude(report, {
      enabled: true,
      accessCode: 'code-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.polished).toBe(true);
    expect(result.report.text).toBe('נוסח מלוטש של הדוח');
    expect(result.report.suggestionInput.body).toBe('נוסח מלוטש של הדוח');
    expect(result.report.html).toBe(report.html);
    expect(result.report.lines).toBe(report.lines);
    expect(result.report.evidence).toBe(report.evidence);
    // The original object is never mutated.
    expect(report.suggestionInput.body).toBe(report.text);
  });

  it('sanitizes BiDi controls out of the polished text', async () => {
    const RLO = '\u202E';
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(`נוסח ${RLO}חשוד`));
    const result = await polishWithClaude(makeReport(), {
      enabled: true,
      accessCode: 'code-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.polished).toBe(true);
    expect(result.report.text.includes(RLO)).toBe(false);
  });

  it('falls back to the original report on HTTP error', async () => {
    const report = makeReport();
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(429));
    const result = await polishWithClaude(report, {
      enabled: true,
      accessCode: 'code-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.polished).toBe(false);
    expect(result.report).toBe(report);
    expect(result.error).toContain('429');
  });

  it('falls back on an empty response body', async () => {
    const report = makeReport();
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(undefined));
    const result = await polishWithClaude(report, {
      enabled: true,
      accessCode: 'code-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.polished).toBe(false);
    expect(result.report).toBe(report);
    expect(result.error).toContain('empty');
  });

  it('falls back when the transport throws (network failure)', async () => {
    const report = makeReport();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await polishWithClaude(report, {
      enabled: true,
      accessCode: 'code-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.polished).toBe(false);
    expect(result.report).toBe(report);
    expect(result.error).toContain('network down');
  });
});
