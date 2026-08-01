// ============================================================
// Revital V3 — guarantee-window pass (rule-27 audit ⑥.2, agents-engine)
//
// Closes audit item ⑥.2 "Guarantee timers": `guaranteeDays` was captured
// (FeeCapture) but nothing ever FIRED as a Placed deal's guarantee
// window neared expiry. This pass makes the timer real — as Suggestions
// only (single-writer, plan §3): agents never move cards or edit fees.
//
// Deterministic only — NO LLM, no spend guard, no send path.
//
// Two milestones per (deal, guarantee window):
//   (a) ENDING — window end is ≤ GUARANTEE_ENDING_SOON_DAYS (7) away:
//       "תקופת אחריות מסתיימת בעוד X ימים" ('flag'), numeric evidence
//       citing the fee record + the placement date;
//   (b) ENDED — now ≥ window end: the fee is now safe ('next_action') —
//       suggest the invoice step when the invoice is not yet paid.
//
// Guarantee-term source precedence (D-057):
//   1. MandateFee (fees[jobId], the money lib's authority — client-local
//      `revital_v3_fees`, so this is the CLIENT sweep's live source);
//   2. legacy synced Deal.fee (FeeTerms) — deal-level terms ride the
//      sync payload, so the SERVER tick can fire from them today even
//      though the mandate-fee ledger is client-local until G3.
//   guaranteeDays must be a finite number > 0; 0/absent = no guarantee
//   = no window (never invented). Invoice status resolves the same way
//   (FeeTerms 'pending' maps to 'due').
//
// Placement date (window start) precedence, most- to least-authoritative:
//   1. the latest live StageEvent with to === 'Placed' for the deal
//      (the recorded placement move — survives a later move to Paid);
//   2. the latest live StageEvent with to === 'Paid' (covers skip-moves
//      that jumped over Placed: its ts is when the money stage was
//      actually reached);
//   3. the deal's own stageEnteredAt (no move log at all — exact for a
//      deal sitting in Placed; for a Paid deal this is conservative-LATE,
//      which can only delay the "fee is safe" claim, never invent it).
//
// Idempotency mirrors sla.ts: deterministic per-episode ids keyed by
// (deal, phase, window end) — re-sweeping is a no-op (client:
// exists-check; server: LWW merge drops the repeat), a dismissal stays
// dismissed for its episode, and editing guaranteeDays moves the window
// end ⇒ a NEW episode. A pending same-milestone suggestion for the same
// deal additionally blocks re-filing under a shifted window end (never
// two pending timers for one deal+milestone).
//
// CALIBRATION SAFETY: no ₪ ever appears in these suggestions — evidence
// is dates and day counts only. Fee records are cited by reference,
// never by amount.
// ============================================================

import type {
  Deal,
  DealStage,
  StageEvent,
  Suggestion,
} from '../types/pipeline';
import type { MandateFee, MandateInvoiceStatus } from '../lib/money/mandateFee';
import { useMoneyStore } from '../lib/money/moneyStore';
import { sanitizeMessageText } from '../lib/outreach';
import {
  usePipelineStore,
  type SuggestionInput,
} from '../store/pipelineStore';

/** Guarantee/invoice money passes carry Pit Boss attribution — AgentName
 *  is a closed lead-owned union and the money watcher is the honest home
 *  for money-timeline suggestions (D-057). */
export const GUARANTEE_AGENT = 'pit_boss' as const;

/** "Ending soon" threshold (days before window end). */
export const GUARANTEE_ENDING_SOON_DAYS = 7;

/** Stages where a guarantee window can be running. */
export const GUARANTEE_STAGES: readonly DealStage[] = ['Placed', 'Paid'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseTs(ts: string | undefined): number | null {
  if (typeof ts !== 'string' || ts === '') return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Round to one decimal for claims — inputs keep full precision. */
function d1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ------------------------------------------------------------
// Guarantee-term resolution (MandateFee → legacy Deal.fee)
// ------------------------------------------------------------

export interface GuaranteeTerms {
  guaranteeDays: number;
  invoiceStatus: MandateInvoiceStatus;
  /** Where the terms came from — cited in evidence. */
  feeSource: 'mandate' | 'deal';
}

/** Map legacy FeeTerms invoice status onto the mandate-fee lifecycle. */
function mapLegacyInvoiceStatus(
  status: string | undefined,
): MandateInvoiceStatus {
  if (status === 'sent' || status === 'paid') return status;
  if (status === 'pending') return 'due';
  return 'none';
}

/**
 * The deal's effective guarantee terms, or null when no guarantee is
 * defined anywhere (guaranteeDays must be finite and > 0 — a mandate
 * without a guarantee has no window and never fires).
 */
export function resolveGuaranteeTerms(
  deal: Deal,
  fees: Record<string, MandateFee>,
): GuaranteeTerms | null {
  const mandateFee = fees[deal.jobId];
  if (mandateFee) {
    const gd = mandateFee.guaranteeDays;
    if (typeof gd === 'number' && Number.isFinite(gd) && gd > 0) {
      return {
        guaranteeDays: gd,
        invoiceStatus: mandateFee.invoiceStatus,
        feeSource: 'mandate',
      };
    }
    // A mandate fee EXISTS and says "no guarantee" — it is the authority;
    // the legacy deal terms never override it.
    return null;
  }
  const legacy = deal.fee;
  const gd = legacy?.guaranteeDays;
  if (typeof gd === 'number' && Number.isFinite(gd) && gd > 0) {
    return {
      guaranteeDays: gd,
      invoiceStatus: mapLegacyInvoiceStatus(legacy?.invoiceStatus),
      feeSource: 'deal',
    };
  }
  return null;
}

// ------------------------------------------------------------
// Placement resolution (window start)
// ------------------------------------------------------------

export interface PlacementRef {
  /** ISO ts the placement is dated to. */
  ts: string;
  /** Which record dated it — cited in evidence. */
  source: 'placed_event' | 'paid_event' | 'stage_entered_at';
  /** The backing record id (StageEvent id or the deal id). */
  sourceId: string;
}

/**
 * The deal's placement date per the documented precedence (header):
 * latest live to='Placed' event → latest live to='Paid' event (skip-moves)
 * → deal.stageEnteredAt. Null only when nothing parses.
 */
export function resolvePlacement(
  deal: Deal,
  events: readonly StageEvent[],
): PlacementRef | null {
  let placed: StageEvent | null = null;
  let placedMs = -Infinity;
  let paid: StageEvent | null = null;
  let paidMs = -Infinity;
  for (const e of events) {
    if (e.deleted) continue;
    if (e.dealId !== deal.id) continue;
    const ms = parseTs(e.ts);
    if (ms === null) continue;
    if (e.to === 'Placed' && ms > placedMs) {
      placed = e;
      placedMs = ms;
    } else if (e.to === 'Paid' && ms > paidMs) {
      paid = e;
      paidMs = ms;
    }
  }
  if (placed) return { ts: placed.ts, source: 'placed_event', sourceId: placed.id };
  if (paid) return { ts: paid.ts, source: 'paid_event', sourceId: paid.id };
  if (parseTs(deal.stageEnteredAt) !== null) {
    return {
      ts: deal.stageEnteredAt,
      source: 'stage_entered_at',
      sourceId: deal.id,
    };
  }
  return null;
}

// ------------------------------------------------------------
// Detection (pure)
// ------------------------------------------------------------

export type GuaranteePhase = 'ending' | 'ended';

export interface GuaranteeWindow {
  dealId: string;
  personId: string;
  jobId: string;
  stage: DealStage;
  phase: GuaranteePhase;
  guaranteeDays: number;
  /** Window start (placement) — see PlacementRef for provenance. */
  placement: PlacementRef;
  /** ISO ts the guarantee window ends (start + guaranteeDays). */
  windowEndTs: string;
  /** Fractional days until window end; negative once ended. */
  daysLeft: number;
  invoiceStatus: MandateInvoiceStatus;
  feeSource: 'mandate' | 'deal';
}

export interface GuaranteeDetection {
  windows: GuaranteeWindow[];
  /** Live Placed/Paid deals that carry guarantee terms (scan scope). */
  scanned: number;
}

/**
 * Actionable guarantee windows over live Placed/Paid deals.
 *
 *  - phase 'ending': 0 < daysLeft ≤ GUARANTEE_ENDING_SOON_DAYS — emitted
 *    regardless of invoice status (retention risk is real either way);
 *  - phase 'ended': daysLeft ≤ 0 — skipped when the invoice is already
 *    paid (nothing left to do);
 *  - windows further than the threshold are silent (not yet news).
 */
export function detectGuaranteeWindows(
  deals: readonly Deal[],
  fees: Record<string, MandateFee>,
  events: readonly StageEvent[],
  now: Date | string,
): GuaranteeDetection {
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(nowMs)) return { windows: [], scanned: 0 };

  const windows: GuaranteeWindow[] = [];
  let scanned = 0;

  for (const deal of deals) {
    if (deal.deleted) continue;
    if (!GUARANTEE_STAGES.includes(deal.stage)) continue;
    const terms = resolveGuaranteeTerms(deal, fees);
    if (!terms) continue;
    scanned += 1;

    const placement = resolvePlacement(deal, events);
    if (!placement) continue; // no truthful window start exists
    const startMs = parseTs(placement.ts);
    if (startMs === null) continue;

    const endMs = startMs + terms.guaranteeDays * MS_PER_DAY;
    const daysLeft = (endMs - nowMs) / MS_PER_DAY;
    if (daysLeft > GUARANTEE_ENDING_SOON_DAYS) continue; // not yet news

    const phase: GuaranteePhase = daysLeft > 0 ? 'ending' : 'ended';
    if (phase === 'ended' && terms.invoiceStatus === 'paid') continue;

    windows.push({
      dealId: deal.id,
      personId: deal.personId,
      jobId: deal.jobId,
      stage: deal.stage,
      phase,
      guaranteeDays: terms.guaranteeDays,
      placement,
      windowEndTs: new Date(endMs).toISOString(),
      daysLeft,
      invoiceStatus: terms.invoiceStatus,
      feeSource: terms.feeSource,
    });
  }

  return { windows, scanned };
}

// ------------------------------------------------------------
// Suggestion building (pure)
// ------------------------------------------------------------

/** Milestone prefix: one pending timer per (deal, phase), ever. */
export function guaranteeMilestonePrefix(
  dealId: string,
  phase: GuaranteePhase,
): string {
  return phase === 'ending' ? `s_gw_end_${dealId}_` : `s_gw_over_${dealId}_`;
}

/** Deterministic per-episode id: same (deal, phase, window end) ⇒ same id. */
export function guaranteeSuggestionId(
  dealId: string,
  phase: GuaranteePhase,
  windowEndTs: string,
): string {
  return `${guaranteeMilestonePrefix(dealId, phase)}${windowEndTs.replace(/[^A-Za-z0-9]/g, '')}`;
}

const FOOTER = 'ההצעה אינה משנה את מצב הכרטיס — ההחלטה אצלך.';

/**
 * Suggestion input for a guarantee window. NO ₪ anywhere by construction.
 * Evidence cites the fee record (guarantee terms) + the placement date,
 * both with their numbers inline (audit ⑥.2 contract).
 */
export function buildGuaranteeSuggestion(
  win: GuaranteeWindow,
  deal: Deal,
): SuggestionInput {
  const jobTitle = sanitizeMessageText(deal.jobTitle).trim();
  const startMs = parseTs(win.placement.ts) as number;
  const endMs = parseTs(win.windowEndTs) as number;

  const feeEvidence = {
    claim: `תקופת אחריות במנדט: ${win.guaranteeDays} ימים (סטטוס חשבונית: ${invoiceStatusHe(win.invoiceStatus)})`,
    sourceType: win.feeSource === 'mandate' ? 'fee' : 'deal',
    sourceId: win.feeSource === 'mandate' ? win.jobId : win.dealId,
  };
  const placementEvidence = {
    claim: `תאריך השמה: ${isoDate(startMs)}; חלון האחריות מסתיים ב-${isoDate(endMs)} (${
      win.phase === 'ending'
        ? `בעוד ${d1(win.daysLeft)} ימים`
        : `לפני ${d1(-win.daysLeft)} ימים`
    })`,
    sourceType: win.placement.source === 'stage_entered_at' ? 'deal' : 'event',
    sourceId: win.placement.sourceId,
  };

  if (win.phase === 'ending') {
    const daysCeil = Math.max(1, Math.ceil(win.daysLeft));
    const bodyLines = [
      `העסקה "${jobTitle}" (שלב: ${win.stage}): תקופת אחריות מסתיימת בעוד ${daysCeil} ימים.`,
      `• השמה: ${isoDate(startMs)} · חלון אחריות: ${win.guaranteeDays} ימים · מסתיים: ${isoDate(endMs)}`,
      'פעולה מומלצת: לוודא שהמועמד/ת יציב/ה בתפקיד לפני תום תקופת האחריות.',
      FOOTER,
    ];
    return {
      id: guaranteeSuggestionId(win.dealId, 'ending', win.windowEndTs),
      agent: GUARANTEE_AGENT,
      kind: 'flag',
      dealId: win.dealId,
      personId: win.personId,
      title: sanitizeMessageText(
        `תקופת אחריות מסתיימת בעוד ${daysCeil} ימים: ${jobTitle}`,
      ),
      body: sanitizeMessageText(bodyLines.join('\n')),
      evidence: [feeEvidence, placementEvidence],
    };
  }

  const action =
    win.invoiceStatus === 'sent'
      ? 'לוודא שהתשלום מתקבל — החשבונית כבר נשלחה.'
      : 'להוציא חשבונית ללקוח.';
  const bodyLines = [
    `העסקה "${jobTitle}" (שלב: ${win.stage}): תקופת האחריות הסתיימה ב-${isoDate(endMs)} — העמלה מובטחת.`,
    `• השמה: ${isoDate(startMs)} · חלון אחריות: ${win.guaranteeDays} ימים`,
    `פעולה מומלצת: ${action}`,
    FOOTER,
  ];
  return {
    id: guaranteeSuggestionId(win.dealId, 'ended', win.windowEndTs),
    agent: GUARANTEE_AGENT,
    kind: 'next_action',
    dealId: win.dealId,
    personId: win.personId,
    title: sanitizeMessageText(`תקופת האחריות הסתיימה — העמלה מובטחת: ${jobTitle}`),
    body: sanitizeMessageText(bodyLines.join('\n')),
    evidence: [feeEvidence, placementEvidence],
  };
}

function invoiceStatusHe(status: MandateInvoiceStatus): string {
  switch (status) {
    case 'none':
      return 'טרם הופקה';
    case 'due':
      return 'לקראת הפקה';
    case 'sent':
      return 'נשלחה';
    case 'paid':
      return 'שולמה';
  }
}

// ------------------------------------------------------------
// Sweep planning (pure)
// ------------------------------------------------------------

export type GuaranteeSkipReason = 'exists' | 'pending_milestone';

export interface GuaranteeSweepPlan {
  /** Every actionable window, whether or not a suggestion is filed. */
  windows: GuaranteeWindow[];
  /** Live Placed/Paid deals with guarantee terms (scan scope). */
  scanned: number;
  toFile: Array<{ window: GuaranteeWindow; input: SuggestionInput }>;
  skipped: Array<{ window: GuaranteeWindow; reason: GuaranteeSkipReason }>;
}

/**
 * The whole sweep as data. Skip rules (in order):
 *   - 'exists': a suggestion with this episode's deterministic id already
 *     exists in ANY status — dismissals are final for the episode;
 *   - 'pending_milestone': a live pending suggestion for the same
 *     (deal, phase) milestone exists under a different window end (e.g.
 *     guaranteeDays was edited while the old timer is still pending) —
 *     never two pending timers for one deal+milestone.
 */
export function planGuaranteeSweep(
  deals: readonly Deal[],
  fees: Record<string, MandateFee>,
  events: readonly StageEvent[],
  suggestions: readonly Suggestion[],
  now: Date | string,
): GuaranteeSweepPlan {
  const { windows, scanned } = detectGuaranteeWindows(deals, fees, events, now);
  const dealById = new Map<string, Deal>();
  for (const d of deals) if (!d.deleted) dealById.set(d.id, d);

  const existingIds = new Set(suggestions.map((s) => s.id));
  const pendingIds = suggestions
    .filter((s) => !s.deleted && s.status === 'pending')
    .map((s) => s.id);

  const toFile: GuaranteeSweepPlan['toFile'] = [];
  const skipped: GuaranteeSweepPlan['skipped'] = [];

  for (const win of windows) {
    const id = guaranteeSuggestionId(win.dealId, win.phase, win.windowEndTs);
    if (existingIds.has(id)) {
      skipped.push({ window: win, reason: 'exists' });
      continue;
    }
    const prefix = guaranteeMilestonePrefix(win.dealId, win.phase);
    if (pendingIds.some((pid) => pid.startsWith(prefix))) {
      skipped.push({ window: win, reason: 'pending_milestone' });
      continue;
    }
    const deal = dealById.get(win.dealId);
    if (!deal) continue; // windows come from live deals — defensive only
    toFile.push({ window: win, input: buildGuaranteeSuggestion(win, deal) });
  }

  return { windows, scanned, toFile, skipped };
}

// ------------------------------------------------------------
// Client variant — app-open sweep (mirrors runSlaSweepOnLoad)
// ------------------------------------------------------------

/** Structural store view — satisfied by usePipelineStore; injectable. */
export interface GuaranteePipelineState {
  v3Enabled: boolean;
  deals: Deal[];
  stageEvents: StageEvent[];
  suggestions: Suggestion[];
  addSuggestion(input: SuggestionInput): Suggestion;
}

export interface GuaranteePipelineStore {
  getState(): GuaranteePipelineState;
}

/** Structural fees view — satisfied by useMoneyStore; injectable. */
export interface GuaranteeFeesStore {
  getState(): { fees: Record<string, MandateFee> };
}

export interface GuaranteeSweepResult {
  ran: boolean;
  reason?: 'flag_off';
  windows: GuaranteeWindow[];
  /** Suggestions actually filed this run. */
  created: Suggestion[];
  skipped: GuaranteeSweepPlan['skipped'];
}

/**
 * App-open sweep. Flag-gated (v3 off ⇒ store untouched). Files each
 * plannable window through addSuggestion — the single sanctioned agent
 * write path (audit-attributed 'ai'/'pit_boss' by the store). Fees come
 * from the money store (the client-side authority, `revital_v3_fees`).
 */
export function runGuaranteeSweepOnLoad(
  pipelineStore: GuaranteePipelineStore = usePipelineStore,
  feesStore: GuaranteeFeesStore = useMoneyStore,
  now: Date | string = new Date(),
): GuaranteeSweepResult {
  const state = pipelineStore.getState();
  if (!state.v3Enabled) {
    return { ran: false, reason: 'flag_off', windows: [], created: [], skipped: [] };
  }

  const plan = planGuaranteeSweep(
    state.deals,
    feesStore.getState().fees,
    state.stageEvents,
    state.suggestions,
    now,
  );
  const created: Suggestion[] = [];
  for (const { input } of plan.toFile) {
    created.push(pipelineStore.getState().addSuggestion(input));
  }
  return { ran: true, windows: plan.windows, created, skipped: plan.skipped };
}
