// Wave-3B bench transport: spend cap checked BEFORE any network call,
// env-key requirement, 429 mapping, defensive response extraction —
// all with injected fetch/spend (zero real network).
import { describe, it, expect, vi } from 'vitest';
import type { SpendCheckResult } from './spend';
import { BenchSpendCapError } from '../../src/agents/benchSourcer';
import {
  BENCH_LLM_MAX_TOKENS,
  BENCH_LLM_MODEL,
  liveBenchTransport,
  type FetchLike,
} from './benchTransport';

const ENV = { ANTHROPIC_API_KEY: 'test-key' };

function spendResult(allowed: boolean, overrides: Partial<SpendCheckResult> = {}): SpendCheckResult {
  return {
    allowed,
    service: 'claude',
    count: allowed ? 1 : 201,
    limit: 200,
    remaining: allowed ? 199 : 0,
    ...overrides,
  };
}

function okFetch(text = '{"matches":[]}'): { fetchImpl: FetchLike; calls: Array<{ url: string; init: unknown }> } {
  const calls: Array<{ url: string; init: unknown }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text }] }),
      text: async () => '',
    };
  };
  return { fetchImpl, calls };
}

describe('liveBenchTransport', () => {
  it('counts spend BEFORE the network call and blocks over-cap with BenchSpendCapError', async () => {
    const { fetchImpl, calls } = okFetch();
    const spendCheck = vi.fn(async () => spendResult(false));
    const transport = liveBenchTransport('c1', { env: ENV, fetchImpl, spendCheck });

    await expect(transport.complete('prompt')).rejects.toBeInstanceOf(BenchSpendCapError);
    expect(spendCheck).toHaveBeenCalledWith('c1', 'claude');
    expect(calls).toHaveLength(0); // fail BEFORE spending network/tokens
  });

  it('allowed spend → posts to the Messages API with the env key and returns the text', async () => {
    const { fetchImpl, calls } = okFetch('LLM says hi');
    const transport = liveBenchTransport('c1', {
      env: ENV,
      fetchImpl,
      spendCheck: async () => spendResult(true),
    });

    const text = await transport.complete('the prompt');
    expect(text).toBe('LLM says hi');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/api\.anthropic\.com\/v1\/messages/);
    const init = calls[0].init as { headers: Record<string, string>; body: string };
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: BENCH_LLM_MODEL,
      max_tokens: BENCH_LLM_MAX_TOKENS,
      messages: [{ role: 'user', content: 'the prompt' }],
    });
  });

  it('Redis-down fail-open (spendGuard unavailable) still allows the call', async () => {
    const { fetchImpl, calls } = okFetch();
    const transport = liveBenchTransport('c1', {
      env: ENV,
      fetchImpl,
      spendCheck: async () =>
        spendResult(true, { count: null, remaining: null, spendGuard: 'unavailable' }),
    });
    await transport.complete('p');
    expect(calls).toHaveLength(1);
  });

  it('missing ANTHROPIC_API_KEY fails without any network call', async () => {
    const { fetchImpl, calls } = okFetch();
    const transport = liveBenchTransport('c1', {
      env: {},
      fetchImpl,
      spendCheck: async () => spendResult(true),
    });
    await expect(transport.complete('p')).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(calls).toHaveLength(0);
  });

  it('upstream 429 maps to BenchSpendCapError (capacity is capacity)', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'rate limited',
    });
    const transport = liveBenchTransport('c1', {
      env: ENV,
      fetchImpl,
      spendCheck: async () => spendResult(true),
    });
    await expect(transport.complete('p')).rejects.toBeInstanceOf(BenchSpendCapError);
  });

  it('other upstream errors and empty content are plain errors', async () => {
    const boom: FetchLike = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'server error',
    });
    await expect(
      liveBenchTransport('c1', {
        env: ENV,
        fetchImpl: boom,
        spendCheck: async () => spendResult(true),
      }).complete('p'),
    ).rejects.toThrow(/500/);

    const empty: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [] }),
      text: async () => '',
    });
    await expect(
      liveBenchTransport('c1', {
        env: ENV,
        fetchImpl: empty,
        spendCheck: async () => spendResult(true),
      }).complete('p'),
    ).rejects.toThrow(/no text content/);
  });
});
