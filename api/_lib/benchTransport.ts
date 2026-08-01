// ============================================================
// Revital V3 — Bench Sourcer server transport (Wave 3B, agents-engine)
//
// The ONLY LLM door in the daily tick (wave3 contract). Same server-side
// proxy pattern as api/analyze.ts: Anthropic Messages API, env key
// (ANTHROPIC_API_KEY — users never see it), and the per-code daily
// spend cap enforced BEFORE every call via checkAndCount(code,'claude')
// — the same counter /api/analyze consumes, so tick calls and app
// analyses share one daily budget per access code.
//
// Cap semantics: a denied spend check (the state /api/analyze answers
// with 429) throws BenchSpendCapError → the bench pass records an
// AgentRun with outcome 'capped'. An upstream HTTP 429 from the LLM API
// maps to the same error (capacity is capacity; retry next tick).
// Redis-down fail-open (spendGuard:'unavailable') allows the call, same
// as every other spend-guarded endpoint.
//
// Everything is injectable (fetch, spend check, env) — unit tests run
// with zero real network. src/ code never imports this module; the
// transport is passed INTO the engine (src/agents/benchSourcer.ts).
// ============================================================

import { checkAndCount, type SpendCheckResult, type SpendService } from './spend';
import {
  BenchSpendCapError,
  type BenchMatchTransport,
} from '../../src/agents/benchSourcer';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export const BENCH_LLM_MODEL = 'claude-sonnet-4-6';
export const BENCH_LLM_MAX_TOKENS = 2048;

type Env = Record<string, string | undefined>;

/** Minimal fetch surface — injectable for tests (zero real network). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface BenchTransportOpts {
  env?: Env;
  fetchImpl?: FetchLike;
  spendCheck?: (code: string, service: SpendService) => Promise<SpendCheckResult>;
  model?: string;
  maxTokens?: number;
}

/**
 * Spend-capped Claude transport for one access code. Every complete()
 * call counts against the code's daily 'claude' cap first; over cap ⇒
 * BenchSpendCapError (never a silent skip — the tick must record
 * 'capped' honestly).
 */
export function liveBenchTransport(
  code: string,
  opts: BenchTransportOpts = {},
): BenchMatchTransport {
  const env = opts.env ?? process.env;
  const doFetch: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const spendCheck =
    opts.spendCheck ?? ((c: string, s: SpendService) => checkAndCount(c, s));

  return {
    async complete(prompt: string): Promise<string> {
      const spend = await spendCheck(code, 'claude');
      if (!spend.allowed) {
        throw new BenchSpendCapError(
          `Daily Claude spend cap reached (${spend.count}/${spend.limit})`,
        );
      }

      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not configured on server');
      }

      const response = await doFetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: opts.model ?? BENCH_LLM_MODEL,
          max_tokens: opts.maxTokens ?? BENCH_LLM_MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (response.status === 429) {
        throw new BenchSpendCapError('LLM API rate-limited (429)');
      }
      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = Array.isArray(data.content)
        ? data.content
            .filter((b) => typeof b?.text === 'string')
            .map((b) => b.text as string)
            .join('\n')
        : '';
      if (text === '') {
        throw new Error('LLM API returned no text content');
      }
      return text;
    },
  };
}
