// ============================================================
// Revital V3 — Pipeline Store (Wave 1, platform-data)
//
// Implements the BINDING store contract in docs/waves/wave1-store-contract.md:
//   addPerson / addDeal / moveDeal / undoLast / setReplyState / logContact /
//   acceptSuggestion / dismissSuggestion / addSuggestion
//   + selectors dealsByStage / benchPersons / personById
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
} from '../types/pipeline';
import {
  AUDIT_MAX_EVENTS,
  STAGE_EVENTS_MAX,
  V3_KEYS,
  isV3Enabled,
  loadV3,
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
  action: 'deal.move' | 'suggestion.accept';
  deals: Deal[];
  persons: Person[];
  suggestions: Suggestion[];
  /** Present for moves — drives the compensating StageEvent on undo. */
  move?: { dealId: string; from: DealStage; to: DealStage };
  entityType: string;
  entityId: string;
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
  acceptSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
  addSuggestion: (input: SuggestionInput) => Suggestion;

  // Selectors (also exported as plain functions below)
  dealsByStage: () => Record<DealStage, Deal[]>;
  benchPersons: () => Person[];
  personById: (id: string) => Person | undefined;

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
        benchedPerson = {
          ...p,
          bench: { reason: opts.reason ?? 'bench', since: ts },
          updatedAt: ts,
        };
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
  ): void => {
    const s = get();
    const sug = s.suggestions.find((x) => x.id === id);
    if (!sug || sug.status !== 'pending') return;
    const ts = nowIso();
    const nextSug: Suggestion = { ...sug, status, resolvedAt: ts, updatedAt: ts };

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

    acceptSuggestion: (id) => applySuggestionResolution(id, 'accepted'),
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

    // ---- Selectors (state-attached; plain-function exports below) ----
    dealsByStage: () => dealsByStage(),
    benchPersons: () => benchPersons(),
    personById: (id) => personById(id),

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
