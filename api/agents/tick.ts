// ============================================================
// Revital V3 — daily agent tick (Wave 2, agents-engine)
//
// BINDING contract: docs/waves/wave2-contract.md §Tick protocol.
//   POST only · Authorization: Bearer <CRON_SECRET> or x-cron-secret
//   (fail-closed) · preview guard applies · body {codes?, budgetMs?}.
//   Per access code (default: env TICK_CODES csv): load the blob v3
//   section ONCE, run the deterministic agent passes (Pit Boss ranking,
//   SLA silence sweep), write suggestions + agent_runs through the
//   AgentStore bridge, stop before budgetMs (default 8000ms), return
//   {ok, ran:[{code, agent, produced, cursor}], partial}.
//
// Hard rails:
//   * NO LLM calls — both passes are pure functions; spend caps are
//     untouched by cron (the spend module is never imported here);
//   * agents write ONLY suggestions/agent_runs via the bridge — the
//     bridge itself makes persons/deals/events unreachable (plan §3);
//   * deterministic per-episode suggestion ids + LWW staleness make the
//     daily re-run idempotent: an episode already filed (or dismissed)
//     is dropped, never duplicated or resurrected;
//   * incremental cursor = blob vCounter at processing time, recorded
//     on each agent_run; time-driven conditions (aging, silence) are
//     re-evaluated every tick because clocks advance without record
//     changes — idempotent ids keep that re-evaluation free.
//
// Wave-2 server inputs, stated honestly: MandateFees are client-local
// (`revital_v3_fees`, not in the sync payload) and edited priors are
// client-local too — the server pass therefore ranks with empty fees +
// DEFAULT_STAGE_PRIORS, so its Pit Boss suggestions carry day-count
// evidence and NO ₪ (calibration-safe by construction). ₪-ranked
// "Today's Shekels" lives client-side where fees exist. Post-G3 the
// Supabase fee ledger gives the server real fees with zero code change
// here (rankMoveTheMoney already takes them as input).
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { previewWriteBlocked, requireCronSecret } from '../_lib/guard';
import {
  redisBridgeStore,
  type AgentStore,
  type TickAgentRun,
} from '../_lib/agentStore';
import type { AgentName, Suggestion } from '../../src/types/pipeline';
import type { SuggestionInput } from '../../src/store/pipelineStore';
import {
  planSlaSweep,
  SLA_AGENT,
  SLA_SILENCE_STAGES,
} from '../../src/agents/sla';
import {
  PIT_BOSS_AGENT,
  pitBossSuggestionInput,
  rankMoveTheMoney,
} from '../../src/agents/pitboss';
import {
  DEFAULT_STAGE_PRIORS,
  observedStageStats,
} from '../../src/lib/money/priors';
import { flattenContacts } from '../../src/lib/metrics/leadingIndicators';
import { PIPELINE_STAGES } from '../../src/types/pipeline';

export const TICK_DEFAULT_BUDGET_MS = 8000;

export interface TickRanEntry {
  code: string;
  agent: AgentName | 'tick';
  /** Suggestions actually accepted by the bridge for this agent. */
  produced: number;
  /** Incremental cursor recorded for continuation (blob vCounter). */
  cursor: number;
  error?: string;
}

export interface TickResponse {
  ok: boolean;
  ran: TickRanEntry[];
  partial: boolean;
  note?: string;
}

type Env = Record<string, string | undefined>;

export interface TickDeps {
  store?: AgentStore;
  env?: Env;
  now?: Date;
}

/** env TICK_CODES csv → trimmed non-empty codes. */
export function parseTickCodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** Convert an agent SuggestionInput into a bridge record (v=0 — the
 *  server assigns the real version on merge). */
function toSuggestionRecord(input: SuggestionInput, nowIso: string): Suggestion {
  if (!input.id) {
    // Deterministic ids are the idempotency rail — refuse to file without.
    throw new Error('tick: suggestion input missing deterministic id');
  }
  return {
    id: input.id,
    v: 0,
    updatedAt: nowIso,
    agent: input.agent,
    kind: input.kind,
    ...(input.dealId ? { dealId: input.dealId } : {}),
    ...(input.personId ? { personId: input.personId } : {}),
    title: input.title,
    body: input.body,
    evidence: input.evidence ?? [],
    status: 'pending',
    createdAt: input.createdAt ?? nowIso,
  };
}

const PIPELINE_STAGE_SET = new Set<string>(PIPELINE_STAGES);

export function createTickHandler(deps: TickDeps = {}) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const env = deps.env ?? process.env;

    // Contract: POST only (the Wave-0 stub's GET allowance is dropped).
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const auth = requireCronSecret(req, env);
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    if (previewWriteBlocked(env)) {
      return res.status(503).json({
        ok: false,
        error:
          'Preview environment: agent paths are read-only (set PREVIEW_DATA_OK to override)',
      });
    }

    // ---- Body -------------------------------------------------------
    const body = (req.body ?? {}) as { codes?: unknown; budgetMs?: unknown };

    let codes: string[];
    if (body.codes !== undefined) {
      if (
        !Array.isArray(body.codes) ||
        body.codes.some((c) => typeof c !== 'string' || c.trim() === '')
      ) {
        return res
          .status(400)
          .json({ ok: false, error: 'codes must be a non-empty string array' });
      }
      codes = (body.codes as string[]).map((c) => c.trim());
    } else {
      codes = parseTickCodes(env.TICK_CODES);
    }

    const budgetMs =
      typeof body.budgetMs === 'number' &&
      Number.isFinite(body.budgetMs) &&
      body.budgetMs > 0
        ? body.budgetMs
        : TICK_DEFAULT_BUDGET_MS;

    if (codes.length === 0) {
      const response: TickResponse = {
        ok: true,
        ran: [],
        partial: false,
        note: 'no access codes configured (body.codes or env TICK_CODES)',
      };
      return res.status(200).json(response);
    }

    // ---- Fan out over codes, chunked by budget ----------------------
    const store = deps.store ?? redisBridgeStore();
    const startedMs = Date.now();
    const ran: TickRanEntry[] = [];
    let partial = false;

    for (let i = 0; i < codes.length; i++) {
      // Always make progress on the first code; check the budget before
      // each subsequent one — the caller re-invokes for the rest.
      if (i > 0 && Date.now() - startedMs >= budgetMs) {
        partial = true;
        break;
      }
      const code = codes[i];
      const now = deps.now ?? new Date();
      const nowIso = now.toISOString();

      try {
        const view = await store.load(code);
        const liveDeals = view.deals.filter((d) => !d.deleted);
        const contacts = flattenContacts(
          view.persons.map((p) => ({
            id: p.id,
            ...(p.deleted ? { deleted: p.deleted } : {}),
            contactEvents: p.contactEvents ?? [],
          })),
        );
        const observed = observedStageStats(view.events.filter((e) => !e.deleted));
        const existingIds = new Set(view.suggestions.map((s) => s.id));

        // ---- SLA silence sweep (outreach_runner) --------------------
        const slaPlan = planSlaSweep(view.deals, view.persons, view.suggestions, now);
        const slaSuggestions = slaPlan.toFile.map(({ input }) =>
          toSuggestionRecord(input, nowIso),
        );
        const slaItemsProcessed = liveDeals.filter((d) =>
          SLA_SILENCE_STAGES.includes(d.stage),
        ).length;

        // ---- Pit Boss ranking (pit_boss) ----------------------------
        // Fees/priors: server-honest inputs — see header comment.
        const rankedItems = rankMoveTheMoney(
          view.deals,
          {},
          DEFAULT_STAGE_PRIORS,
          contacts,
          now,
          observed,
        );
        const dealById = new Map(liveDeals.map((d) => [d.id, d]));
        const pbSuggestions: Suggestion[] = [];
        for (const item of rankedItems) {
          const deal = dealById.get(item.dealId);
          if (!deal) continue;
          const input = pitBossSuggestionInput(item, deal);
          // Same-episode suggestion already filed (any status) — skip;
          // the LWW merge would drop it anyway, this keeps counts honest.
          if (input.id && existingIds.has(input.id)) continue;
          pbSuggestions.push(toSuggestionRecord(input, nowIso));
        }
        const pbItemsProcessed = liveDeals.filter(
          (d) => PIPELINE_STAGE_SET.has(d.stage) && d.stage !== 'Paid',
        ).length;

        // ---- One bridge write per code (suggestions + both runs) ----
        const cursor = view.vCounter;
        const makeRun = (
          agent: AgentName,
          itemsProcessed: number,
          suggestionsCreated: number,
        ): TickAgentRun => ({
          id: `run_${agent}_${randomUUID()}`,
          v: 0,
          updatedAt: nowIso,
          agent,
          trigger: 'cron',
          startedAt: nowIso,
          finishedAt: new Date().toISOString(),
          itemsProcessed,
          suggestionsCreated,
          outcome: 'ok',
          cursor,
        });

        const result = await store.write(code, {
          suggestions: [...slaSuggestions, ...pbSuggestions],
          agentRuns: [
            makeRun(SLA_AGENT, slaItemsProcessed, slaSuggestions.length),
            makeRun(PIT_BOSS_AGENT, pbItemsProcessed, pbSuggestions.length),
          ],
        });

        const acceptedSet = new Set(result.suggestionsAccepted);
        ran.push({
          code,
          agent: SLA_AGENT,
          produced: slaSuggestions.filter((s) => acceptedSet.has(s.id)).length,
          cursor,
        });
        ran.push({
          code,
          agent: PIT_BOSS_AGENT,
          produced: pbSuggestions.filter((s) => acceptedSet.has(s.id)).length,
          cursor,
        });
      } catch (err) {
        // Per-code isolation: one broken blob must not sink the fan-out.
        ran.push({
          code,
          agent: 'tick',
          produced: 0,
          cursor: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const response: TickResponse = { ok: true, ran, partial };
    return res.status(200).json(response);
  };
}

export default createTickHandler();
