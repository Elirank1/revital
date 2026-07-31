// ============================================================
// Revital V3 — Pit Boss (Wave 2, agents-engine)
//
// BINDING contract: docs/waves/wave2-contract.md §Pit Boss —
// rankMoveTheMoney(deals, fees, priors, contacts, now) → sorted
// [{dealId, evAtRisk, reasons[]}]. Deterministic, auditable, NO LLM:
// same inputs ⇒ same output, always. Pure function used by the Today
// view (client) AND the daily tick (server).
//
// Risk model (all weights deterministic, each clamped to [0,1]):
//   - aging_past_median:      days-in-stage beyond the stage cohort's
//                             median age (plan §2 staleness flag);
//   - client_feedback_overdue: >6d sitting in Submitted/ClientInterview;
//   - followup_due:           ≥3d silence in Outreach/InConversation
//                             (detection shared with src/agents/sla.ts);
//   - offer_decaying:         offer open past a 2-day grace window.
//
// evAtRisk = dealEV × Σweights for CALIBRATED mandates (money lib is
// the single source of ₪ math — imported, never reimplemented). The
// Σ may exceed 1 when risks compound: evAtRisk is a priority score
// denominated in ₪, not a bounded loss estimate.
//
// CALIBRATION HARD RULE: uncalibrated mandates still rank (their risk
// signals are money-free facts) but with ev: null and evAtRisk: 0 —
// no ₪ is ever attached to them, in items, suggestions, or evidence.
//
// Every suggestion cites its numeric inputs in evidence (contract).
// ============================================================

import {
  PIPELINE_STAGES,
  type Deal,
  type DealStage,
  type PipelineStage,
} from '../types/pipeline';
import { type MandateFee } from '../lib/money/mandateFee';
import {
  dealEV,
  mandateCalibrated,
  type ObservedByStage,
} from '../lib/money/ev';
import { type StagePriors } from '../lib/money/priors';
import { type ContactRef } from '../lib/metrics/leadingIndicators';
import { sanitizeMessageText } from '../lib/outreach';
import type { SuggestionInput } from '../store/pipelineStore';
import { detectSilences, SLA_SILENCE_DAYS, type SilenceBreach } from './sla';

export const PIT_BOSS_AGENT = 'pit_boss' as const;

// Thresholds — exported constants so tests and the UI cite the same numbers.
export const FEEDBACK_OVERDUE_DAYS = 6;
export const FEEDBACK_STAGES: readonly DealStage[] = [
  'Submitted',
  'ClientInterview',
];
export const OFFER_DECAY_GRACE_DAYS = 2;
export const OFFER_DECAY_RAMP_DAYS = 5;
export const FOLLOWUP_RAMP_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PIPELINE_STAGE_SET = new Set<string>(PIPELINE_STAGES);

function parseTs(ts: string): number | null {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Round to one decimal for claims — inputs keep full precision. */
function d1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ------------------------------------------------------------
// Result types
// ------------------------------------------------------------

export type PitBossReasonKind =
  | 'aging_past_median'
  | 'client_feedback_overdue'
  | 'followup_due'
  | 'offer_decaying';

export interface PitBossReason {
  kind: PitBossReasonKind;
  /** Deterministic contribution to riskWeight, clamped to [0,1]. */
  weight: number;
  /** Hebrew human-readable claim carrying the numbers inline. */
  claim: string;
  /** The exact numeric inputs behind the claim (auditability). */
  inputs: Record<string, number>;
}

export interface MoveTheMoneyItem {
  dealId: string;
  jobId: string;
  personId: string;
  stage: DealStage;
  /** mandateCalibrated(jobId): ₪ may be rendered ONLY when true. */
  calibrated: boolean;
  /** dealEV for calibrated mandates; null (never 0-as-guess) otherwise. */
  ev: number | null;
  /** Σ reason weights — money-free severity (may exceed 1). */
  riskWeight: number;
  /** ev × riskWeight for calibrated mandates; 0 otherwise (no ₪ meaning). */
  evAtRisk: number;
  reasons: PitBossReason[];
}

// ------------------------------------------------------------
// rankMoveTheMoney — the contract surface
// ------------------------------------------------------------

/** Median of a non-empty list (average of middle pair when even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rank live deals by EV-at-risk. Deterministic ordering:
 * evAtRisk desc → riskWeight desc → dealId asc. Only deals with at
 * least one risk reason appear. Bench/Rejected/Paid never rank.
 *
 * `observed` (optional) enables blended stage probabilities exactly as
 * the money lib defines them; omit for pure prior-midpoint EV.
 */
export function rankMoveTheMoney(
  deals: readonly Deal[],
  fees: Record<string, MandateFee>,
  priors: StagePriors,
  contacts: readonly ContactRef[],
  now: Date | string,
  observed?: ObservedByStage,
): MoveTheMoneyItem[] {
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const live = deals.filter((d) => !d.deleted);

  // Age in stage per deal (null when stageEnteredAt is unparsable —
  // no truthful day count exists, so no time-based reason fires).
  const ageDays = new Map<string, number>();
  for (const d of live) {
    const entered = parseTs(d.stageEnteredAt);
    if (entered === null) continue;
    ageDays.set(d.id, Math.max(0, (nowMs - entered) / MS_PER_DAY));
  }

  // Stage-median ages over the live cohort currently in each stage.
  const byStage = new Map<string, number[]>();
  for (const d of live) {
    const age = ageDays.get(d.id);
    if (age === undefined) continue;
    if (!PIPELINE_STAGE_SET.has(d.stage)) continue;
    const list = byStage.get(d.stage);
    if (list) list.push(age);
    else byStage.set(d.stage, [age]);
  }
  const stageMedian = new Map<string, number>();
  for (const [stage, ages] of byStage) stageMedian.set(stage, median(ages));

  // Silence breaches — SAME detection the SLA sweep uses (one rule).
  const silenceByDeal = new Map<string, SilenceBreach>();
  for (const b of detectSilences(live, contacts, now)) {
    silenceByDeal.set(b.dealId, b);
  }

  const items: MoveTheMoneyItem[] = [];

  for (const deal of live) {
    // Only pipeline stages can hold money in motion; Paid is banked.
    if (!PIPELINE_STAGE_SET.has(deal.stage) || deal.stage === 'Paid') continue;
    const stage = deal.stage as PipelineStage;
    const age = ageDays.get(deal.id);
    const reasons: PitBossReason[] = [];

    // 1. aging past stage-median
    if (age !== undefined) {
      const med = stageMedian.get(stage);
      if (med !== undefined && age > med) {
        const overshoot = age - med;
        reasons.push({
          kind: 'aging_past_median',
          weight: clamp01(overshoot / Math.max(med, 1)),
          claim: `${d1(age)} ימים בשלב ${stage} — מעל חציון השלב (${d1(med)} ימים)`,
          inputs: { ageDays: age, medianAgeDays: med, overshootDays: overshoot },
        });
      }
    }

    // 2. overdue client feedback (>6d after Submitted+)
    if (
      age !== undefined &&
      FEEDBACK_STAGES.includes(stage) &&
      age > FEEDBACK_OVERDUE_DAYS
    ) {
      reasons.push({
        kind: 'client_feedback_overdue',
        weight: clamp01((age - FEEDBACK_OVERDUE_DAYS) / FEEDBACK_OVERDUE_DAYS),
        claim: `${d1(age)} ימים ללא משוב לקוח מאז הכניסה ל-${stage} (סף: ${FEEDBACK_OVERDUE_DAYS} ימים)`,
        inputs: { daysWaiting: age, thresholdDays: FEEDBACK_OVERDUE_DAYS },
      });
    }

    // 3. follow-up due (3d silence in Outreach/InConversation)
    const silence = silenceByDeal.get(deal.id);
    if (silence !== undefined) {
      reasons.push({
        kind: 'followup_due',
        weight: clamp01(silence.daysSilent / FOLLOWUP_RAMP_DAYS),
        claim: `${d1(silence.daysSilent)} ימים ללא מענה מאז הפנייה האחרונה (סף: ${SLA_SILENCE_DAYS} ימים)`,
        inputs: {
          daysSilent: silence.daysSilent,
          thresholdDays: SLA_SILENCE_DAYS,
        },
      });
    }

    // 4. offers decaying
    if (age !== undefined && stage === 'Offer' && age > OFFER_DECAY_GRACE_DAYS) {
      reasons.push({
        kind: 'offer_decaying',
        weight: clamp01((age - OFFER_DECAY_GRACE_DAYS) / OFFER_DECAY_RAMP_DAYS),
        claim: `הצעה פתוחה ${d1(age)} ימים — מעבר לחלון של ${OFFER_DECAY_GRACE_DAYS} ימים`,
        inputs: { daysInOffer: age, graceDays: OFFER_DECAY_GRACE_DAYS },
      });
    }

    if (reasons.length === 0) continue;

    const fee = fees[deal.jobId] ?? null;
    const calibrated = mandateCalibrated(deal.jobId, fee, live);
    const ev = calibrated ? dealEV(deal, fee, priors, observed) : null;
    const riskWeight = reasons.reduce((sum, r) => sum + r.weight, 0);

    items.push({
      dealId: deal.id,
      jobId: deal.jobId,
      personId: deal.personId,
      stage: deal.stage,
      calibrated: calibrated && ev !== null,
      ev,
      riskWeight,
      evAtRisk: ev !== null ? ev * riskWeight : 0,
      reasons,
    });
  }

  items.sort((a, b) => {
    if (a.evAtRisk !== b.evAtRisk) return b.evAtRisk - a.evAtRisk;
    if (a.riskWeight !== b.riskWeight) return b.riskWeight - a.riskWeight;
    return a.dealId < b.dealId ? -1 : a.dealId > b.dealId ? 1 : 0;
  });

  return items;
}

// ------------------------------------------------------------
// Suggestion building (tick + optional client use)
// ------------------------------------------------------------

/** Deterministic per-episode id: same (deal, stage entry) ⇒ same id, so
 *  a daily tick can re-emit blindly — LWW merge drops the repeat and a
 *  dismissal stays dismissed until the deal moves stage. */
export function pitBossSuggestionId(
  dealId: string,
  stageEnteredAt: string,
): string {
  return `s_pb_${dealId}_${stageEnteredAt.replace(/[^A-Za-z0-9]/g, '')}`;
}

const NEXT_ACTION_BY_REASON: Record<PitBossReasonKind, string> = {
  followup_due: 'לשלוח פולו-אפ למועמד/ת',
  client_feedback_overdue: 'לבקש עדכון מהלקוח על המועמדות',
  offer_decaying: 'לקדם החלטה על ההצעה לפני שהיא מתקררת',
  aging_past_median: 'לבדוק את הכרטיס ולהחליט על הצעד הבא',
};

/**
 * 'next_action' Suggestion for a ranked item. Every claim is numeric and
 * evidence-backed; ₪ appears ONLY for calibrated items (hard rule).
 * jobTitle passes BiDi sanitization before interpolation.
 */
export function pitBossSuggestionInput(
  item: MoveTheMoneyItem,
  deal: Deal,
): SuggestionInput {
  const jobTitle = sanitizeMessageText(deal.jobTitle).trim();

  // Highest-weight reason drives the recommended action; ties resolve by
  // reason order (stable — reasons are built in a fixed sequence).
  const top = item.reasons.reduce((best, r) =>
    r.weight > best.weight ? r : best,
  );

  const evidence = item.reasons.map((r) => ({
    claim: sanitizeMessageText(r.claim),
    sourceType: r.kind === 'followup_due' ? 'person' : 'deal',
    sourceId: r.kind === 'followup_due' ? item.personId : item.dealId,
  }));
  if (item.calibrated && item.ev !== null) {
    evidence.push({
      claim: `EV ₪${Math.round(item.ev)} = עמלת המנדט × הסתברות שלב ${item.stage}; בסיכון: ₪${Math.round(item.evAtRisk)}`,
      sourceType: 'fee',
      sourceId: item.jobId,
    });
  }

  const bodyLines = [
    `ה-Pit Boss סימן את העסקה "${jobTitle}" (שלב: ${item.stage}) כדורשת טיפול:`,
    ...item.reasons.map((r) => `• ${sanitizeMessageText(r.claim)}`),
    ...(item.calibrated && item.ev !== null
      ? [`שווי צפוי (EV): ₪${Math.round(item.ev)} — מזה בסיכון: ₪${Math.round(item.evAtRisk)}.`]
      : []),
    `פעולה מומלצת: ${NEXT_ACTION_BY_REASON[top.kind]}.`,
    'ההצעה אינה משנה את מצב הכרטיס — ההחלטה אצלך.',
  ];

  return {
    id: pitBossSuggestionId(item.dealId, deal.stageEnteredAt),
    agent: PIT_BOSS_AGENT,
    kind: 'next_action',
    dealId: item.dealId,
    personId: item.personId,
    title: sanitizeMessageText(`לטיפול: ${jobTitle} (${item.stage})`),
    body: sanitizeMessageText(bodyLines.join('\n')),
    evidence,
  };
}
