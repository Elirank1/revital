// ============================================================
// Revital V3 — invoice-reminder pass (rule-27 audit ⑥.3, agents-engine)
//
// Closes audit item ⑥.3 "Invoice reminders": `invoiceStatus` /
// `invoiceDueAt` were captured and drove "צפוי החודש", but no reminder
// ever FIRED for a due or overdue invoice. This pass makes the reminder
// real — as Suggestions only (single-writer, plan §3).
//
// Deterministic only — NO LLM, no spend guard, no send path.
//
// Invoice state machine per mandate (MandateFee.invoiceStatus), applied
// over mandates with ≥1 live Placed/Paid deal AND a complete fee
// (feeAmount != null — never nag about an amount-less invoice; the
// amount itself is NEVER rendered, calibration safety):
//   'none' / 'due' → milestone 'issue'  — "להוציא חשבונית"
//       gated past the guarantee window when one is set: while ANY of
//       the mandate's placements is still inside its guarantee window
//       the fee is not safe and the guarantee pass owns the timeline;
//   'sent'         → milestone 'remind' — "תזכורת תשלום" when STALE:
//       invoiceDueAt set   ⇒ stale the moment now ≥ invoiceDueAt
//                            (an overdue invoice needs no extra grace);
//       invoiceDueAt absent ⇒ stale after INVOICE_STALE_DAYS (14) from
//                            the fee record's updatedAt (the flip to
//                            'sent' stamps it — closest honest proxy
//                            for the send date, documented D-058);
//   'paid'         → never (explicit terminal state).
//
// Fee-view source precedence mirrors guarantee.ts (D-057/D-058):
// MandateFee (fees[jobId], client authority) → legacy synced Deal.fee
// (FeeTerms; 'pending' maps to 'due', staleness basis falls back to the
// fee-bearing deal's updatedAt) — so the SERVER tick can fire from
// synced data while the mandate-fee ledger stays client-local pre-G3.
//
// Cross-pass dedupe (D-058): a guarantee-ENDED episode that is pending —
// or about to be filed by the guarantee pass in this same sweep —
// already proposes the invoice step for that mandate, so 'issue' is
// skipped ('guarantee_pending') until that episode is resolved. Once
// Revital accepts or dismisses it, the standing 'issue' reminder takes
// over (its own episode, its own dismissal finality).
//
// Idempotency mirrors sla.ts: deterministic ids — 'issue' is one episode
// per mandate ("s_inv_issue_{jobId}": the none→sent transition awaited;
// dismissal is final until the status machine moves), 'remind' is keyed
// by its staleness basis (a re-sent invoice / new due date = new
// episode). A pending same-milestone suggestion always blocks re-filing.
// ============================================================

import type { Deal, StageEvent, Suggestion } from '../types/pipeline';
import {
  feeAmount,
  type MandateFee,
  type MandateInvoiceStatus,
} from '../lib/money/mandateFee';
import { useMoneyStore } from '../lib/money/moneyStore';
import { sanitizeMessageText } from '../lib/outreach';
import {
  usePipelineStore,
  type SuggestionInput,
} from '../store/pipelineStore';
import {
  GUARANTEE_STAGES,
  guaranteeMilestonePrefix,
  guaranteeSuggestionId,
  resolveGuaranteeTerms,
  resolvePlacement,
} from './guarantee';

/** Same attribution as the guarantee pass — the Pit Boss watches money. */
export const INVOICE_AGENT = 'pit_boss' as const;

/** 'sent' with no due date goes stale this many days after the record. */
export const INVOICE_STALE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseTs(ts: string | undefined): number | null {
  if (typeof ts !== 'string' || ts === '') return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function d1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ------------------------------------------------------------
// Fee view resolution (MandateFee → legacy Deal.fee)
// ------------------------------------------------------------

interface MandateFeeView {
  complete: boolean;
  invoiceStatus: MandateInvoiceStatus;
  invoiceDueAt?: string;
  /** Staleness fallback basis (record update ts) — see header. */
  recordUpdatedAt: string;
  feeSource: 'mandate' | 'deal';
}

function legacyComplete(fee: NonNullable<Deal['fee']>): boolean {
  if (fee.kind === 'percent') {
    return (
      typeof fee.percent === 'number' &&
      Number.isFinite(fee.percent) &&
      fee.percent > 0 &&
      typeof fee.expectedSalaryILS === 'number' &&
      Number.isFinite(fee.expectedSalaryILS) &&
      fee.expectedSalaryILS > 0
    );
  }
  if (fee.kind === 'fixed') {
    return (
      typeof fee.fixedAmountILS === 'number' &&
      Number.isFinite(fee.fixedAmountILS) &&
      fee.fixedAmountILS > 0
    );
  }
  return false;
}

function mapLegacyInvoiceStatus(
  status: string | undefined,
): MandateInvoiceStatus {
  if (status === 'sent' || status === 'paid') return status;
  if (status === 'pending') return 'due';
  return 'none';
}

/** The mandate's effective fee view, or null when no fee exists anywhere. */
function resolveFeeView(
  jobId: string,
  fees: Record<string, MandateFee>,
  mandateDeals: readonly Deal[],
): MandateFeeView | null {
  const mandateFee = fees[jobId];
  if (mandateFee) {
    return {
      complete: feeAmount(mandateFee) !== null,
      invoiceStatus: mandateFee.invoiceStatus,
      ...(mandateFee.invoiceDueAt !== undefined
        ? { invoiceDueAt: mandateFee.invoiceDueAt }
        : {}),
      recordUpdatedAt: mandateFee.updatedAt,
      feeSource: 'mandate',
    };
  }
  // Legacy fallback: the first (placement-ordered) deal carrying FeeTerms.
  const bearer = mandateDeals.find((d) => d.fee !== undefined);
  if (!bearer || !bearer.fee) return null;
  return {
    complete: legacyComplete(bearer.fee),
    invoiceStatus: mapLegacyInvoiceStatus(bearer.fee.invoiceStatus),
    recordUpdatedAt: bearer.updatedAt,
    feeSource: 'deal',
  };
}

// ------------------------------------------------------------
// Detection (pure)
// ------------------------------------------------------------

export type InvoiceMilestone = 'issue' | 'remind';

export interface InvoiceFinding {
  jobId: string;
  /** Anchor deal: the mandate's earliest placement (ties: dealId asc). */
  dealId: string;
  personId: string;
  milestone: InvoiceMilestone;
  invoiceStatus: MandateInvoiceStatus;
  /** 'remind' only: what staleness was measured against. */
  basisKind?: 'invoice_due_at' | 'record_updated';
  basisTs?: string;
  /** 'remind' only: fractional days past the basis. */
  daysStale?: number;
  /** 'issue' with a guarantee: when the (latest) window ended, ISO. */
  guaranteeEndedTs?: string;
  feeSource: 'mandate' | 'deal';
}

export interface InvoiceDetection {
  findings: InvoiceFinding[];
  /** Mandates with ≥1 live Placed/Paid deal and a fee view (scan scope). */
  scanned: number;
}

/**
 * Invoice actions over mandates with live Placed/Paid deals — the state
 * machine documented in the header. Pure and deterministic.
 */
export function detectInvoiceActions(
  fees: Record<string, MandateFee>,
  deals: readonly Deal[],
  events: readonly StageEvent[],
  now: Date | string,
): InvoiceDetection {
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  if (!Number.isFinite(nowMs)) return { findings: [], scanned: 0 };

  // Group live Placed/Paid deals by mandate, placement-ordered.
  const byJob = new Map<string, Deal[]>();
  for (const deal of deals) {
    if (deal.deleted) continue;
    if (!GUARANTEE_STAGES.includes(deal.stage)) continue;
    const list = byJob.get(deal.jobId);
    if (list) list.push(deal);
    else byJob.set(deal.jobId, [deal]);
  }

  const findings: InvoiceFinding[] = [];
  let scanned = 0;

  // Deterministic mandate order (jobId asc) — same inputs ⇒ same output.
  for (const jobId of [...byJob.keys()].sort()) {
    const group = byJob.get(jobId) as Deal[];
    // Placement order: earliest placement first, dealId asc on ties.
    const withPlacement = group
      .map((d) => ({
        deal: d,
        placedMs: parseTs(resolvePlacement(d, events)?.ts) ?? Infinity,
      }))
      .sort(
        (a, b) =>
          a.placedMs - b.placedMs ||
          (a.deal.id < b.deal.id ? -1 : a.deal.id > b.deal.id ? 1 : 0),
      );
    const ordered = withPlacement.map((w) => w.deal);
    const anchor = ordered[0];

    const view = resolveFeeView(jobId, fees, ordered);
    if (!view) continue;
    scanned += 1;
    if (!view.complete) continue;
    if (view.invoiceStatus === 'paid') continue;

    if (view.invoiceStatus === 'none' || view.invoiceStatus === 'due') {
      // Guarantee gate: every placement must be past its window.
      let latestEndMs: number | null = null;
      let insideWindow = false;
      for (const deal of ordered) {
        const terms = resolveGuaranteeTerms(deal, fees);
        if (!terms) continue;
        const startMs = parseTs(resolvePlacement(deal, events)?.ts);
        if (startMs === null) continue;
        const endMs = startMs + terms.guaranteeDays * MS_PER_DAY;
        if (endMs > nowMs) {
          insideWindow = true;
          break;
        }
        if (latestEndMs === null || endMs > latestEndMs) latestEndMs = endMs;
      }
      if (insideWindow) continue; // guarantee pass owns the timeline
      findings.push({
        jobId,
        dealId: anchor.id,
        personId: anchor.personId,
        milestone: 'issue',
        invoiceStatus: view.invoiceStatus,
        ...(latestEndMs !== null
          ? { guaranteeEndedTs: new Date(latestEndMs).toISOString() }
          : {}),
        feeSource: view.feeSource,
      });
      continue;
    }

    // 'sent' — staleness per the documented basis rules.
    const dueMs = parseTs(view.invoiceDueAt);
    if (dueMs !== null) {
      if (nowMs < dueMs) continue; // not due yet
      findings.push({
        jobId,
        dealId: anchor.id,
        personId: anchor.personId,
        milestone: 'remind',
        invoiceStatus: 'sent',
        basisKind: 'invoice_due_at',
        basisTs: view.invoiceDueAt as string,
        daysStale: (nowMs - dueMs) / MS_PER_DAY,
        feeSource: view.feeSource,
      });
      continue;
    }
    const recordMs = parseTs(view.recordUpdatedAt);
    if (recordMs === null) continue; // no truthful staleness basis
    const daysStale = (nowMs - recordMs) / MS_PER_DAY;
    if (daysStale <= INVOICE_STALE_DAYS) continue;
    findings.push({
      jobId,
      dealId: anchor.id,
      personId: anchor.personId,
      milestone: 'remind',
      invoiceStatus: 'sent',
      basisKind: 'record_updated',
      basisTs: view.recordUpdatedAt,
      daysStale,
      feeSource: view.feeSource,
    });
  }

  return { findings, scanned };
}

// ------------------------------------------------------------
// Suggestion building (pure)
// ------------------------------------------------------------

/** Milestone prefix: one pending reminder per (mandate, milestone). */
export function invoiceMilestonePrefix(
  jobId: string,
  milestone: InvoiceMilestone,
): string {
  return milestone === 'issue' ? `s_inv_issue_${jobId}` : `s_inv_remind_${jobId}_`;
}

/** Deterministic episode id — see header for episode semantics. */
export function invoiceSuggestionId(finding: InvoiceFinding): string {
  if (finding.milestone === 'issue') {
    return invoiceMilestonePrefix(finding.jobId, 'issue');
  }
  const basis = (finding.basisTs ?? '').replace(/[^A-Za-z0-9]/g, '');
  return `${invoiceMilestonePrefix(finding.jobId, 'remind')}${basis}`;
}

const FOOTER = 'ההצעה אינה משנה את מצב הכרטיס — ההחלטה אצלך.';

/**
 * 'next_action' suggestion for an invoice finding. NO ₪ anywhere —
 * feeAmount gates eligibility and is never rendered (calibration safety).
 */
export function buildInvoiceSuggestion(
  finding: InvoiceFinding,
  deal: Deal,
): SuggestionInput {
  const jobTitle = sanitizeMessageText(deal.jobTitle).trim();
  const feeSourceRef =
    finding.feeSource === 'mandate'
      ? { sourceType: 'fee', sourceId: finding.jobId }
      : { sourceType: 'deal', sourceId: finding.dealId };

  if (finding.milestone === 'issue') {
    const guaranteeLine =
      finding.guaranteeEndedTs !== undefined
        ? `תקופת האחריות הסתיימה ב-${isoDate(parseTs(finding.guaranteeEndedTs) as number)} — העמלה מובטחת.`
        : null;
    const enteredMs = parseTs(deal.stageEnteredAt) ?? parseTs(deal.createdAt);
    const evidence = [
      {
        claim: `סטטוס חשבונית במנדט: ${finding.invoiceStatus === 'due' ? 'לקראת הפקה' : 'טרם הופקה'} (עסקה בשלב ${deal.stage}${enteredMs !== null ? ` מאז ${isoDate(enteredMs)}` : ''})`,
        ...feeSourceRef,
      },
      ...(finding.guaranteeEndedTs !== undefined
        ? [
            {
              claim: `תקופת האחריות הסתיימה ב-${isoDate(parseTs(finding.guaranteeEndedTs) as number)}`,
              ...feeSourceRef,
            },
          ]
        : []),
    ];
    const bodyLines = [
      `המנדט "${jobTitle}" עבר השמה (שלב: ${deal.stage}) וטרם הופקה עליו חשבונית.`,
      ...(guaranteeLine ? [`• ${guaranteeLine}`] : []),
      'פעולה מומלצת: להוציא חשבונית ללקוח.',
      FOOTER,
    ];
    return {
      id: invoiceSuggestionId(finding),
      agent: INVOICE_AGENT,
      kind: 'next_action',
      dealId: finding.dealId,
      personId: finding.personId,
      title: sanitizeMessageText(`להוציא חשבונית: ${jobTitle}`),
      body: sanitizeMessageText(bodyLines.join('\n')),
      evidence,
    };
  }

  const staleDays = d1(finding.daysStale ?? 0);
  const basisMs = parseTs(finding.basisTs) as number;
  const staleClaim =
    finding.basisKind === 'invoice_due_at'
      ? `תאריך היעד לתשלום עבר: ${isoDate(basisMs)} (לפני ${staleDays} ימים)`
      : `החשבונית נשלחה ולא עודכן תשלום מאז ${isoDate(basisMs)} — ${staleDays} ימים (סף: ${INVOICE_STALE_DAYS} ימים)`;
  const bodyLines = [
    `חשבונית למנדט "${jobTitle}" נשלחה וטרם סומנה כשולמה.`,
    `• ${staleClaim}`,
    'פעולה מומלצת: לשלוח ללקוח תזכורת תשלום.',
    FOOTER,
  ];
  return {
    id: invoiceSuggestionId(finding),
    agent: INVOICE_AGENT,
    kind: 'next_action',
    dealId: finding.dealId,
    personId: finding.personId,
    title: sanitizeMessageText(`תזכורת תשלום: ${jobTitle}`),
    body: sanitizeMessageText(bodyLines.join('\n')),
    evidence: [{ claim: staleClaim, ...feeSourceRef }],
  };
}

// ------------------------------------------------------------
// Sweep planning (pure)
// ------------------------------------------------------------

export type InvoiceSkipReason =
  | 'exists'
  | 'pending_milestone'
  | 'guarantee_pending';

export interface InvoiceSweepPlan {
  findings: InvoiceFinding[];
  /** Mandates examined (fee view + live Placed/Paid deal). */
  scanned: number;
  toFile: Array<{ finding: InvoiceFinding; input: SuggestionInput }>;
  skipped: Array<{ finding: InvoiceFinding; reason: InvoiceSkipReason }>;
}

/**
 * The whole sweep as data. Skip rules (in order):
 *   - 'exists': this episode's deterministic id already exists in ANY
 *     status — dismissals are final for the episode;
 *   - 'pending_milestone': a live pending suggestion for the same
 *     (mandate, milestone) exists (e.g. an older 'remind' basis) —
 *     never two pending reminders for one mandate+milestone;
 *   - 'guarantee_pending' ('issue' only): the mandate has a guarantee-
 *     ENDED episode that is pending, or not yet filed — the guarantee
 *     pass files it in this same sweep and it already carries the
 *     invoice step (cross-pass dedupe, D-058).
 */
export function planInvoiceSweep(
  fees: Record<string, MandateFee>,
  deals: readonly Deal[],
  events: readonly StageEvent[],
  suggestions: readonly Suggestion[],
  now: Date | string,
): InvoiceSweepPlan {
  const { findings, scanned } = detectInvoiceActions(fees, deals, events, now);
  const dealById = new Map<string, Deal>();
  for (const d of deals) if (!d.deleted) dealById.set(d.id, d);

  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const pendingIds = suggestions
    .filter((s) => !s.deleted && s.status === 'pending')
    .map((s) => s.id);

  // Guarantee-ENDED episodes per mandate: live (pending or unfiled) ones
  // block the standing 'issue' reminder — resolved ones do not.
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  const blockedJobs = new Set<string>();
  for (const deal of deals) {
    if (deal.deleted) continue;
    if (!GUARANTEE_STAGES.includes(deal.stage)) continue;
    const terms = resolveGuaranteeTerms(deal, fees);
    if (!terms) continue;
    const startMs = parseTs(resolvePlacement(deal, events)?.ts);
    if (startMs === null) continue;
    const endMs = startMs + terms.guaranteeDays * MS_PER_DAY;
    if (!Number.isFinite(nowMs) || endMs > nowMs) continue; // not ended
    const overId = guaranteeSuggestionId(
      deal.id,
      'ended',
      new Date(endMs).toISOString(),
    );
    const existing = byId.get(overId);
    const overPrefix = guaranteeMilestonePrefix(deal.id, 'ended');
    const pendingOver = pendingIds.some((pid) => pid.startsWith(overPrefix));
    if (!existing || existing.status === 'pending' || pendingOver) {
      blockedJobs.add(deal.jobId);
    }
  }

  const toFile: InvoiceSweepPlan['toFile'] = [];
  const skipped: InvoiceSweepPlan['skipped'] = [];

  for (const finding of findings) {
    const id = invoiceSuggestionId(finding);
    if (byId.has(id)) {
      skipped.push({ finding, reason: 'exists' });
      continue;
    }
    const prefix = invoiceMilestonePrefix(finding.jobId, finding.milestone);
    if (pendingIds.some((pid) => pid !== id && pid.startsWith(prefix))) {
      skipped.push({ finding, reason: 'pending_milestone' });
      continue;
    }
    if (finding.milestone === 'issue' && blockedJobs.has(finding.jobId)) {
      skipped.push({ finding, reason: 'guarantee_pending' });
      continue;
    }
    const deal = dealById.get(finding.dealId);
    if (!deal) continue; // findings come from live deals — defensive only
    toFile.push({ finding, input: buildInvoiceSuggestion(finding, deal) });
  }

  return { findings, scanned, toFile, skipped };
}

// ------------------------------------------------------------
// Client variant — app-open sweep (mirrors runSlaSweepOnLoad)
// ------------------------------------------------------------

/** Structural store view — satisfied by usePipelineStore; injectable. */
export interface InvoicePipelineState {
  v3Enabled: boolean;
  deals: Deal[];
  stageEvents: StageEvent[];
  suggestions: Suggestion[];
  addSuggestion(input: SuggestionInput): Suggestion;
}

export interface InvoicePipelineStore {
  getState(): InvoicePipelineState;
}

/** Structural fees view — satisfied by useMoneyStore; injectable. */
export interface InvoiceFeesStore {
  getState(): { fees: Record<string, MandateFee> };
}

export interface InvoiceSweepResult {
  ran: boolean;
  reason?: 'flag_off';
  findings: InvoiceFinding[];
  /** Suggestions actually filed this run. */
  created: Suggestion[];
  skipped: InvoiceSweepPlan['skipped'];
}

/**
 * App-open sweep. Flag-gated (v3 off ⇒ store untouched). Files each
 * plannable finding through addSuggestion — the single sanctioned agent
 * write path (audit-attributed 'ai'/'pit_boss' by the store).
 */
export function runInvoiceSweepOnLoad(
  pipelineStore: InvoicePipelineStore = usePipelineStore,
  feesStore: InvoiceFeesStore = useMoneyStore,
  now: Date | string = new Date(),
): InvoiceSweepResult {
  const state = pipelineStore.getState();
  if (!state.v3Enabled) {
    return { ran: false, reason: 'flag_off', findings: [], created: [], skipped: [] };
  }

  const plan = planInvoiceSweep(
    feesStore.getState().fees,
    state.deals,
    state.stageEvents,
    state.suggestions,
    now,
  );
  const created: Suggestion[] = [];
  for (const { input } of plan.toFile) {
    created.push(pipelineStore.getState().addSuggestion(input));
  }
  return { ran: true, findings: plan.findings, created, skipped: plan.skipped };
}
