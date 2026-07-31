// ============================================================
// Revital V3 — agent-store importer (Wave 2, platform-data)
//
// Copies the client-side v3 collections that belong in the agent-side
// store (events, suggestions, agent_runs, fee ledger — wave2-contract
// §Agent-side store bridge / plan §5) into a Supabase-shaped client.
// Pre-G3 that client is ALWAYS the in-memory mock (mockSupabase.ts);
// post-G3 the same code runs against the real service-role client.
//
// Safety (Wave-0 criteria (e)/(f), same discipline as backfill.ts):
//   * dry-run FIRST — agentStoreImportDryRun reports, never mutates;
//   * apply is flag-gated (revital_v3_flag on) AND requires an explicit
//     { confirm: true } argument;
//   * apply takes an automatic pre-migration backup of the DESTINATION
//     tables (localStorage `revital_v3_agent_import_backup`) before
//     writing anything;
//   * events / fee_ledger are treated append-only: an existing event id
//     with different content is REPORTED as a conflict and skipped,
//     never overwritten;
//   * deterministic ids everywhere ⇒ re-runs are no-ops;
//   * rollback = flag off, nothing else. Client state is only READ —
//     this importer NEVER writes persons/deals (single-writer, plan §3).
// ============================================================

import type {
  AgentRun,
  StageEvent,
  Suggestion,
} from '../../types/pipeline';
import type { MandateFee } from '../money/mandateFee';
import { usePipelineStore } from '../../store/pipelineStore';
import { useMoneyStore } from '../money/moneyStore';
import { isV3Enabled, loadV3, saveV3 } from './keys';
import type { AgentRow, SupabaseAgentClient } from './mockSupabase';

export const AGENT_IMPORT_BACKUP_KEY = 'revital_v3_agent_import_backup';

export interface AgentStoreImportSource {
  accessCode: string;
  events: StageEvent[];
  suggestions: Suggestion[];
  agentRuns: AgentRun[];
  fees: MandateFee[];
}

/** Convenience: snapshot the live stores into an import source (read-only). */
export function buildImportSource(accessCode: string): AgentStoreImportSource {
  const { stageEvents, suggestions } = usePipelineStore.getState();
  const { fees } = useMoneyStore.getState();
  return {
    accessCode,
    events: stageEvents,
    suggestions,
    agentRuns: [], // client holds no runs in Wave 2 — the tick writes them bridge-side
    fees: Object.values(fees),
  };
}

// ------------------------------------------------------------
// Row mapping (schema.sql column shapes; payload = full canonical record)
// ------------------------------------------------------------

function eventRow(code: string, e: StageEvent): AgentRow {
  return {
    access_code: code,
    id: e.id,
    deal_id: e.dealId,
    from_stage: e.from,
    to_stage: e.to,
    ts: e.ts,
    actor: e.actor,
    skipped_stages: e.skippedStages,
    reason: e.reason ?? null,
    v: e.v,
    payload: e,
  };
}

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

function agentRunRow(code: string, r: AgentRun): AgentRow {
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

function feeRow(code: string, f: MandateFee): AgentRow {
  return {
    access_code: code,
    job_id: f.jobId,
    kind: f.kind,
    percent: f.percent ?? null,
    expected_salary: f.expectedSalary ?? null,
    fixed_amount: f.fixedAmount ?? null,
    currency: f.currency,
    guarantee_days: f.guaranteeDays,
    invoice_status: f.invoiceStatus,
    invoice_due_at: f.invoiceDueAt ?? null,
    updated_at: f.updatedAt,
    payload: f,
  };
}

/** Deterministic fee-ledger id — re-importing the same fee state is a no-op. */
export function feeLedgerId(jobId: string, updatedAt: string): string {
  return `fl_${jobId}_${updatedAt}`;
}

function samePayload(stored: AgentRow | undefined, incoming: AgentRow): boolean {
  if (!stored) return false;
  return (
    JSON.stringify(stored.payload ?? null) ===
    JSON.stringify(incoming.payload ?? null)
  );
}

// ------------------------------------------------------------
// Dry run
// ------------------------------------------------------------

export interface AgentImportPlan {
  accessCode: string;
  wouldInsertEvents: number;
  unchangedEvents: number;
  /** Existing event id with DIFFERENT content — append-only, never touched. */
  conflictingEventIds: string[];
  wouldInsertSuggestions: number;
  wouldUpdateSuggestions: number;
  unchangedSuggestions: number;
  wouldInsertAgentRuns: number;
  wouldUpdateAgentRuns: number;
  unchangedAgentRuns: number;
  wouldUpsertFees: number;
  unchangedFees: number;
  wouldAppendFeeLedger: number;
}

interface StagedWork {
  plan: AgentImportPlan;
  newEvents: AgentRow[];
  changedSuggestions: AgentRow[];
  changedAgentRuns: AgentRow[];
  changedFees: AgentRow[];
  newLedgerRows: AgentRow[];
}

async function stage(
  source: AgentStoreImportSource,
  client: SupabaseAgentClient,
): Promise<StagedWork> {
  const code = source.accessCode;
  const index = async (table: Parameters<SupabaseAgentClient['selectAll']>[0], key: string) => {
    const rows = await client.selectAll(table);
    const map = new Map<string, AgentRow>();
    for (const row of rows) {
      if (row.access_code !== code) continue;
      map.set(String(row[key]), row);
    }
    return map;
  };

  const [storedEvents, storedSuggestions, storedRuns, storedFees, storedLedger] =
    await Promise.all([
      index('events', 'id'),
      index('suggestions', 'id'),
      index('agent_runs', 'id'),
      index('mandate_fees', 'job_id'),
      index('fee_ledger', 'id'),
    ]);

  const plan: AgentImportPlan = {
    accessCode: code,
    wouldInsertEvents: 0,
    unchangedEvents: 0,
    conflictingEventIds: [],
    wouldInsertSuggestions: 0,
    wouldUpdateSuggestions: 0,
    unchangedSuggestions: 0,
    wouldInsertAgentRuns: 0,
    wouldUpdateAgentRuns: 0,
    unchangedAgentRuns: 0,
    wouldUpsertFees: 0,
    unchangedFees: 0,
    wouldAppendFeeLedger: 0,
  };

  const newEvents: AgentRow[] = [];
  for (const e of source.events) {
    const row = eventRow(code, e);
    const existing = storedEvents.get(e.id);
    if (!existing) {
      plan.wouldInsertEvents += 1;
      newEvents.push(row);
    } else if (samePayload(existing, row)) {
      plan.unchangedEvents += 1;
    } else {
      plan.conflictingEventIds.push(e.id); // append-only: report, never mutate
    }
  }

  const changedSuggestions: AgentRow[] = [];
  for (const s of source.suggestions) {
    const row = suggestionRow(code, s);
    const existing = storedSuggestions.get(s.id);
    if (!existing) {
      plan.wouldInsertSuggestions += 1;
      changedSuggestions.push(row);
    } else if (samePayload(existing, row)) {
      plan.unchangedSuggestions += 1;
    } else {
      plan.wouldUpdateSuggestions += 1;
      changedSuggestions.push(row);
    }
  }

  const changedAgentRuns: AgentRow[] = [];
  for (const r of source.agentRuns) {
    const row = agentRunRow(code, r);
    const existing = storedRuns.get(r.id);
    if (!existing) {
      plan.wouldInsertAgentRuns += 1;
      changedAgentRuns.push(row);
    } else if (samePayload(existing, row)) {
      plan.unchangedAgentRuns += 1;
    } else {
      plan.wouldUpdateAgentRuns += 1;
      changedAgentRuns.push(row);
    }
  }

  const changedFees: AgentRow[] = [];
  const newLedgerRows: AgentRow[] = [];
  for (const f of source.fees) {
    const row = feeRow(code, f);
    const existing = storedFees.get(f.jobId);
    if (existing && samePayload(existing, row)) {
      plan.unchangedFees += 1;
    } else {
      plan.wouldUpsertFees += 1;
      changedFees.push(row);
    }
    // Ledger: one append per (jobId, updatedAt) fee state ever seen.
    const ledgerId = feeLedgerId(f.jobId, f.updatedAt);
    if (!storedLedger.has(ledgerId)) {
      plan.wouldAppendFeeLedger += 1;
      newLedgerRows.push({
        access_code: code,
        id: ledgerId,
        job_id: f.jobId,
        fee: f,
        recorded_at: f.updatedAt,
      });
    }
  }

  return {
    plan,
    newEvents,
    changedSuggestions,
    changedAgentRuns,
    changedFees,
    newLedgerRows,
  };
}

/** Plan the import without mutating anything. Always safe to call. */
export async function agentStoreImportDryRun(
  source: AgentStoreImportSource,
  client: SupabaseAgentClient,
): Promise<AgentImportPlan> {
  return (await stage(source, client)).plan;
}

// ------------------------------------------------------------
// Apply
// ------------------------------------------------------------

export interface AgentImportResult {
  applied: boolean;
  reason?: 'flag_off' | 'not_confirmed';
  plan: AgentImportPlan;
  insertedEvents: number;
  upsertedSuggestions: number;
  upsertedAgentRuns: number;
  upsertedFees: number;
  appendedFeeLedger: number;
  /** localStorage key holding the pre-migration destination backup. */
  backupKey?: string;
}

/**
 * Apply the staged import. Refuses (with the dry-run report intact) unless
 * the v3 flag is on AND { confirm: true } is passed. Takes an automatic
 * backup of all destination tables before the first write.
 */
export async function agentStoreImportApply(
  source: AgentStoreImportSource,
  client: SupabaseAgentClient,
  opts?: { confirm?: boolean },
): Promise<AgentImportResult> {
  const staged = await stage(source, client);
  const refused = (reason: 'flag_off' | 'not_confirmed'): AgentImportResult => ({
    applied: false,
    reason,
    plan: staged.plan,
    insertedEvents: 0,
    upsertedSuggestions: 0,
    upsertedAgentRuns: 0,
    upsertedFees: 0,
    appendedFeeLedger: 0,
  });

  if (!isV3Enabled()) return refused('flag_off');
  if (opts?.confirm !== true) return refused('not_confirmed');

  // Automatic pre-migration backup of the DESTINATION (latest-run backup,
  // same discipline as backfill D-021; the real rollback remains flag-off).
  const previous = loadV3<unknown>(AGENT_IMPORT_BACKUP_KEY, null);
  void previous; // overwritten deliberately — one latest-run backup only
  saveV3(AGENT_IMPORT_BACKUP_KEY, {
    takenAt: new Date().toISOString(),
    accessCode: source.accessCode,
    tables: {
      events: await client.selectAll('events'),
      agent_runs: await client.selectAll('agent_runs'),
      suggestions: await client.selectAll('suggestions'),
      mandate_fees: await client.selectAll('mandate_fees'),
      fee_ledger: await client.selectAll('fee_ledger'),
    },
  });

  if (staged.newEvents.length > 0) {
    await client.insert('events', staged.newEvents);
  }
  if (staged.changedSuggestions.length > 0) {
    await client.upsert('suggestions', staged.changedSuggestions);
  }
  if (staged.changedAgentRuns.length > 0) {
    await client.upsert('agent_runs', staged.changedAgentRuns);
  }
  if (staged.changedFees.length > 0) {
    await client.upsert('mandate_fees', staged.changedFees);
  }
  if (staged.newLedgerRows.length > 0) {
    await client.insert('fee_ledger', staged.newLedgerRows);
  }

  return {
    applied: true,
    plan: staged.plan,
    insertedEvents: staged.newEvents.length,
    upsertedSuggestions: staged.changedSuggestions.length,
    upsertedAgentRuns: staged.changedAgentRuns.length,
    upsertedFees: staged.changedFees.length,
    appendedFeeLedger: staged.newLedgerRows.length,
    backupKey: AGENT_IMPORT_BACKUP_KEY,
  };
}
