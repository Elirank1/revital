// ============================================================
// Revital V3 — SLA silence sweep (Wave 2, agents-engine)
//
// BINDING contract: docs/waves/wave2-contract.md §Tick protocol —
// "SLA sweep over contacts/replies": a deal sitting in Outreach or
// InConversation whose candidate was contacted ≥3 days ago with no
// reply since is a silence breach → a follow-up draft Suggestion
// (agent 'outreach_runner', Propose forever — plan §3).
//
// Pure core (detectSilences / planSlaSweep) shared by BOTH surfaces:
//   - client: runSlaSweepOnLoad (app-open sweep, flag-gated, files via
//     the store's addSuggestion — the sanctioned single-writer path);
//   - server: the daily tick (api/agents/tick.ts) converts the same
//     plan into bridge-store records.
//
// Idempotency: deterministic suggestion ids keyed by (dealId, last
// contact ts) — one suggestion per silence episode. A new contact
// starts a new episode (new id); re-sweeping the same episode is a
// no-op (client: exists-check; server: LWW merge drops the repeat).
// A dismissed suggestion therefore STAYS dismissed for its episode.
//
// No send path: output is Suggestion inputs only. No LLM calls.
// ============================================================

import type {
  Deal,
  DealStage,
  Person,
  Suggestion,
} from '../types/pipeline';
import {
  flattenContacts,
  type ContactRef,
} from '../lib/metrics/leadingIndicators';
import { followUpDraft } from '../lib/outreach';
import {
  usePipelineStore,
  type SuggestionInput,
} from '../store/pipelineStore';

export const SLA_AGENT = 'outreach_runner' as const;

/** Silence threshold (days) — aligned with FIRST_TOUCH_SLA_DAYS (metrics). */
export const SLA_SILENCE_DAYS = 3;

/** Stages where a reply is expected and silence breaches the SLA. */
export const SLA_SILENCE_STAGES: readonly DealStage[] = [
  'Outreach',
  'InConversation',
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseTs(ts: string): number | null {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

// ------------------------------------------------------------
// Detection (pure)
// ------------------------------------------------------------

export interface SilenceBreach {
  dealId: string;
  personId: string;
  jobId: string;
  /** ISO ts of the last attributable outbound contact. */
  lastContactTs: string;
  /** Fractional days since lastContactTs (≥ SLA_SILENCE_DAYS). */
  daysSilent: number;
  /** Channel of the last contact, when captured. */
  channel?: 'whatsapp' | 'email';
}

/**
 * Silence breaches over live deals in SLA stages.
 *
 * Attribution mirrors src/lib/metrics/leadingIndicators (single rule,
 * not reimplemented semantics): a contact belongs to a deal when
 * `contact.dealId === deal.id`, or — with no dealId captured — when
 * `contact.personId === deal.personId`.
 *
 * Breach ⇔ last attributable 'contacted' is ≥ SLA_SILENCE_DAYS old AND
 * no attributable 'replied'/'meeting_set' landed at/after it. A deal
 * never contacted is NOT a breach (first-touch SLA is a metrics
 * concern; a follow-up draft requires a real opener to follow up on).
 * 'no_reply' markers do not clear silence — they confirm it.
 */
export function detectSilences(
  deals: readonly Deal[],
  contacts: readonly ContactRef[],
  now: Date | string,
): SilenceBreach[] {
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const breaches: SilenceBreach[] = [];
  for (const deal of deals) {
    if (deal.deleted) continue;
    if (!SLA_SILENCE_STAGES.includes(deal.stage)) continue;

    let lastContactMs: number | null = null;
    let lastContactTs = '';
    let lastChannel: 'whatsapp' | 'email' | undefined;
    let lastReplyMs: number | null = null;

    for (const c of contacts) {
      const attributable =
        (c.dealId !== undefined && c.dealId === deal.id) ||
        (c.dealId === undefined && c.personId === deal.personId);
      if (!attributable) continue;
      const ms = parseTs(c.ts);
      if (ms === null) continue;
      if (c.kind === 'contacted') {
        if (lastContactMs === null || ms > lastContactMs) {
          lastContactMs = ms;
          lastContactTs = c.ts;
          lastChannel = c.channel;
        }
      } else if (c.kind === 'replied' || c.kind === 'meeting_set') {
        if (lastReplyMs === null || ms > lastReplyMs) lastReplyMs = ms;
      }
    }

    if (lastContactMs === null) continue; // never contacted — not a breach
    if (lastReplyMs !== null && lastReplyMs >= lastContactMs) continue; // answered

    const daysSilent = (nowMs - lastContactMs) / MS_PER_DAY;
    if (daysSilent < SLA_SILENCE_DAYS) continue;

    breaches.push({
      dealId: deal.id,
      personId: deal.personId,
      jobId: deal.jobId,
      lastContactTs,
      daysSilent,
      ...(lastChannel !== undefined ? { channel: lastChannel } : {}),
    });
  }
  return breaches;
}

// ------------------------------------------------------------
// Suggestion building (pure)
// ------------------------------------------------------------

/** Deterministic per-episode id: same (deal, last contact) ⇒ same id. */
export function slaSuggestionId(dealId: string, lastContactTs: string): string {
  return `s_sla_${dealId}_${lastContactTs.replace(/[^A-Za-z0-9]/g, '')}`;
}

/**
 * Follow-up draft Suggestion input for a breach — delegates the Hebrew
 * text + evidence to src/lib/outreach's followUpDraft (BiDi-sanitized,
 * grounded), then pins the deterministic episode id on top.
 */
export function buildSlaSuggestion(
  breach: SilenceBreach,
  person: Person,
  deal: Deal,
): SuggestionInput {
  const draft = followUpDraft(person, deal, Math.floor(breach.daysSilent));
  return {
    ...draft.suggestionInput,
    id: slaSuggestionId(breach.dealId, breach.lastContactTs),
    evidence: [
      ...(draft.suggestionInput.evidence ?? []),
      {
        claim: `פנייה אחרונה: ${breach.lastContactTs} — ${breach.daysSilent.toFixed(1)} ימים ללא מענה (סף: ${SLA_SILENCE_DAYS} ימים)`,
        sourceType: 'person',
        sourceId: breach.personId,
      },
    ],
  };
}

export type SlaSkipReason = 'exists' | 'pending_draft' | 'missing_person';

export interface SlaSweepPlan {
  /** Every current silence breach, whether or not a suggestion is filed. */
  breaches: SilenceBreach[];
  toFile: Array<{ breach: SilenceBreach; input: SuggestionInput }>;
  skipped: Array<{ breach: SilenceBreach; reason: SlaSkipReason }>;
}

/**
 * The whole sweep as data: detect breaches, then decide per breach.
 * Skip rules (in order):
 *   - 'exists': a suggestion with this episode's deterministic id already
 *     exists in ANY status (pending / accepted / dismissed / tombstoned) —
 *     dismissals are final for the episode, resurrection is forbidden;
 *   - 'pending_draft': a live pending outreach_runner draft_message for
 *     the same deal exists (an earlier episode still awaiting triage) —
 *     never stack two pending follow-ups on one deal;
 *   - 'missing_person': the deal's person is absent or tombstoned.
 */
export function planSlaSweep(
  deals: readonly Deal[],
  persons: readonly Person[],
  suggestions: readonly Suggestion[],
  now: Date | string,
): SlaSweepPlan {
  const contacts = flattenContacts(
    persons.map((p) => ({
      id: p.id,
      ...(p.deleted ? { deleted: p.deleted } : {}),
      contactEvents: p.contactEvents ?? [],
    })),
  );
  const breaches = detectSilences(deals, contacts, now);

  const personById = new Map<string, Person>();
  for (const p of persons) if (!p.deleted) personById.set(p.id, p);
  const dealById = new Map<string, Deal>();
  for (const d of deals) dealById.set(d.id, d);

  const existingIds = new Set(suggestions.map((s) => s.id));
  const pendingDraftDeals = new Set(
    suggestions
      .filter(
        (s) =>
          !s.deleted &&
          s.agent === SLA_AGENT &&
          s.kind === 'draft_message' &&
          s.status === 'pending' &&
          s.dealId !== undefined,
      )
      .map((s) => s.dealId as string),
  );

  const toFile: SlaSweepPlan['toFile'] = [];
  const skipped: SlaSweepPlan['skipped'] = [];

  for (const breach of breaches) {
    const id = slaSuggestionId(breach.dealId, breach.lastContactTs);
    if (existingIds.has(id)) {
      skipped.push({ breach, reason: 'exists' });
      continue;
    }
    if (pendingDraftDeals.has(breach.dealId)) {
      skipped.push({ breach, reason: 'pending_draft' });
      continue;
    }
    const person = personById.get(breach.personId);
    const deal = dealById.get(breach.dealId);
    if (!person || !deal) {
      skipped.push({ breach, reason: 'missing_person' });
      continue;
    }
    toFile.push({ breach, input: buildSlaSuggestion(breach, person, deal) });
  }

  return { breaches, toFile, skipped };
}

// ------------------------------------------------------------
// Client variant — app-open sweep (plan §5: SLA folds into the daily
// tick PLUS a client-side sweep on app open)
// ------------------------------------------------------------

/** Structural store view — satisfied by usePipelineStore; injectable. */
export interface SlaPipelineState {
  v3Enabled: boolean;
  persons: Person[];
  deals: Deal[];
  suggestions: Suggestion[];
  addSuggestion(input: SuggestionInput): Suggestion;
}

export interface SlaPipelineStore {
  getState(): SlaPipelineState;
}

export interface SlaSweepResult {
  ran: boolean;
  reason?: 'flag_off';
  breaches: SilenceBreach[];
  /** Suggestions actually filed this run. */
  created: Suggestion[];
  skipped: SlaSweepPlan['skipped'];
}

/**
 * App-open sweep. Flag-gated (v3 off ⇒ store untouched). Files each
 * plannable breach through addSuggestion — the single sanctioned agent
 * write path (audit-attributed 'ai'/'outreach_runner' by the store).
 */
export function runSlaSweepOnLoad(
  pipelineStore: SlaPipelineStore = usePipelineStore,
  now: Date | string = new Date(),
): SlaSweepResult {
  const state = pipelineStore.getState();
  if (!state.v3Enabled) {
    return { ran: false, reason: 'flag_off', breaches: [], created: [], skipped: [] };
  }

  const plan = planSlaSweep(state.deals, state.persons, state.suggestions, now);
  const created: Suggestion[] = [];
  for (const { input } of plan.toFile) {
    created.push(pipelineStore.getState().addSuggestion(input));
  }
  return { ran: true, breaches: plan.breaches, created, skipped: plan.skipped };
}
