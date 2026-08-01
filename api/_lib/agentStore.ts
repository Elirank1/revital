// ============================================================
// Revital V3 — AgentStore bridge (Wave 2, agents-engine)
//
// BINDING contract: docs/waves/wave2-contract.md §Agent-side store
// bridge. Until G3 executes (Supabase signup — Eliran's click), the
// server tick uses the EXISTING Redis v3 blob (revital:data:{code})
// as its bounded bridge store.
//
// Hard rails enforced HERE, not just promised:
//   * write() accepts ONLY suggestions + agentRuns — persons / deals /
//     events pass through byte-untouched from a fresh read (single
//     writer preserved: card state has exactly one writer, the client);
//   * server-assigned versions via the SAME merge semantics as
//     api/data.ts v3 (serverMergeCollection is imported from the
//     canonical module — api/data.ts inlines it verbatim);
//   * agentRuns rotated to ≤ AGENT_RUNS_MAX (200), newest-by-v kept;
//   * blob hard cap honored: an agent write may never push the blob
//     past the same 1.5MB limit api/data.ts enforces.
//
// Two impls (contract): redisBridgeStore (live) and a Supabase-shaped
// adapter over SupabaseAgentClient — mockSupabaseAgentStore for tests
// now, the same adapter over supabase-js post-G3.
// ============================================================

import { Redis } from '@upstash/redis';
import type {
  AgentRun,
  Deal,
  Person,
  StageEvent,
  Suggestion,
} from '../../src/types/pipeline';
import { serverMergeCollection } from '../../src/lib/persistence/merge';
import {
  mockSupabaseStore,
  type AgentRow,
  type SupabaseAgentClient,
} from '../../src/lib/persistence/mockSupabase';

// Rotation bound for agent_runs in the bridge blob (contract: ≤200).
export const AGENT_RUNS_MAX = 200;

// KEEP IN SYNC with api/data.ts BLOB_HARD_CAP_BYTES.
export const BLOB_HARD_CAP_BYTES = 1_500_000;

/** revital:data:{code} — the same blob api/data.ts owns. */
export function agentDataKey(code: string): string {
  return `revital:data:${code}`;
}

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

/** `cursor`/`volume` folded into the lead-owned AgentRun (was a D-018-style
 * ride-ahead). Alias kept so tick/store call sites stay unchanged. */
export type TickAgentRun = AgentRun;

/** Legacy JobDescription reference (blob top-level `savedJobs`) — JD
 *  content for Bench Sourcer matching. READ-ONLY input. */
export interface AgentJobRef {
  id: string;
  title: string;
  rawText?: string;
}

/** Legacy CandidateAnalysis reference (blob top-level `analyses`) —
 *  person content for Bench Sourcer matching. READ-ONLY input. */
export interface AgentAnalysisRef {
  id: string;
  timestamp?: string;
  profileSummary?: string;
  matchScore?: number;
  verdict?: string;
}

/** Read view of one access code's v3 section (+ legacy read-only refs).
 *  persons/deals/events/jobs/analyses are INPUTS ONLY — the bridge
 *  cannot write them, by construction. */
export interface AgentStoreView {
  schemaVersion: number;
  vCounter: number;
  persons: Person[];
  deals: Deal[];
  events: StageEvent[];
  suggestions: Suggestion[];
  agentRuns: TickAgentRun[];
  /** Legacy savedJobs (mandate JDs) — Bench Sourcer input. */
  jobs: AgentJobRef[];
  /** Legacy analyses (candidate summaries) — Bench Sourcer input. */
  analyses: AgentAnalysisRef[];
}

/** The ONLY records an agent may emit (plan §3 single-writer). */
export interface AgentOutput {
  suggestions: Suggestion[];
  agentRuns: TickAgentRun[];
}

export interface AgentWriteResult {
  vCounter: number;
  /** Suggestion ids accepted (new episodes). */
  suggestionsAccepted: string[];
  /** Suggestion ids dropped as stale — deterministic-id re-emissions of
   *  an existing episode (idempotency backstop; dismissals stay final). */
  suggestionsDropped: string[];
  runsAccepted: string[];
  /** Old agent_runs physically rotated out (bridge blob stays bounded). */
  runsRotatedOut: number;
}

export interface AgentStore {
  load(code: string): Promise<AgentStoreView>;
  write(code: string, output: AgentOutput): Promise<AgentWriteResult>;
}

// ------------------------------------------------------------
// Shared normalization
// ------------------------------------------------------------

interface RawV3 {
  schemaVersion?: number;
  vCounter?: number;
  persons?: unknown[];
  deals?: unknown[];
  events?: unknown[];
  suggestions?: unknown[];
  agentRuns?: unknown[];
}

function emptyView(): AgentStoreView {
  return {
    schemaVersion: 1,
    vCounter: 0,
    persons: [],
    deals: [],
    events: [],
    suggestions: [],
    agentRuns: [],
    jobs: [],
    analyses: [],
  };
}

/** Defensive mapping of legacy blob `savedJobs` — never throws. */
export function toJobRefs(raw: unknown): AgentJobRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentJobRef[] = [];
  for (const j of raw) {
    if (typeof j !== 'object' || j === null) continue;
    const o = j as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id === '') continue;
    out.push({
      id: o.id,
      title: typeof o.title === 'string' ? o.title : '',
      ...(typeof o.rawText === 'string' ? { rawText: o.rawText } : {}),
    });
  }
  return out;
}

/** Defensive mapping of legacy blob `analyses` — never throws. */
export function toAnalysisRefs(raw: unknown): AgentAnalysisRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAnalysisRef[] = [];
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    const o = a as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id === '') continue;
    out.push({
      id: o.id,
      ...(typeof o.timestamp === 'string' ? { timestamp: o.timestamp } : {}),
      ...(typeof o.profileSummary === 'string'
        ? { profileSummary: o.profileSummary }
        : {}),
      ...(typeof o.matchScore === 'number' ? { matchScore: o.matchScore } : {}),
      ...(typeof o.verdict === 'string' ? { verdict: o.verdict } : {}),
    });
  }
  return out;
}

function toView(v3: RawV3 | undefined | null): AgentStoreView {
  if (!v3) return emptyView();
  return {
    schemaVersion: typeof v3.schemaVersion === 'number' ? v3.schemaVersion : 1,
    vCounter: typeof v3.vCounter === 'number' ? v3.vCounter : 0,
    persons: (Array.isArray(v3.persons) ? v3.persons : []) as Person[],
    deals: (Array.isArray(v3.deals) ? v3.deals : []) as Deal[],
    events: (Array.isArray(v3.events) ? v3.events : []) as StageEvent[],
    suggestions: (Array.isArray(v3.suggestions)
      ? v3.suggestions
      : []) as Suggestion[],
    agentRuns: (Array.isArray(v3.agentRuns)
      ? v3.agentRuns
      : []) as TickAgentRun[],
    jobs: [],
    analyses: [],
  };
}

/** New records enter merge with v=0 (never-synced) — the server assigns. */
function withServerVersionSemantics<T extends { v?: number }>(records: T[]): T[] {
  return records.map((r) => ({ ...r, v: typeof r.v === 'number' ? r.v : 0 }));
}

/**
 * Rotate agent runs: keep the newest AGENT_RUNS_MAX by server version
 * (v desc), returned in ascending-v order. Physical removal is the
 * point — the bridge blob must stay bounded (contract: ≤200 runs).
 */
export function rotateAgentRuns(
  runs: TickAgentRun[],
  max: number = AGENT_RUNS_MAX,
): { kept: TickAgentRun[]; rotatedOut: number } {
  if (runs.length <= max) {
    return { kept: [...runs].sort((a, b) => a.v - b.v), rotatedOut: 0 };
  }
  const sorted = [...runs].sort((a, b) => b.v - a.v);
  const kept = sorted.slice(0, max).sort((a, b) => a.v - b.v);
  return { kept, rotatedOut: runs.length - max };
}

/** Highest cursor a given agent has recorded — the tick's incremental
 *  read position ("agentRuns last processed v", contract). */
export function lastCursorForAgent(
  runs: readonly TickAgentRun[],
  agent: AgentRun['agent'],
): number {
  let cursor = 0;
  for (const r of runs) {
    if (r.deleted) continue;
    if (r.agent !== agent) continue;
    if (typeof r.cursor === 'number' && r.cursor > cursor) cursor = r.cursor;
  }
  return cursor;
}

// ------------------------------------------------------------
// redisBridgeStore — live impl over the shared Upstash blob
// ------------------------------------------------------------

/** Minimal Redis surface — injectable for tests (same pattern as spend.ts). */
export interface BlobRedis {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
}

let cachedRedis: BlobRedis | null | undefined;

function getDefaultRedis(): BlobRedis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

interface Blob {
  analyses?: unknown[];
  savedJobs?: unknown[];
  log?: unknown[];
  updatedAt?: string;
  v3?: RawV3;
  [key: string]: unknown;
}

/**
 * The live bridge store. Unlike the spend guard this is a WRITE path and
 * fails CLOSED: no Redis ⇒ load/write throw, the tick records the error.
 *
 * write() is a self-contained read-merge-write: it re-fetches the blob
 * immediately before setting, merges ONLY suggestions/agentRuns into the
 * fresh copy, and carries every other byte (legacy sections AND
 * persons/deals/events) forward untouched — the same non-locking
 * read-modify-write discipline api/data.ts itself uses, with the window
 * kept minimal.
 */
export function redisBridgeStore(redis?: BlobRedis | null): AgentStore {
  const resolve = (): BlobRedis => {
    const r = redis !== undefined ? redis : getDefaultRedis();
    if (!r) {
      throw new Error(
        'agentStore: Redis unconfigured (KV_REST_API_URL / KV_REST_API_TOKEN)',
      );
    }
    return r;
  };

  return {
    async load(code: string): Promise<AgentStoreView> {
      const blob = ((await resolve().get(agentDataKey(code))) ?? {}) as Blob;
      const view = toView(blob.v3);
      // Legacy sections as READ-ONLY inputs (Bench Sourcer matching);
      // write() never touches them — they pass through via `...blob`.
      view.jobs = toJobRefs(blob.savedJobs);
      view.analyses = toAnalysisRefs(blob.analyses);
      return view;
    },

    async write(code: string, output: AgentOutput): Promise<AgentWriteResult> {
      const r = resolve();
      const key = agentDataKey(code);
      // Fresh read right before the write — minimal clobber window.
      const blob = ((await r.get(key)) ?? {
        analyses: [],
        savedJobs: [],
        log: [],
      }) as Blob;
      const stored = toView(blob.v3);

      const sMerge = serverMergeCollection(
        stored.suggestions,
        withServerVersionSemantics(output.suggestions),
        stored.vCounter,
      );
      const rMerge = serverMergeCollection(
        stored.agentRuns,
        withServerVersionSemantics(output.agentRuns),
        sMerge.vCounter,
      );
      const { kept: agentRuns, rotatedOut } = rotateAgentRuns(rMerge.records);

      const nextBlob: Blob = {
        ...blob, // legacy sections + anything unknown: byte-untouched
        v3: {
          schemaVersion: stored.schemaVersion,
          vCounter: rMerge.vCounter,
          // Single-writer rail: passthrough from the fresh read, never
          // from the caller — there is no code path that can write these.
          persons: stored.persons,
          deals: stored.deals,
          events: stored.events,
          suggestions: sMerge.records,
          agentRuns,
        },
      };

      const serialized = JSON.stringify(nextBlob);
      if (serialized.length > BLOB_HARD_CAP_BYTES) {
        throw new Error(
          `agentStore: write rejected — blob ${serialized.length} bytes exceeds hard cap ${BLOB_HARD_CAP_BYTES} (rotate/migrate history, plan §5)`,
        );
      }

      await r.set(key, nextBlob);

      return {
        vCounter: rMerge.vCounter,
        suggestionsAccepted: sMerge.accepted,
        suggestionsDropped: sMerge.staleDropped,
        runsAccepted: rMerge.accepted,
        runsRotatedOut: rotatedOut,
      };
    },
  };
}

// ------------------------------------------------------------
// Supabase-shaped impl — tests now, the real swap post-G3
// ------------------------------------------------------------

// Row mapping: KEEP IN SYNC with src/lib/persistence/agentStoreImporter.ts
// (suggestionRow/agentRunRow — same schema.sql column shapes; `payload`
// carries the full canonical record and is the read-back source of truth).

function suggestionRow(code: string, s: Suggestion): AgentRow {
  return {
    access_code: code,
    id: s.id,
    agent: s.agent,
    kind: s.kind,
    deal_id: s.dealId ?? null,
    person_id: s.personId ?? null,
    title: s.title,
    body: s.body,
    evidence: s.evidence,
    status: s.status,
    created_at: s.createdAt,
    resolved_at: s.resolvedAt ?? null,
    deleted: s.deleted === true,
    v: s.v,
    payload: s,
    updated_at: s.updatedAt,
  };
}

function agentRunRow(code: string, r: TickAgentRun): AgentRow {
  return {
    access_code: code,
    id: r.id,
    agent: r.agent,
    trigger_kind: r.trigger,
    started_at: r.startedAt,
    finished_at: r.finishedAt ?? null,
    items_processed: r.itemsProcessed,
    suggestions_created: r.suggestionsCreated,
    tokens_used: r.tokensUsed ?? null,
    outcome: r.outcome,
    error: r.error ?? null,
    v: r.v,
    payload: r,
    updated_at: r.updatedAt,
  };
}

function rowPayload<T>(row: AgentRow): T | null {
  return row.payload !== undefined && row.payload !== null
    ? (row.payload as T)
    : null;
}

/**
 * AgentStore over any SupabaseAgentClient — the in-memory mock today,
 * supabase-js with the service-role key after G3. Same server-assigned
 * version + staleness semantics as the redis bridge (one vCounter,
 * derived from the max stored v). No rotation: a real database is not
 * a bounded blob — retention is schema policy, not client-side pruning.
 */
export function supabaseAgentStore(client: SupabaseAgentClient): AgentStore {
  const rowsFor = async (
    table: 'suggestions' | 'agent_runs',
    code: string,
  ): Promise<AgentRow[]> => {
    const rows = await client.selectAll(table);
    return rows.filter((row) => row.access_code === code);
  };

  return {
    async load(code: string): Promise<AgentStoreView> {
      const [suggestionRows, runRows, eventRows] = await Promise.all([
        rowsFor('suggestions', code),
        rowsFor('agent_runs', code),
        client
          .selectAll('events')
          .then((rows) => rows.filter((row) => row.access_code === code)),
      ]);
      const suggestions = suggestionRows
        .map((row) => rowPayload<Suggestion>(row))
        .filter((s): s is Suggestion => s !== null);
      const agentRuns = runRows
        .map((row) => rowPayload<TickAgentRun>(row))
        .filter((r): r is TickAgentRun => r !== null);
      const events = eventRows
        .map((row) => rowPayload<StageEvent>(row))
        .filter((e): e is StageEvent => e !== null);
      const vCounter = Math.max(
        0,
        ...suggestions.map((s) => s.v),
        ...agentRuns.map((r) => r.v),
        ...events.map((e) => e.v),
      );
      return {
        schemaVersion: 1,
        vCounter,
        // Card state never lives agent-side (single-writer, plan §3).
        persons: [],
        deals: [],
        events,
        suggestions,
        agentRuns,
        // Legacy blob sections have no Supabase home (schema.sql holds
        // agent tables only) — honest empties until a post-G3 decision.
        jobs: [],
        analyses: [],
      };
    },

    async write(code: string, output: AgentOutput): Promise<AgentWriteResult> {
      const view = await this.load(code);

      const sMerge = serverMergeCollection(
        view.suggestions,
        withServerVersionSemantics(output.suggestions),
        view.vCounter,
      );
      const rMerge = serverMergeCollection(
        view.agentRuns,
        withServerVersionSemantics(output.agentRuns),
        sMerge.vCounter,
      );

      const acceptedSuggestions = sMerge.records.filter((s) =>
        sMerge.accepted.includes(s.id),
      );
      const acceptedRuns = rMerge.records.filter((r) =>
        rMerge.accepted.includes(r.id),
      );
      if (acceptedSuggestions.length > 0) {
        await client.upsert(
          'suggestions',
          acceptedSuggestions.map((s) => suggestionRow(code, s)),
        );
      }
      if (acceptedRuns.length > 0) {
        await client.upsert(
          'agent_runs',
          acceptedRuns.map((r) => agentRunRow(code, r)),
        );
      }

      return {
        vCounter: rMerge.vCounter,
        suggestionsAccepted: sMerge.accepted,
        suggestionsDropped: sMerge.staleDropped,
        runsAccepted: rMerge.accepted,
        runsRotatedOut: 0,
      };
    },
  };
}

/** Contract-named test impl: the Supabase adapter over the in-memory mock. */
export function mockSupabaseAgentStore(): {
  store: AgentStore;
  client: ReturnType<typeof mockSupabaseStore>;
} {
  const client = mockSupabaseStore();
  return { store: supabaseAgentStore(client), client };
}
