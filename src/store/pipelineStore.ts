// ============================================================
// Revital V3 — Pipeline Store (Wave 0, platform-data)
//
// Additive Zustand slice. Persists ONLY under new revital_v3_* keys —
// legacy revital_* keys and appStore.ts are untouched (flag-off behavior
// byte-identical). Feature flag `revital_v3_flag` default-off.
//
// Single-writer rule (plan §3): this client path is the ONLY writer of
// card state. Agents write suggestions elsewhere; acceptance flows through
// the actions below and is audited.
// ============================================================

import { create } from 'zustand';
import {
  PIPELINE_SCHEMA_VERSION,
  PIPELINE_STAGES,
  type AuditActor,
  type AuditEvent,
  type Deal,
  type DealStage,
  type Person,
  type PipelineMeta,
  type PipelineStage,
  type PipelineSyncPayload,
  type StageEvent,
  type StageEventActor,
  type Suggestion,
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

  /** ids with local edits not yet accepted by the server (client-only). */
  dirtyIds: Record<'persons' | 'deals' | 'events' | 'suggestions', string[]>;

  // Person
  upsertPerson: (
    person: Omit<Person, 'v' | 'updatedAt'> & Partial<Pick<Person, 'v' | 'updatedAt'>>,
    actor?: AuditActor,
  ) => void;
  deletePerson: (id: string, actor?: AuditActor) => void;

  // Deal
  upsertDeal: (
    deal: Omit<Deal, 'v' | 'updatedAt'> & Partial<Pick<Deal, 'v' | 'updatedAt'>>,
    actor?: AuditActor,
  ) => void;
  moveDealStage: (
    dealId: string,
    to: DealStage,
    opts?: { actor?: StageEventActor; reason?: string },
  ) => void;
  deleteDeal: (id: string, actor?: AuditActor) => void;

  // Suggestions (agents propose; only human acceptance mutates state)
  addSuggestion: (s: Omit<Suggestion, 'v' | 'updatedAt' | 'status'> & { status?: Suggestion['status'] }) => void;
  resolveSuggestion: (id: string, status: 'accepted' | 'dismissed') => void;

  // Audit (append-only, client rotation last N≈500)
  appendAudit: (e: Omit<AuditEvent, 'id' | 'ts'> & { id?: string; ts?: string }) => void;

  // Sync plumbing (Wave 0: merge logic only; network wiring lands with UI)
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

export const usePipelineStore = create<PipelineState>((set, get) => ({
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

  dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },

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
    const actor: StageEventActor = opts?.actor ?? 'human';
    const { deals, stageEvents, appendAudit } = get();
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.deleted) return;
    if (to === 'Rejected' && !opts?.reason) {
      // Rejection requires a reason (plan §2) — refuse silently-invalid moves.
      return;
    }
    const ts = nowIso();
    const next: Deal = {
      ...deal,
      stage: to,
      stageEnteredAt: ts,
      updatedAt: ts,
      ...(to === 'Rejected' && opts?.reason
        ? { rejection: { reason: opts.reason, ts } }
        : {}),
    };
    const event: StageEvent = {
      id: makeId(),
      v: 0,
      updatedAt: ts,
      dealId,
      from: deal.stage,
      to,
      ts,
      actor,
      skippedStages: computeSkippedStages(deal.stage, to),
      ...(opts?.reason ? { reason: opts.reason } : {}),
    };
    const updatedDeals = deals.map((d) => (d.id === dealId ? next : d));
    const updatedEvents = [...stageEvents, event].slice(-STAGE_EVENTS_MAX);
    saveV3(V3_KEYS.deals, updatedDeals);
    saveV3(V3_KEYS.events, updatedEvents);
    set((s) => ({
      deals: updatedDeals,
      stageEvents: updatedEvents,
      dirtyIds: {
        ...s.dirtyIds,
        deals: pushDirty(s.dirtyIds.deals, dealId),
        events: pushDirty(s.dirtyIds.events, event.id),
      },
    }));
    appendAudit({
      actor: actor === 'human' ? 'human' : 'ai',
      action: 'deal.move',
      before: { stage: deal.stage },
      after: { stage: to, skippedStages: event.skippedStages },
      entityType: 'deal',
      entityId: dealId,
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

  addSuggestion: (s) => {
    const { suggestions } = get();
    const next: Suggestion = {
      ...s,
      status: s.status ?? 'pending',
      v: 0,
      updatedAt: nowIso(),
    } as Suggestion;
    const updated = [...suggestions.filter((x) => x.id !== next.id), next];
    saveV3(V3_KEYS.suggestions, updated);
    set((st) => ({
      suggestions: updated,
      dirtyIds: {
        ...st.dirtyIds,
        suggestions: pushDirty(st.dirtyIds.suggestions, next.id),
      },
    }));
  },

  resolveSuggestion: (id, status) => {
    const { suggestions, appendAudit } = get();
    const existing = suggestions.find((s) => s.id === id);
    if (!existing || existing.status !== 'pending') return;
    const ts = nowIso();
    const next: Suggestion = { ...existing, status, resolvedAt: ts, updatedAt: ts };
    const updated = suggestions.map((s) => (s.id === id ? next : s));
    saveV3(V3_KEYS.suggestions, updated);
    set((st) => ({
      suggestions: updated,
      dirtyIds: {
        ...st.dirtyIds,
        suggestions: pushDirty(st.dirtyIds.suggestions, id),
      },
    }));
    appendAudit({
      actor: 'human',
      action: `suggestion.${status}`,
      before: existing,
      after: next,
      entityType: 'suggestion',
      entityId: id,
    });
  },

  appendAudit: (e) => {
    const entry: AuditEvent = {
      id: e.id ?? makeId(),
      ts: e.ts ?? nowIso(),
      actor: e.actor,
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
}));
