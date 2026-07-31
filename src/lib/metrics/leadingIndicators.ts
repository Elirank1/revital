// ============================================================
// Revital V3 — Leading indicators (Wave 2, platform-data)
//
// BINDING contract: docs/waves/wave2-contract.md §Fee/EV model:
//   computeLeadingIndicators(events, contacts, suggestions) →
//     { timeToFirstTouchDays, slaHitRate, clientFeedbackLatencyDays,
//       suggestionAcceptRate, suggestionEditRate }
//   with nulls when insufficient data — NEVER a fake number.
//
// Definitions (logged in docs/DECISIONS.md):
//  - timeToFirstTouchDays: median days from a deal's creation StageEvent
//    (from: null) to its first attributable 'contacted' contact.
//  - slaHitRate: share of SLA-eligible deals (created into an early stage,
//    Sourced..InConversation) whose first touch landed within
//    FIRST_TOUCH_SLA_DAYS. Untouched deals older than the SLA are misses;
//    untouched deals younger than the SLA are pending and excluded.
//  - clientFeedbackLatencyDays: median days from entering Submitted to the
//    NEXT stage transition of that deal (client feedback). Deals still
//    sitting in Submitted are censored, not counted.
//  - suggestionAcceptRate: accepted / (accepted + dismissed).
//  - suggestionEditRate: over ACCEPTED suggestions that carry the
//    `editedBeforeAccept` boolean marker (kanban-ui stamps it at accept
//    time; rides ahead of the lead-owned type like D-018's channel).
//    Null until that instrumentation exists — absence of the marker is
//    "not measured", never "0% edited".
// ============================================================

import {
  PIPELINE_STAGES,
  type ContactEventKind,
  type Deal,
  type PipelineStage,
  type StageEvent,
  type Suggestion,
} from '../../types/pipeline';

/** First-touch SLA, aligned with the Wave-2 SLA sweep (3d silence rule). */
export const FIRST_TOUCH_SLA_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A contact observation. Shape-compatible with Person.contactEvents entries;
 * add `personId` when flattening (see flattenContacts) so contacts can be
 * attributed to deals via opts.deals even when dealId was not captured.
 */
export interface ContactRef {
  kind: ContactEventKind;
  ts: string;
  dealId?: string;
  personId?: string;
  channel?: 'whatsapp' | 'email';
}

export interface LeadingIndicators {
  timeToFirstTouchDays: number | null;
  slaHitRate: number | null;
  clientFeedbackLatencyDays: number | null;
  suggestionAcceptRate: number | null;
  suggestionEditRate: number | null;
}

export interface LeadingIndicatorOptions {
  /** Enables person-level contact→deal attribution (dealId still wins). */
  deals?: Deal[];
  /** Clock for SLA pending/miss classification. Defaults to wall time. */
  now?: string | Date;
}

/** Flatten persons' contactEvents into ContactRefs carrying the personId. */
export function flattenContacts(
  persons: Array<{
    id: string;
    deleted?: true;
    contactEvents: Array<Omit<ContactRef, 'personId'>>;
  }>,
): ContactRef[] {
  const out: ContactRef[] = [];
  for (const p of persons) {
    if (p.deleted) continue;
    for (const c of p.contactEvents) out.push({ ...c, personId: p.id });
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseTs(ts: string): number | null {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

const EARLY_STAGE_SET = new Set<string>(
  PIPELINE_STAGES.slice(0, PIPELINE_STAGES.indexOf('Submitted')),
);

interface DealTouchInfo {
  dealId: string;
  createdMs: number;
  createdStage: string;
  personId?: string;
  firstTouchMs: number | null;
}

function collectDealTouches(
  events: StageEvent[],
  contacts: ContactRef[],
  deals?: Deal[],
): DealTouchInfo[] {
  const personByDeal = new Map<string, string>();
  if (deals) {
    for (const d of deals) {
      if (!d.deleted) personByDeal.set(d.id, d.personId);
    }
  }

  // Creation events (from: null) define the deal's clock start.
  const infos = new Map<string, DealTouchInfo>();
  for (const e of events) {
    if (e.from !== null) continue;
    const ms = parseTs(e.ts);
    if (ms === null) continue;
    infos.set(e.dealId, {
      dealId: e.dealId,
      createdMs: ms,
      createdStage: e.to,
      personId: personByDeal.get(e.dealId),
      firstTouchMs: null,
    });
  }

  for (const c of contacts) {
    if (c.kind !== 'contacted') continue;
    const ms = parseTs(c.ts);
    if (ms === null) continue;
    for (const info of infos.values()) {
      const attributable =
        (c.dealId && c.dealId === info.dealId) ||
        (!c.dealId && c.personId && info.personId === c.personId);
      if (!attributable) continue;
      if (info.firstTouchMs === null || ms < info.firstTouchMs) {
        info.firstTouchMs = ms;
      }
    }
  }

  return Array.from(infos.values());
}

/** Leading indicators per the Wave-2 contract. Pure; null over fiction. */
export function computeLeadingIndicators(
  events: StageEvent[],
  contacts: ContactRef[],
  suggestions: Suggestion[],
  opts?: LeadingIndicatorOptions,
): LeadingIndicators {
  const nowMs =
    opts?.now !== undefined
      ? new Date(opts.now).getTime()
      : Date.now();

  const touches = collectDealTouches(events, contacts, opts?.deals);

  // --- timeToFirstTouchDays -------------------------------------------
  const deltas: number[] = [];
  for (const t of touches) {
    if (t.firstTouchMs === null) continue;
    // Contact before carding = touched at carding time (clamp, don't skip).
    deltas.push(Math.max(0, t.firstTouchMs - t.createdMs) / MS_PER_DAY);
  }
  const timeToFirstTouchDays = median(deltas);

  // --- slaHitRate ------------------------------------------------------
  const slaMs = FIRST_TOUCH_SLA_DAYS * MS_PER_DAY;
  let slaEligible = 0;
  let slaHits = 0;
  for (const t of touches) {
    if (!EARLY_STAGE_SET.has(t.createdStage)) continue; // outreach not expected
    if (t.firstTouchMs !== null) {
      slaEligible += 1;
      if (Math.max(0, t.firstTouchMs - t.createdMs) <= slaMs) slaHits += 1;
    } else if (Number.isFinite(nowMs) && nowMs - t.createdMs > slaMs) {
      slaEligible += 1; // old enough and never touched — a miss
    }
    // untouched and younger than the SLA window → pending, excluded
  }
  const slaHitRate = slaEligible > 0 ? slaHits / slaEligible : null;

  // --- clientFeedbackLatencyDays --------------------------------------
  const byDeal = new Map<string, StageEvent[]>();
  for (const e of events) {
    const list = byDeal.get(e.dealId);
    if (list) list.push(e);
    else byDeal.set(e.dealId, [e]);
  }
  const latencies: number[] = [];
  for (const list of byDeal.values()) {
    const ordered = [...list].sort((a, b) => a.ts.localeCompare(b.ts));
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].to !== 'Submitted') continue;
      const entryMs = parseTs(ordered[i].ts);
      if (entryMs === null) continue;
      const next = ordered[i + 1]; // next transition = the feedback moment
      if (!next) continue; // still waiting — censored
      const nextMs = parseTs(next.ts);
      if (nextMs === null) continue;
      latencies.push(Math.max(0, nextMs - entryMs) / MS_PER_DAY);
    }
  }
  const clientFeedbackLatencyDays = median(latencies);

  // --- suggestionAcceptRate -------------------------------------------
  const liveSuggestions = suggestions.filter((s) => !s.deleted);
  const resolved = liveSuggestions.filter(
    (s) => s.status === 'accepted' || s.status === 'dismissed',
  );
  const accepted = resolved.filter((s) => s.status === 'accepted');
  const suggestionAcceptRate =
    resolved.length > 0 ? accepted.length / resolved.length : null;

  // --- suggestionEditRate ---------------------------------------------
  // Only accepted suggestions that carry the marker are measurable.
  const instrumented = accepted.filter(
    (s) =>
      typeof (s as { editedBeforeAccept?: unknown }).editedBeforeAccept ===
      'boolean',
  );
  const suggestionEditRate =
    instrumented.length > 0
      ? instrumented.filter(
          (s) =>
            (s as { editedBeforeAccept?: boolean }).editedBeforeAccept === true,
        ).length / instrumented.length
      : null;

  return {
    timeToFirstTouchDays,
    slaHitRate,
    clientFeedbackLatencyDays,
    suggestionAcceptRate,
    suggestionEditRate,
  };
}

/** Re-export for consumers that need the stage typing. */
export type { PipelineStage };
