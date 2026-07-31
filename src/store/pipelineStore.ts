// ============================================================
// Revital V3 — Pipeline Store (Waves 1–3, platform-data)
//
// Implements the BINDING store contract in docs/waves/wave1-store-contract.md:
//   addPerson / addDeal / moveDeal / undoLast / setReplyState / logContact /
//   acceptSuggestion / dismissSuggestion / addSuggestion
//   + selectors dealsByStage / benchPersons / personById
// Wave-3 Batch A (docs/waves/wave3-tasks.md):
//   acceptSuggestion(id, opts?: { editedBody? }) edit absorption /
//   deletePersonCascade / retention (revital_v3_retention) + purgeExpired /
//   bench metadata (benchedAt, benchReason, silverMedalist) /
//   selectors benchBySilver / agentAcceptStats
//
// Additive Zustand slice. Persists ONLY under new revital_v3_* keys —
// legacy revital_* keys and appStore.ts are untouched (flag-off behavior
// byte-identical). Feature flag `revital_v3_flag` default-off.
//
// Single-writer rule (plan §3): this client path is the ONLY writer of
// card state. Agents write suggestions; acceptance flows through
// acceptSuggestion and is audited. Every mutation writes an audit entry
// (agent attribution when actor === 'ai').
// ============================================================

import { create } from 'zustand';
import {
  PIPELINE_SCHEMA_VERSION,
  PIPELINE_STAGES,
  type AgentName,
  type AuditActor,
  type AuditEvent,
  type ContactEvent,
  type Deal,
  type DealStage,
  type FeeTerms,
  type Person,
  type PipelineMeta,
  type PipelineStage,
  type PipelineSyncPayload,
  type StageEvent,
  type StageEventActor,
  type Suggestion,
  type SuggestionEvidence,
  type Versioned,
} from '../types/pipeline';
import {
  AUDIT_MAX_EVENTS,
  STAGE_EVENTS_MAX,
  V3_KEYS,
  isV3Enabled,
  loadRetentionMonths,
  loadV3,
  normalizeRetentionMonths,
  saveV3,
  setV3Enabled,
} from '../lib/persistence/keys';
import { clientPullMerge, tombstone } from '../lib/persistence/merge';
import { findDuplicatePerson, normalizeName } from '../lib/persistence/dedupe';
import type { ContactChannel, ContactLogger } from '../lib/outreach';

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** All board stages: nine pipeline columns + Bench rail + Rejected. */
export const ALL_DEAL_STAGES: DealStage[] = [
  ...PIPELINE_STAGES,
  'Bench',
  'Rejected',
];

const AGENT_NAMES: readonly AgentName[] = [
  'screener',
  'bench_sourcer',
  'outreach_runner',
  'client_reporter',
  'pit_boss',
];

function asAgentName(value: string | undefined, fallback: AgentName): AgentName {
  return value && (AGENT_NAMES as readonly string[]).includes(value)
    ? (value as AgentName)
    : fallback;
}

/** Pipeline stages strictly between `from` and `to` (skip-event support). */
export function computeSkippedStages(
  from: DealStage | null,
  to: DealStage,
): PipelineStage[] {
  if (from === null) return [];
  const fromIdx = PIPELINE_STAGES.indexOf(from as PipelineStage);
  const toIdx = PIPELINE_STAGES.indexOf(to as PipelineStage);
  if (fromIdx === -1 || toIdx === -1 || toIdx <= fromIdx + 1) return [];
  return PIPELINE_STAGES.slice(fromIdx + 1, toIdx) as unknown as PipelineStage[];
}

// ------------------------------------------------------------
// Wave-3 riding-ahead types (store-owned — types/pipeline.ts is
// lead-owned; these fields ride the persisted JSON ahead of the
// type, the D-018 pattern).
// ------------------------------------------------------------

/**
 * TODO(lead): hoist into Person['bench'] in types/pipeline.ts —
 * adds benchedAt / benchReason / silverMedalist to the bench entry.
 * `reason`/`since` are kept as-is so all existing readers keep working;
 * the new names are the Wave-3 contract surface for the Bench rail.
 */
export interface BenchMeta {
  reason: string;
  since: string;
  /** ISO — when the person was (last) filed on the Bench. */
  benchedAt: string;
  /** Why the person is benched (mirrors `reason`, contract name). */
  benchReason: string;
  /** True when a deal of this person reached Submitted+ before Rejected. */
  silverMedalist: boolean;
}

/** Person as persisted once benched via the Wave-3 path. */
export type PersonWithBenchMeta = Person & { bench?: BenchMeta };

/**
 * TODO(lead): hoist `editedBeforeAccept?: boolean` into Suggestion in
 * types/pipeline.ts. Stamped by acceptSuggestion at accept time; read by
 * src/lib/metrics/leadingIndicators.ts (suggestionEditRate, D-029).
 */
export type SuggestionWithEditMarker = Suggestion & {
  editedBeforeAccept?: boolean;
};

/** Pipeline stages counted as "Submitted or later" for silver-medalist. */
const SUBMITTED_PLUS: ReadonlySet<string> = new Set(
  PIPELINE_STAGES.slice(PIPELINE_STAGES.indexOf('Submitted')),
);

/**
 * Silver medalist (Wave-3 contract): at bench time, some deal of the person
 * reached Submitted+ BEFORE entering Rejected — the candidate went deep and
 * lost late, so they are premium bench inventory.
 *
 * - When the current move IS the rejection (movingTo === 'Rejected'), the
 *   moving deal's own history counts, including its current `movingFrom`
 *   stage (robust to StageEvent rotation).
 * - Deals already Rejected count when their event history shows a
 *   Submitted+ entry before the rejection event (or any Submitted+ entry
 *   when the rejection event itself was rotated out).
 * - A deal that reached Submitted+ but was never rejected does NOT make a
 *   silver medalist — it is still in play (or placed), not "lost late".
 */
export function computeSilverMedalist(args: {
  personId: string;
  deals: Deal[];
  stageEvents: StageEvent[];
  movingDealId?: string;
  movingFrom?: DealStage;
  movingTo?: DealStage;
}): boolean {
  const personDeals = args.deals.filter((d) => d.personId === args.personId);
  for (const deal of personDeals) {
    const isMoving = deal.id === args.movingDealId;
    const events = args.stageEvents
      .filter((e) => e.dealId === deal.id && !e.deleted)
      .sort((a, b) => a.ts.localeCompare(b.ts));

    // Where does this deal's rejection sit (if anywhere)?
    const rejectionIdx = events.findIndex((e) => e.to === 'Rejected');
    const rejectedNow = isMoving && args.movingTo === 'Rejected';
    const wasRejected =
      rejectionIdx !== -1 || rejectedNow || deal.stage === 'Rejected' || !!deal.rejection;
    if (!wasRejected) continue;

    // History considered "before the rejection".
    const before = rejectionIdx !== -1 ? events.slice(0, rejectionIdx) : events;
    const reached =
      before.some((e) => SUBMITTED_PLUS.has(e.to)) ||
      (rejectedNow && !!args.movingFrom && SUBMITTED_PLUS.has(args.movingFrom));
    if (reached) return true;
  }
  return false;
}

// ------------------------------------------------------------
// Contract input types (store-owned — types/pipeline.ts is lead-owned
// as of Wave 1; the lead may hoist these later).
// ------------------------------------------------------------

export interface PersonInput {
  /** Optional deterministic id (screener/backfill idempotency). */
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  linkedinUrl?: string;
  analysisIds?: string[];
  notes?: string;
  /** Audit attribution. Default 'human'. */
  actor?: AuditActor;
  /** Agent name for audit chips when actor === 'ai'. */
  agent?: string;
}

export interface DealInput {
  /** Optional deterministic id (screener/backfill idempotency). */
  id?: string;
  personId: string;
  jobId: string;
  jobTitle: string;
  /** Defaults to 'Sourced'; a later entry stage logs a skip StageEvent. */
  stage?: DealStage;
  fee?: FeeTerms;
  analysisId?: string;
  nextAction?: Deal['nextAction'];
  /** Audit attribution. Default 'human'. */
  actor?: AuditActor;
  agent?: string;
}

export interface SuggestionInput {
  id?: string;
  agent: AgentName;
  kind: Suggestion['kind'];
  dealId?: string;
  personId?: string;
  title: string;
  body: string;
  evidence?: SuggestionEvidence[];
  createdAt?: string;
}

export type ReplyState = 'replied' | 'no_reply' | 'meeting_set';

export interface AddPersonResult {
  /** The resolved Person: existing (exact dedupe hit) or newly created. */
  person: Person;
  /**
   * Set when dedupe found a match:
   * - exact hit  → the pre-merge existing Person (person === merged existing);
   * - name-only  → the colliding Person (person is NEW; a 'merge_person'
   *   Suggestion was filed — never auto-merged, D-014).
   * Absent ⇒ a brand-new Person with no collision.
   */
  duplicateOf?: Person;
}

/** In-memory undo snapshot (not persisted — undo is a same-session affordance). */
export interface UndoEntry {
  action: 'deal.move' | 'suggestion.accept' | 'person.cascade_delete';
  deals: Deal[];
  persons: Person[];
  suggestions: Suggestion[];
  /** Pre-cascade StageEvent snapshots (cascade undo restores them live). */
  stageEvents?: StageEvent[];
  /** Present for moves — drives the compensating StageEvent on undo. */
  move?: { dealId: string; from: DealStage; to: DealStage };
  entityType: string;
  entityId: string;
}

/** What deletePersonCascade tombstoned (ids), for UI feedback + tests. */
export interface CascadeResult {
  personId: string;
  dealIds: string[];
  suggestionIds: string[];
  stageEventIds: string[];
  benchPurged: boolean;
}

/** What purgeExpired physically removed. */
export interface PurgeResult {
  /** ISO cutoff used, or null when retention is off (no-op). */
  cutoff: string | null;
  persons: number;
  deals: number;
  suggestions: number;
  stageEvents: number;
  /** Audit entries scrubbed because they referenced purged records. */
  auditEntries: number;
}

/** Accept/dismiss tallies for one agent — Bench Sourcer throttle input. */
export interface AgentAcceptStats {
  agent: AgentName;
  accepted: number;
  dismissed: number;
  pending: number;
  /** accepted + dismissed. */
  resolved: number;
  /** accepted / resolved; null when nothing resolved — never a fake 0. */
  acceptRate: number | null;
}

/** Bench rail grouping: silver medalists first-class, the rest after. */
export interface BenchBySilver {
  silver: PersonWithBenchMeta[];
  others: PersonWithBenchMeta[];
}

const UNDO_STACK_MAX = 20;

export interface PipelineState {
  // Feature flag (revital_v3_flag, default off)
  v3Enabled: boolean;
  setV3Flag: (on: boolean) => void;

  schemaVersion: number;
  meta: PipelineMeta;

  persons: Person[];
  deals: Deal[];
  stageEvents: StageEvent[];
  suggestions: Suggestion[];
  auditLog: AuditEvent[];
  undoStack: UndoEntry[];

  /** ids with local edits not yet accepted by the server (client-only). */
  dirtyIds: Record<'persons' | 'deals' | 'events' | 'suggestions', string[]>;

  // ---- Wave-1 contract (docs/waves/wave1-store-contract.md, BINDING) ----
  addPerson: (input: PersonInput) => AddPersonResult;
  addDeal: (input: DealInput) => Deal;
  moveDeal: (
    dealId: string,
    toStage: DealStage,
    opts?: { reason?: string; actor?: AuditActor; agent?: string },
  ) => StageEvent | null;
  undoLast: () => boolean;
  setReplyState: (personId: string, state: ReplyState, ts?: string) => void;
  logContact: (
    personId: string,
    channel: ContactChannel,
    messageHash: string,
    ts?: string,
  ) => void;
  /**
   * Accept a pending suggestion. Wave-3 absorption of the kanban-ui
   * pre-patch (D-033 FIX): `opts.editedBody`, when provided and different
   * from the current body, replaces the body (the wa.me glue then renders
   * the EDITED text) and stamps `editedBeforeAccept: true` plus a human
   * 'suggestion.edit' audit entry; providing opts without an effective edit
   * stamps `false`. A no-opts call = not edited (stamps `false`) — except
   * that a marker already riding the record (the legacy pre-patch path) is
   * preserved, so acceptDraft.ts keeps working until kanban-ui re-points.
   * Returns false (zero mutation) for missing/resolved/tombstoned ids.
   */
  acceptSuggestion: (id: string, opts?: { editedBody?: string }) => boolean;
  dismissSuggestion: (id: string) => boolean;
  addSuggestion: (input: SuggestionInput) => Suggestion;

  // ---- Wave-3 Batch A (docs/waves/wave3-tasks.md) ----
  /**
   * Deletion cascade (contract): tombstones the Person, its deals, its
   * suggestions (incl. evidence references), its deals' StageEvents, and
   * purges the bench entry — client path, tombstone-only, one audit entry,
   * one-click undoable. Refuses (null, zero mutation) without confirm:true.
   */
  deletePersonCascade: (
    personId: string,
    opts: { confirm: boolean; actor?: AuditActor },
  ) => CascadeResult | null;
  /** Retention window in months; null = off (default). */
  retentionMonths: number | null;
  setRetentionMonths: (months: number | null) => void;
  /**
   * Physically removes tombstones whose deletedAt is older than the
   * retention window, plus audit entries referencing the purged records
   * (their before/after snapshots carry PII). No-op when retention is off.
   */
  purgeExpired: (now?: string | Date) => PurgeResult;

  // Selectors (also exported as plain functions below)
  dealsByStage: () => Record<DealStage, Deal[]>;
  benchPersons: () => Person[];
  personById: (id: string) => Person | undefined;
  benchBySilver: () => BenchBySilver;
  agentAcceptStats: (agent: AgentName) => AgentAcceptStats;

  // ---- Wave-0 API (kept for compatibility) ----
  upsertPerson: (
    person: Omit<Person, 'v' | 'updatedAt'> & Partial<Pick<Person, 'v' | 'updatedAt'>>,
    actor?: AuditActor,
  ) => void;
  deletePerson: (id: string, actor?: AuditActor) => void;
  upsertDeal: (
    deal: Omit<Deal, 'v' | 'updatedAt'> & Partial<Pick<Deal, 'v' | 'updatedAt'>>,
    actor?: AuditActor,
  ) => void;
  /** @deprecated Wave-0 name — delegates to the same engine as moveDeal. */
  moveDealStage: (
    dealId: string,
    to: DealStage,
    opts?: { actor?: StageEventActor; reason?: string },
  ) => void;
  deleteDeal: (id: string, actor?: AuditActor) => void;
  /** @deprecated Use acceptSuggestion / dismissSuggestion. */
  resolveSuggestion: (id: string, status: 'accepted' | 'dismissed') => void;

  // Audit (append-only, client rotation last N≈500)
  appendAudit: (e: Omit<AuditEvent, 'id' | 'ts'> & { id?: string; ts?: string }) => void;

  // Sync plumbing (network wiring: src/lib/persistence/sync.ts)
  buildPushPayload: () => PipelineSyncPayload;
  applyRemote: (remote: Partial<PipelineSyncPayload>) => void;
  markSynced: (at?: string) => void;
}

const initialMeta: PipelineMeta = loadV3<PipelineMeta>(V3_KEYS.meta, {
  schemaVersion: PIPELINE_SCHEMA_VERSION,
  lastSyncAt: null,
});

function pushDirty(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id];
}

export const usePipelineStore = create<PipelineState>((set, get) => {
  /**
   * Shared move engine behind moveDeal (contract) and moveDealStage (Wave-0).
   * Refusals return null without mutation: unknown/tombstoned deal, same-stage
   * no-op, and Rejected without a reason (plan §2 — the UI owns prompting).
   */
  const performMove = (
    dealId: string,
    to: DealStage,
    opts: {
      reason?: string;
      auditActor: AuditActor;
      stageActor: StageEventActor;
      agent?: string;
    },
  ): StageEvent | null => {
    const s = get();
    const deal = s.deals.find((d) => d.id === dealId);
    if (!deal || deal.deleted) return null;
    if (deal.stage === to) return null;
    if (to === 'Rejected' && !opts.reason) return null;

    const ts = nowIso();
    const nextDeal: Deal = {
      ...deal,
      stage: to,
      stageEnteredAt: ts, // aging rings render from this — updated on EVERY move
      updatedAt: ts,
      ...(to === 'Rejected' && opts.reason
        ? { rejection: { reason: opts.reason, ts } }
        : {}),
    };

    // Rejected files the Person to the Bench rail (contract); explicit Bench
    // moves bench the person too, so benchPersons() stays truthful.
    let persons = s.persons;
    let benchedPerson: Person | null = null;
    let priorPerson: Person | null = null;
    if (to === 'Rejected' || to === 'Bench') {
      const p = s.persons.find((x) => x.id === deal.personId && !x.deleted);
      if (p) {
        priorPerson = p;
        // Wave-3 bench metadata: benchedAt / benchReason / silverMedalist
        // (was Submitted+ before Rejected). Re-benching refreshes the
        // timestamp/reason but never downgrades an earned silver medal.
        const priorBench = (p as PersonWithBenchMeta).bench;
        const silver =
          computeSilverMedalist({
            personId: p.id,
            deals: s.deals,
            stageEvents: s.stageEvents,
            movingDealId: deal.id,
            movingFrom: deal.stage,
            movingTo: to,
          }) || priorBench?.silverMedalist === true;
        const reason = opts.reason ?? 'bench';
        const benchMeta: BenchMeta = {
          reason,
          since: ts,
          benchedAt: ts,
          benchReason: reason,
          silverMedalist: silver,
        };
        benchedPerson = { ...p, bench: benchMeta, updatedAt: ts };
        persons = s.persons.map((x) => (x.id === p.id ? benchedPerson! : x));
      }
    }

    const event: StageEvent = {
      id: makeId(),
      v: 0,
      updatedAt: ts,
      dealId,
      from: deal.stage,
      to,
      ts,
      actor: opts.stageActor,
      skippedStages: computeSkippedStages(deal.stage, to),
      ...(opts.reason ? { reason: opts.reason } : {}),
    };

    const deals = s.deals.map((d) => (d.id === dealId ? nextDeal : d));
    const stageEvents = [...s.stageEvents, event].slice(-STAGE_EVENTS_MAX);

    const undoEntry: UndoEntry = {
      action: 'deal.move',
      deals: [deal],
      persons: priorPerson ? [priorPerson] : [],
      suggestions: [],
      move: { dealId, from: deal.stage, to },
      entityType: 'deal',
      entityId: dealId,
    };

    saveV3(V3_KEYS.deals, deals);
    saveV3(V3_KEYS.events, stageEvents);
    if (benchedPerson) saveV3(V3_KEYS.persons, persons);
    set((st) => ({
      deals,
      stageEvents,
      persons,
      undoStack: [...st.undoStack, undoEntry].slice(-UNDO_STACK_MAX),
      dirtyIds: {
        ...st.dirtyIds,
        deals: pushDirty(st.dirtyIds.deals, dealId),
        events: pushDirty(st.dirtyIds.events, event.id),
        persons: benchedPerson
          ? pushDirty(st.dirtyIds.persons, benchedPerson.id)
          : st.dirtyIds.persons,
      },
    }));
    get().appendAudit({
      actor: opts.auditActor,
      ...(opts.auditActor === 'ai' && opts.agent ? { agent: opts.agent } : {}),
      action: 'deal.move',
      before: { stage: deal.stage },
      after: { stage: to, skippedStages: event.skippedStages },
      entityType: 'deal',
      entityId: dealId,
    });
    return event;
  };

  const applySuggestionResolution = (
    id: string,
    status: 'accepted' | 'dismissed',
    opts?: { editedBody?: string },
  ): boolean => {
    const s = get();
    const sug = s.suggestions.find((x) => x.id === id) as
      | SuggestionWithEditMarker
      | undefined;
    if (!sug || sug.status !== 'pending' || sug.deleted) return false;
    const ts = nowIso();

    // Edit-before-accept absorption (D-033 FIX → Wave-3). Semantics match
    // the retired kanban-ui pre-patch: an editedBody different from the
    // current body replaces it and stamps true; otherwise the accept stamps
    // false. A legacy no-opts call preserves a marker the pre-patch already
    // rode on the record (compat until kanban-ui re-points in Batch B).
    const edited =
      status === 'accepted' &&
      opts?.editedBody !== undefined &&
      opts.editedBody !== sug.body;
    const marker =
      opts !== undefined
        ? edited
        : typeof sug.editedBeforeAccept === 'boolean'
          ? sug.editedBeforeAccept
          : false;
    if (edited) {
      // Human edit audit BEFORE the accept entry — same order as the
      // pre-patch helper (append-only log stays chronologically truthful).
      get().appendAudit({
        actor: 'human',
        action: 'suggestion.edit',
        before: { body: sug.body },
        after: { body: opts!.editedBody, editedBeforeAccept: true },
        entityType: 'suggestion',
        entityId: id,
      });
    }

    const nextSug: SuggestionWithEditMarker = {
      ...sug,
      ...(edited ? { body: opts!.editedBody! } : {}),
      ...(status === 'accepted' ? { editedBeforeAccept: marker } : {}),
      status,
      resolvedAt: ts,
      updatedAt: ts,
    };

    // Accepting is the ONLY path where agent output mutates card state
    // (single-writer via client). Wave-1 applied effects: 'next_action'
    // stamps the deal's next-action line. Draft messages are rendered by
    // the UI from the accepted suggestion; merge_person application ships
    // with its dedicated merge UI (D-019).
    let deals = s.deals;
    let touchedDeal: Deal | null = null;
    let priorDeal: Deal | null = null;
    if (status === 'accepted' && sug.kind === 'next_action' && sug.dealId) {
      const deal = s.deals.find((d) => d.id === sug.dealId && !d.deleted);
      if (deal) {
        priorDeal = deal;
        touchedDeal = {
          ...deal,
          nextAction: { label: sug.title, owner: 'revital' },
          updatedAt: ts,
        };
        deals = s.deals.map((d) => (d.id === deal.id ? touchedDeal! : d));
      }
    }

    const suggestions = s.suggestions.map((x) => (x.id === id ? nextSug : x));
    saveV3(V3_KEYS.suggestions, suggestions);
    if (touchedDeal) saveV3(V3_KEYS.deals, deals);

    const undoEntry: UndoEntry | null =
      status === 'accepted'
        ? {
            action: 'suggestion.accept',
            deals: priorDeal ? [priorDeal] : [],
            persons: [],
            suggestions: [sug],
            entityType: 'suggestion',
            entityId: id,
          }
        : null;

    set((st) => ({
      suggestions,
      deals,
      undoStack: undoEntry
        ? [...st.undoStack, undoEntry].slice(-UNDO_STACK_MAX)
        : st.undoStack,
      dirtyIds: {
        ...st.dirtyIds,
        suggestions: pushDirty(st.dirtyIds.suggestions, id),
        deals: touchedDeal
          ? pushDirty(st.dirtyIds.deals, touchedDeal.id)
          : st.dirtyIds.deals,
      },
    }));
    get().appendAudit({
      actor: 'human',
      action: `suggestion.${status}`,
      before: sug,
      after: nextSug,
      entityType: 'suggestion',
      entityId: id,
    });
    return true;
  };

  const appendContactEvent = (
    personId: string,
    event: ContactEvent,
    action: string,
    extra?: Record<string, unknown>,
  ): void => {
    const s = get();
    const person = s.persons.find((p) => p.id === personId && !p.deleted);
    if (!person) return;
    const next: Person = {
      ...person,
      contactEvents: [...person.contactEvents, event],
      updatedAt: nowIso(),
    };
    const persons = s.persons.map((p) => (p.id === personId ? next : p));
    saveV3(V3_KEYS.persons, persons);
    set((st) => ({
      persons,
      dirtyIds: { ...st.dirtyIds, persons: pushDirty(st.dirtyIds.persons, personId) },
    }));
    get().appendAudit({
      actor: 'human',
      action,
      before: null,
      after: { ...event, ...extra },
      entityType: 'person',
      entityId: personId,
    });
  };

  return {
    v3Enabled: isV3Enabled(),
    setV3Flag: (on) => {
      setV3Enabled(on);
      set({ v3Enabled: on });
    },

    schemaVersion: PIPELINE_SCHEMA_VERSION,
    meta: initialMeta,

    persons: loadV3<Person[]>(V3_KEYS.persons, []),
    deals: loadV3<Deal[]>(V3_KEYS.deals, []),
    stageEvents: loadV3<StageEvent[]>(V3_KEYS.events, []),
    suggestions: loadV3<Suggestion[]>(V3_KEYS.suggestions, []),
    auditLog: loadV3<AuditEvent[]>(V3_KEYS.audit, []),
    undoStack: [],

    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },

    // ---- Wave-1 contract ----

    addPerson: (input) => {
      const actor = input.actor ?? 'human';
      const s = get();
      const match = findDuplicatePerson(s.persons, {
        name: input.name,
        phone: input.phone,
        email: input.email,
      });
      const ts = nowIso();

      if (match?.kind === 'exact') {
        // Safe dedupe hit: attach additively to the existing Person.
        const ex = match.person;
        const merged: Person = {
          ...ex,
          phone: ex.phone ?? input.phone,
          email: ex.email ?? input.email,
          linkedinUrl: ex.linkedinUrl ?? input.linkedinUrl,
          analysisIds: Array.from(
            new Set([...ex.analysisIds, ...(input.analysisIds ?? [])]),
          ),
          notes: ex.notes ?? input.notes,
          updatedAt: ts,
        };
        const persons = s.persons.map((p) => (p.id === ex.id ? merged : p));
        saveV3(V3_KEYS.persons, persons);
        set((st) => ({
          persons,
          dirtyIds: {
            ...st.dirtyIds,
            persons: pushDirty(st.dirtyIds.persons, ex.id),
          },
        }));
        get().appendAudit({
          actor,
          ...(actor === 'ai' && input.agent ? { agent: input.agent } : {}),
          action: 'person.update',
          before: ex,
          after: merged,
          entityType: 'person',
          entityId: ex.id,
        });
        return { person: merged, duplicateOf: ex };
      }

      const person: Person = {
        id: input.id ?? makeId(),
        v: 0,
        updatedAt: ts,
        name: input.name,
        normalizedName: normalizeName(input.name),
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(input.linkedinUrl ? { linkedinUrl: input.linkedinUrl } : {}),
        analysisIds: input.analysisIds ?? [],
        contactEvents: [],
        ...(input.notes ? { notes: input.notes } : {}),
      };
      const persons = [...s.persons, person];
      saveV3(V3_KEYS.persons, persons);
      set((st) => ({
        persons,
        dirtyIds: {
          ...st.dirtyIds,
          persons: pushDirty(st.dirtyIds.persons, person.id),
        },
      }));
      get().appendAudit({
        actor,
        ...(actor === 'ai' && input.agent ? { agent: input.agent } : {}),
        action: 'person.create',
        before: null,
        after: person,
        entityType: 'person',
        entityId: person.id,
      });

      if (match?.kind === 'name_only') {
        // Ambiguous collision: create AND flag — never auto-merge (D-014).
        const alreadyFlagged = get().suggestions.some(
          (x) =>
            x.kind === 'merge_person' &&
            x.status === 'pending' &&
            x.evidence.some((e) => e.sourceId === match.person.id) &&
            x.title.includes(input.name),
        );
        if (!alreadyFlagged) {
          get().addSuggestion({
            agent: asAgentName(input.agent, 'screener'),
            kind: 'merge_person',
            personId: person.id,
            title: `כפילות אפשרית: ${input.name}`,
            body: `נוצר מועמד חדש בשם "${input.name}" אך קיים כבר מועמד עם שם זהה. יש לבדוק אם מדובר באותו אדם ולמזג במידת הצורך.`,
            evidence: [
              {
                claim: `שם זהה לאחר נרמול: "${match.person.name}"`,
                sourceType: 'person',
                sourceId: match.person.id,
              },
              {
                claim: `המועמד החדש: "${person.name}"`,
                sourceType: 'person',
                sourceId: person.id,
              },
            ],
          });
        }
        return { person, duplicateOf: match.person };
      }

      return { person };
    },

    addDeal: (input) => {
      const s = get();
      // Deterministic-id idempotency: an existing deal is returned untouched
      // (screener/backfill can safely re-run).
      if (input.id) {
        const existing = s.deals.find((d) => d.id === input.id);
        if (existing) return existing;
      }
      const person = s.persons.find((p) => p.id === input.personId && !p.deleted);
      if (!person) {
        throw new Error(`addDeal: unknown personId "${input.personId}"`);
      }
      const actor = input.actor ?? 'human';
      const stage = input.stage ?? 'Sourced';
      const ts = nowIso();
      const deal: Deal = {
        id: input.id ?? makeId(),
        v: 0,
        updatedAt: ts,
        personId: input.personId,
        jobId: input.jobId,
        jobTitle: input.jobTitle,
        stage,
        stageEnteredAt: ts,
        ...(input.fee ? { fee: input.fee } : {}),
        ...(input.nextAction ? { nextAction: input.nextAction } : {}),
        ...(input.analysisId ? { analysisId: input.analysisId } : {}),
        createdAt: ts,
      };
      // Creation StageEvent (from: null). Entry at a later pipeline stage
      // records every stage the deal never sat in as skipped.
      const stageIdx = PIPELINE_STAGES.indexOf(stage as PipelineStage);
      const event: StageEvent = {
        id: makeId(),
        v: 0,
        updatedAt: ts,
        dealId: deal.id,
        from: null,
        to: stage,
        ts,
        actor: actor === 'ai' ? 'agent' : 'human',
        skippedStages: stageIdx > 0 ? [...PIPELINE_STAGES.slice(0, stageIdx)] : [],
      };
      const deals = [...s.deals, deal];
      const stageEvents = [...s.stageEvents, event].slice(-STAGE_EVENTS_MAX);
      saveV3(V3_KEYS.deals, deals);
      saveV3(V3_KEYS.events, stageEvents);
      set((st) => ({
        deals,
        stageEvents,
        dirtyIds: {
          ...st.dirtyIds,
          deals: pushDirty(st.dirtyIds.deals, deal.id),
          events: pushDirty(st.dirtyIds.events, event.id),
        },
      }));
      get().appendAudit({
        actor,
        ...(actor === 'ai' && input.agent ? { agent: input.agent } : {}),
        action: 'deal.create',
        before: null,
        after: deal,
        entityType: 'deal',
        entityId: deal.id,
      });
      return deal;
    },

    moveDeal: (dealId, toStage, opts) =>
      performMove(dealId, toStage, {
        reason: opts?.reason,
        auditActor: opts?.actor ?? 'human',
        stageActor: (opts?.actor ?? 'human') === 'ai' ? 'agent' : 'human',
        agent: opts?.agent,
      }),

    undoLast: () => {
      const { undoStack } = get();
      const entry = undoStack[undoStack.length - 1];
      if (!entry) return false;
      const ts = nowIso();
      set({ undoStack: undoStack.slice(0, -1) });

      const s = get();
      let deals = s.deals;
      let persons = s.persons;
      let suggestions = s.suggestions;
      let stageEvents = s.stageEvents;
      const restoredIds: string[] = [];
      let dirty = s.dirtyIds;

      // Restore snapshots. Keep the CURRENT record's v (latest known server
      // version) so the restore is an ordinary LWW edit, never a stale write.
      for (const snap of entry.deals) {
        deals = deals.map((d) =>
          d.id === snap.id ? { ...snap, v: d.v, updatedAt: ts } : d,
        );
        dirty = { ...dirty, deals: pushDirty(dirty.deals, snap.id) };
        restoredIds.push(snap.id);
      }
      for (const snap of entry.persons) {
        persons = persons.map((p) =>
          p.id === snap.id ? { ...snap, v: p.v, updatedAt: ts } : p,
        );
        dirty = { ...dirty, persons: pushDirty(dirty.persons, snap.id) };
        restoredIds.push(snap.id);
      }
      for (const snap of entry.suggestions) {
        suggestions = suggestions.map((x) =>
          x.id === snap.id ? { ...snap, v: x.v, updatedAt: ts } : x,
        );
        dirty = { ...dirty, suggestions: pushDirty(dirty.suggestions, snap.id) };
        restoredIds.push(snap.id);
      }
      // Cascade undo: pre-cascade StageEvent snapshots come back live.
      for (const snap of entry.stageEvents ?? []) {
        stageEvents = stageEvents.map((e) =>
          e.id === snap.id ? { ...snap, v: e.v, updatedAt: ts } : e,
        );
        dirty = { ...dirty, events: pushDirty(dirty.events, snap.id) };
        restoredIds.push(snap.id);
      }

      // Undoing a move logs a compensating StageEvent — history stays
      // append-only and truthful.
      if (entry.move) {
        const ev: StageEvent = {
          id: makeId(),
          v: 0,
          updatedAt: ts,
          dealId: entry.move.dealId,
          from: entry.move.to,
          to: entry.move.from,
          ts,
          actor: 'system',
          skippedStages: [],
          reason: 'undo',
        };
        stageEvents = [...stageEvents, ev].slice(-STAGE_EVENTS_MAX);
        dirty = { ...dirty, events: pushDirty(dirty.events, ev.id) };
      }

      saveV3(V3_KEYS.deals, deals);
      saveV3(V3_KEYS.persons, persons);
      saveV3(V3_KEYS.suggestions, suggestions);
      saveV3(V3_KEYS.events, stageEvents);
      set({ deals, persons, suggestions, stageEvents, dirtyIds: dirty });
      get().appendAudit({
        actor: 'human',
        action: 'undo',
        before: { undone: entry.action },
        after: { restored: restoredIds },
        entityType: entry.entityType,
        entityId: entry.entityId,
      });
      return true;
    },

    setReplyState: (personId, state, ts) => {
      appendContactEvent(
        personId,
        { kind: state, ts: ts ?? nowIso() },
        'person.reply_state',
      );
    },

    logContact: (personId, channel, messageHash, ts) => {
      // `channel` rides the persisted JSON ahead of the type (D-018) so no
      // data is lost while ContactEvent gains the field.
      const event = {
        kind: 'contacted',
        ts: ts ?? nowIso(),
        messageHash,
        channel,
      } as ContactEvent;
      appendContactEvent(personId, event, 'person.contact', { channel });
    },

    acceptSuggestion: (id, opts) => applySuggestionResolution(id, 'accepted', opts),
    dismissSuggestion: (id) => applySuggestionResolution(id, 'dismissed'),

    addSuggestion: (input) => {
      const s = get();
      const next: Suggestion = {
        id: input.id ?? makeId(),
        v: 0,
        updatedAt: nowIso(),
        agent: input.agent,
        kind: input.kind,
        ...(input.dealId ? { dealId: input.dealId } : {}),
        ...(input.personId ? { personId: input.personId } : {}),
        title: input.title,
        body: input.body,
        evidence: input.evidence ?? [],
        status: 'pending',
        createdAt: input.createdAt ?? nowIso(),
      };
      const updated = [...s.suggestions.filter((x) => x.id !== next.id), next];
      saveV3(V3_KEYS.suggestions, updated);
      set((st) => ({
        suggestions: updated,
        dirtyIds: {
          ...st.dirtyIds,
          suggestions: pushDirty(st.dirtyIds.suggestions, next.id),
        },
      }));
      get().appendAudit({
        actor: 'ai',
        agent: input.agent,
        action: 'suggestion.create',
        before: null,
        after: next,
        entityType: 'suggestion',
        entityId: next.id,
      });
      return next;
    },

    // ---- Wave-3 Batch A: deletion cascade + retention ----

    deletePersonCascade: (personId, opts) => {
      // Explicit confirm gate — a cascade is never an accidental call.
      if (opts?.confirm !== true) return null;
      const s = get();
      const person = s.persons.find((p) => p.id === personId);
      if (!person || person.deleted) return null;
      const ts = nowIso();
      const actor = opts.actor ?? 'human';

      // Everything referencing the person — directly (personId), through
      // its deals (dealId), or through suggestion evidence (sourceId).
      // ALL of the person's deal ids count, tombstoned ones included: a
      // live suggestion pointing at an old tombstoned deal still leads
      // back to the person.
      const allDealIds = new Set(
        s.deals.filter((d) => d.personId === personId).map((d) => d.id),
      );
      const liveDeals = s.deals.filter(
        (d) => d.personId === personId && !d.deleted,
      );
      const liveSugs = s.suggestions.filter(
        (x) =>
          !x.deleted &&
          (x.personId === personId ||
            (!!x.dealId && allDealIds.has(x.dealId)) ||
            x.evidence.some(
              (e) => e.sourceId === personId || allDealIds.has(e.sourceId),
            )),
      );
      const liveEvents = s.stageEvents.filter(
        (e) => !e.deleted && allDealIds.has(e.dealId),
      );

      // Tombstone-only (contract): nothing is physically removed here —
      // purgeExpired owns physical removal under the retention window.
      // The person's bench entry is purged off the tombstone; contacts are
      // embedded on the person and die with it (live views filter tombstones).
      const nextPerson = tombstone(person, ts) as PersonWithBenchMeta;
      delete nextPerson.bench;
      const dealIds = liveDeals.map((d) => d.id);
      const suggestionIds = liveSugs.map((x) => x.id);
      const stageEventIds = liveEvents.map((e) => e.id);
      const dealIdSet = new Set(dealIds);
      const sugIdSet = new Set(suggestionIds);
      const eventIdSet = new Set(stageEventIds);

      const persons = s.persons.map((p) =>
        p.id === personId ? (nextPerson as Person) : p,
      );
      const deals = s.deals.map((d) =>
        dealIdSet.has(d.id) ? tombstone(d, ts) : d,
      );
      const suggestions = s.suggestions.map((x) =>
        sugIdSet.has(x.id) ? tombstone(x, ts) : x,
      );
      const stageEvents = s.stageEvents.map((e) =>
        eventIdSet.has(e.id) ? tombstone(e, ts) : e,
      );

      // One-click undo: full pre-cascade snapshots (safety rail).
      const undoEntry: UndoEntry = {
        action: 'person.cascade_delete',
        persons: [person],
        deals: liveDeals,
        suggestions: liveSugs,
        stageEvents: liveEvents,
        entityType: 'person',
        entityId: personId,
      };

      saveV3(V3_KEYS.persons, persons);
      saveV3(V3_KEYS.deals, deals);
      saveV3(V3_KEYS.suggestions, suggestions);
      saveV3(V3_KEYS.events, stageEvents);
      set((st) => ({
        persons,
        deals,
        suggestions,
        stageEvents,
        undoStack: [...st.undoStack, undoEntry].slice(-UNDO_STACK_MAX),
        dirtyIds: {
          persons: pushDirty(st.dirtyIds.persons, personId),
          deals: dealIds.reduce(pushDirty, st.dirtyIds.deals),
          suggestions: suggestionIds.reduce(pushDirty, st.dirtyIds.suggestions),
          events: stageEventIds.reduce(pushDirty, st.dirtyIds.events),
        },
      }));
      // One summary audit entry (id lists, not N entries) — a wide cascade
      // must not flush the 500-entry rotation window.
      const benchPurged = !!(person as PersonWithBenchMeta).bench;
      get().appendAudit({
        actor,
        action: 'person.cascade_delete',
        before: person,
        after: {
          deleted: true,
          deletedAt: ts,
          cascade: { dealIds, suggestionIds, stageEventIds, benchPurged },
        },
        entityType: 'person',
        entityId: personId,
      });
      return { personId, dealIds, suggestionIds, stageEventIds, benchPurged };
    },

    retentionMonths: loadRetentionMonths(),

    setRetentionMonths: (months) => {
      const next = normalizeRetentionMonths(months);
      const prev = get().retentionMonths;
      if (next === prev) return;
      saveV3(V3_KEYS.retention, next);
      set({ retentionMonths: next });
      get().appendAudit({
        actor: 'human',
        action: 'settings.retention',
        before: { retentionMonths: prev },
        after: { retentionMonths: next },
        entityType: 'settings',
        entityId: 'retention',
      });
    },

    purgeExpired: (now) => {
      const months = get().retentionMonths;
      const empty: PurgeResult = {
        cutoff: null,
        persons: 0,
        deals: 0,
        suggestions: 0,
        stageEvents: 0,
        auditEntries: 0,
      };
      if (months === null) return empty; // retention off — strict no-op
      const base = now !== undefined ? new Date(now) : new Date();
      if (Number.isNaN(base.getTime())) return empty;
      // Calendar-month arithmetic in UTC — deterministic across timezones
      // and DST transitions (deletedAt stamps are ISO/UTC).
      const cutoffDate = new Date(base);
      cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - months);
      const cutoffMs = cutoffDate.getTime();
      const cutoff = cutoffDate.toISOString();

      // ONLY tombstones expire — live data is never touched by retention.
      const isExpired = (r: Versioned): boolean => {
        if (!r.deleted) return false;
        const ms = Date.parse(r.deletedAt ?? r.updatedAt);
        return Number.isFinite(ms) && ms < cutoffMs; // unparsable ⇒ keep
      };
      const s = get();
      const purgedIds = new Set<string>();
      const sweep = <T extends Versioned>(records: T[]): T[] =>
        records.filter((r) => {
          if (isExpired(r)) {
            purgedIds.add(r.id);
            return false;
          }
          return true;
        });
      const persons = sweep(s.persons);
      const deals = sweep(s.deals);
      const suggestions = sweep(s.suggestions);
      const stageEvents = sweep(s.stageEvents);
      if (purgedIds.size === 0) return { ...empty, cutoff };

      // Privacy completion: audit snapshots (before/after) of purged
      // records carry PII — they leave together with the record.
      const auditLog = s.auditLog.filter((e) => !purgedIds.has(e.entityId));
      const result: PurgeResult = {
        cutoff,
        persons: s.persons.length - persons.length,
        deals: s.deals.length - deals.length,
        suggestions: s.suggestions.length - suggestions.length,
        stageEvents: s.stageEvents.length - stageEvents.length,
        auditEntries: s.auditLog.length - auditLog.length,
      };

      saveV3(V3_KEYS.persons, persons);
      saveV3(V3_KEYS.deals, deals);
      saveV3(V3_KEYS.suggestions, suggestions);
      saveV3(V3_KEYS.events, stageEvents);
      saveV3(V3_KEYS.audit, auditLog);
      set((st) => ({
        persons,
        deals,
        suggestions,
        stageEvents,
        auditLog,
        // Purged ids can no longer sync or be undone.
        undoStack: st.undoStack.filter((u) => !purgedIds.has(u.entityId)),
        dirtyIds: {
          persons: st.dirtyIds.persons.filter((id) => !purgedIds.has(id)),
          deals: st.dirtyIds.deals.filter((id) => !purgedIds.has(id)),
          suggestions: st.dirtyIds.suggestions.filter(
            (id) => !purgedIds.has(id),
          ),
          events: st.dirtyIds.events.filter((id) => !purgedIds.has(id)),
        },
      }));
      // Audited with counts only — the purge entry must not re-import PII.
      get().appendAudit({
        actor: 'human',
        action: 'retention.purge',
        before: null,
        after: { cutoff, retentionMonths: months, counts: { ...result } },
        entityType: 'settings',
        entityId: 'retention',
      });
      return result;
    },

    // ---- Selectors (state-attached; plain-function exports below) ----
    dealsByStage: () => dealsByStage(),
    benchPersons: () => benchPersons(),
    personById: (id) => personById(id),
    benchBySilver: () => benchBySilver(),
    agentAcceptStats: (agent) => agentAcceptStats(agent),

    // ---- Wave-0 API ----

    upsertPerson: (person, actor = 'human') => {
      const { persons, appendAudit } = get();
      const existing = persons.find((p) => p.id === person.id) || null;
      const next: Person = {
        ...person,
        v: person.v ?? existing?.v ?? 0,
        updatedAt: nowIso(),
      } as Person;
      const updated = existing
        ? persons.map((p) => (p.id === next.id ? next : p))
        : [...persons, next];
      saveV3(V3_KEYS.persons, updated);
      set((s) => ({
        persons: updated,
        dirtyIds: { ...s.dirtyIds, persons: pushDirty(s.dirtyIds.persons, next.id) },
      }));
      appendAudit({
        actor,
        action: existing ? 'person.update' : 'person.create',
        before: existing,
        after: next,
        entityType: 'person',
        entityId: next.id,
      });
    },

    deletePerson: (id, actor = 'human') => {
      const { persons, appendAudit } = get();
      const existing = persons.find((p) => p.id === id);
      if (!existing || existing.deleted) return;
      const next = tombstone(existing, nowIso());
      const updated = persons.map((p) => (p.id === id ? next : p));
      saveV3(V3_KEYS.persons, updated);
      set((s) => ({
        persons: updated,
        dirtyIds: { ...s.dirtyIds, persons: pushDirty(s.dirtyIds.persons, id) },
      }));
      appendAudit({
        actor,
        action: 'person.delete',
        before: existing,
        after: next,
        entityType: 'person',
        entityId: id,
      });
    },

    upsertDeal: (deal, actor = 'human') => {
      const { deals, appendAudit } = get();
      const existing = deals.find((d) => d.id === deal.id) || null;
      const next: Deal = {
        ...deal,
        v: deal.v ?? existing?.v ?? 0,
        updatedAt: nowIso(),
      } as Deal;
      const updated = existing
        ? deals.map((d) => (d.id === next.id ? next : d))
        : [...deals, next];
      saveV3(V3_KEYS.deals, updated);
      set((s) => ({
        deals: updated,
        dirtyIds: { ...s.dirtyIds, deals: pushDirty(s.dirtyIds.deals, next.id) },
      }));
      appendAudit({
        actor,
        action: existing ? 'deal.update' : 'deal.create',
        before: existing,
        after: next,
        entityType: 'deal',
        entityId: next.id,
      });
    },

    moveDealStage: (dealId, to, opts) => {
      const stageActor: StageEventActor = opts?.actor ?? 'human';
      performMove(dealId, to, {
        reason: opts?.reason,
        auditActor: stageActor === 'human' ? 'human' : 'ai',
        stageActor,
      });
    },

    deleteDeal: (id, actor = 'human') => {
      const { deals, appendAudit } = get();
      const existing = deals.find((d) => d.id === id);
      if (!existing || existing.deleted) return;
      const next = tombstone(existing, nowIso());
      const updated = deals.map((d) => (d.id === id ? next : d));
      saveV3(V3_KEYS.deals, updated);
      set((s) => ({
        deals: updated,
        dirtyIds: { ...s.dirtyIds, deals: pushDirty(s.dirtyIds.deals, id) },
      }));
      appendAudit({
        actor,
        action: 'deal.delete',
        before: existing,
        after: next,
        entityType: 'deal',
        entityId: id,
      });
    },

    resolveSuggestion: (id, status) => applySuggestionResolution(id, status),

    appendAudit: (e) => {
      const entry: AuditEvent = {
        id: e.id ?? makeId(),
        ts: e.ts ?? nowIso(),
        actor: e.actor,
        ...(e.agent ? { agent: e.agent } : {}),
        action: e.action,
        before: e.before ?? null,
        after: e.after ?? null,
        entityType: e.entityType,
        entityId: e.entityId,
      };
      // Append-only + rotation: keep the newest AUDIT_MAX_EVENTS entries.
      const updated = [...get().auditLog, entry].slice(-AUDIT_MAX_EVENTS);
      saveV3(V3_KEYS.audit, updated);
      set({ auditLog: updated });
    },

    buildPushPayload: () => {
      const { persons, deals, stageEvents, suggestions, dirtyIds } = get();
      const pick = <T extends { id: string }>(all: T[], ids: string[]) =>
        all.filter((r) => ids.includes(r.id));
      return {
        schemaVersion: PIPELINE_SCHEMA_VERSION,
        persons: pick(persons, dirtyIds.persons),
        deals: pick(deals, dirtyIds.deals),
        events: pick(stageEvents, dirtyIds.events),
        suggestions: pick(suggestions, dirtyIds.suggestions),
        agentRuns: [],
      };
    },

    applyRemote: (remote) => {
      const s = get();
      const persons = remote.persons
        ? clientPullMerge(s.persons, remote.persons)
        : s.persons;
      const deals = remote.deals ? clientPullMerge(s.deals, remote.deals) : s.deals;
      const stageEvents = remote.events
        ? clientPullMerge(s.stageEvents, remote.events).slice(-STAGE_EVENTS_MAX)
        : s.stageEvents;
      const suggestions = remote.suggestions
        ? clientPullMerge(s.suggestions, remote.suggestions)
        : s.suggestions;
      saveV3(V3_KEYS.persons, persons);
      saveV3(V3_KEYS.deals, deals);
      saveV3(V3_KEYS.events, stageEvents);
      saveV3(V3_KEYS.suggestions, suggestions);
      set({ persons, deals, stageEvents, suggestions });
    },

    markSynced: (at) => {
      const meta: PipelineMeta = {
        schemaVersion: PIPELINE_SCHEMA_VERSION,
        lastSyncAt: at ?? nowIso(),
      };
      saveV3(V3_KEYS.meta, meta);
      set({
        meta,
        dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
      });
    },
  };
});

// ------------------------------------------------------------
// Selectors — plain functions over getState() (contract-sanctioned).
// Tombstones are excluded everywhere.
// ------------------------------------------------------------

export function dealsByStage(): Record<DealStage, Deal[]> {
  const { deals } = usePipelineStore.getState();
  const out = {} as Record<DealStage, Deal[]>;
  for (const stage of ALL_DEAL_STAGES) out[stage] = [];
  for (const d of deals) {
    if (d.deleted) continue;
    (out[d.stage] ?? (out[d.stage] = [])).push(d);
  }
  return out;
}

export function benchPersons(): Person[] {
  const { persons } = usePipelineStore.getState();
  return persons.filter((p) => !p.deleted && !!p.bench);
}

export function personById(id: string): Person | undefined {
  const { persons } = usePipelineStore.getState();
  const p = persons.find((x) => x.id === id);
  return p && !p.deleted ? p : undefined;
}

/**
 * Bench rail grouping for the silver-medalist badge (Wave 3): live benched
 * persons split into silver medalists vs the rest, newest bench first.
 */
export function benchBySilver(): BenchBySilver {
  const { persons } = usePipelineStore.getState();
  const benched = (persons as PersonWithBenchMeta[]).filter(
    (p) => !p.deleted && !!p.bench,
  );
  const benchedAt = (p: PersonWithBenchMeta): string =>
    p.bench?.benchedAt ?? p.bench?.since ?? '';
  benched.sort((a, b) => benchedAt(b).localeCompare(benchedAt(a)));
  return {
    silver: benched.filter((p) => p.bench?.silverMedalist === true),
    others: benched.filter((p) => p.bench?.silverMedalist !== true),
  };
}

/**
 * Accept-rate per agent over live suggestions — the Bench Sourcer precision
 * throttle reads this (accept-rate < 1/5 ⇒ next run halves its volume).
 * acceptRate is accepted / (accepted + dismissed); null when nothing has
 * been resolved yet — never a fake number.
 */
export function agentAcceptStats(agent: AgentName): AgentAcceptStats {
  const { suggestions } = usePipelineStore.getState();
  let accepted = 0;
  let dismissed = 0;
  let pending = 0;
  for (const x of suggestions) {
    if (x.deleted || x.agent !== agent) continue;
    if (x.status === 'accepted') accepted += 1;
    else if (x.status === 'dismissed') dismissed += 1;
    else pending += 1;
  }
  const resolved = accepted + dismissed;
  return {
    agent,
    accepted,
    dismissed,
    pending,
    resolved,
    acceptRate: resolved > 0 ? accepted / resolved : null,
  };
}

// ------------------------------------------------------------
// ContactLogger adapter — implements src/lib/outreach's contract on top of
// the store, so composeAndLog captures contacts with zero keystrokes.
// ------------------------------------------------------------

export const pipelineContactLogger: ContactLogger = {
  logContact(personId, channel, messageHash, ts) {
    usePipelineStore
      .getState()
      .logContact(personId, channel, messageHash, new Date(ts).toISOString());
  },
};
