// ============================================================
// Revital V3 — Pipeline Type Contract (Wave 0)
// Authored by platform-data per docs/plans/platform-data-wave0.md,
// then handed to the lead. Contract: docs/REVITAL-V3-PRODUCT-PLAN.md §2, §3.
// ============================================================

/** Schema version persisted with every v3 payload (client meta + server blob). */
export const PIPELINE_SCHEMA_VERSION = 1;

// ------------------------------------------------------------
// Versioned envelope — every synced v3 record extends this.
// ------------------------------------------------------------

export interface Versioned {
  /** Client-generated UUID. */
  id: string;
  /**
   * SERVER-assigned version counter (LWW ordering). 0 = never synced.
   * Client clocks are NEVER used for conflict resolution.
   */
  v: number;
  /** ISO timestamp — informational/display only, never consulted by merge. */
  updatedAt: string;
  /** Tombstone marker. Records are never physically removed by merge. */
  deleted?: true;
  deletedAt?: string;
}

// ------------------------------------------------------------
// Stages
// ------------------------------------------------------------

/** The nine pipeline stages, in order. */
export const PIPELINE_STAGES = [
  'Sourced',
  'Screened',
  'Outreach',
  'InConversation',
  'Submitted',
  'ClientInterview',
  'Offer',
  'Placed',
  'Paid',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** All deal stages: nine pipeline columns + Bench side rail + Rejected (with reason). */
export type DealStage = PipelineStage | 'Bench' | 'Rejected';

// ------------------------------------------------------------
// Person — one human, across N deals/mandates (plan §2)
// ------------------------------------------------------------

export type ContactEventKind =
  | 'contacted'
  | 'replied'
  | 'no_reply'
  | 'meeting_set';

export interface ContactEvent {
  kind: ContactEventKind;
  ts: string;
  /** Channel of the outbound contact (wa.me / mailto auto-log). */
  channel?: 'whatsapp' | 'email';
  /** Hash of the outbound message body (wa.me/mailto auto-log). */
  messageHash?: string;
  /** Which deal prompted the contact, when known. */
  dealId?: string;
}

export interface Person extends Versioned {
  name: string;
  /** Derived — see src/lib/persistence/dedupe.ts. */
  normalizedName: string;
  phone?: string;
  email?: string;
  linkedinUrl?: string;
  /** Links into legacy CandidateAnalysis records (read-only references). */
  analysisIds: string[];
  /** Reply-state & outreach history live on the Person, not the card. */
  contactEvents: ContactEvent[];
  /** Present when the person is filed on the Bench rail. */
  bench?: {
    reason: string;
    since: string;
    /** Wave-3 metadata (D-037): when benched, why, and silver-medalist status. */
    benchedAt?: string;
    benchReason?: string;
    /** True when a deal reached Submitted+ before Rejected; never downgraded. */
    silverMedalist?: boolean;
  };
  notes?: string;
}

// ------------------------------------------------------------
// FeeTerms & Deal
// ------------------------------------------------------------

export type InvoiceStatus = 'none' | 'pending' | 'sent' | 'paid';

export interface FeeTerms {
  kind: 'percent' | 'fixed';
  /** Percent of annual salary (kind = 'percent'). */
  percent?: number;
  /** Fixed fee in ILS (kind = 'fixed'). */
  fixedAmountILS?: number;
  /** Expected annual salary in ILS — basis for percent fees. */
  expectedSalaryILS?: number;
  /** Guarantee period in days (timer runs on Placed/Paid). */
  guaranteeDays?: number;
  invoiceStatus?: InvoiceStatus;
}

export type DealOwner = 'revital' | 'agent';

export interface Deal extends Versioned {
  personId: string;
  /** Legacy JobDescription.id — the mandate. */
  jobId: string;
  /** Denormalized for card display. */
  jobTitle: string;
  stage: DealStage;
  /** ISO — when the deal entered its current stage (aging ring source). */
  stageEnteredAt: string;
  fee?: FeeTerms;
  /** Editable prior override for this deal's stage probability (0..1). */
  probabilityOverride?: number;
  nextAction?: {
    label: string;
    owner: DealOwner;
  };
  /** Required when stage === 'Rejected'. */
  rejection?: {
    reason: string;
    ts: string;
  };
  /** Link to the CandidateAnalysis that scored this deal, if any. */
  analysisId?: string;
  createdAt: string;
}

// ------------------------------------------------------------
// StageEvent — append-only move log, incl. skip-events (plan §2)
// ------------------------------------------------------------

export type StageEventActor = 'human' | 'agent' | 'system';

export interface StageEvent extends Versioned {
  dealId: string;
  /** null = card creation. */
  from: DealStage | null;
  to: DealStage;
  ts: string;
  actor: StageEventActor;
  /**
   * Stages jumped over in this move (non-empty ⇒ skip-event).
   * Conversion stats must exclude skipped intervals.
   */
  skippedStages: PipelineStage[];
  /** Mandatory when to === 'Rejected'. */
  reason?: string;
}

// ------------------------------------------------------------
// Suggestion — the only agent output (single-writer, plan §3)
// ------------------------------------------------------------

export type AgentName =
  | 'screener'
  | 'bench_sourcer'
  | 'outreach_runner'
  | 'client_reporter'
  | 'pit_boss';

export type SuggestionKind =
  | 'draft_message'
  | 'new_card'
  | 'flag'
  | 'report'
  | 'next_action'
  | 'rematch'
  | 'bench_match'
  | 'merge_person';

export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export interface SuggestionEvidence {
  /** Human-readable claim ("scored 82 on Backend pillar"). */
  claim: string;
  /** Record backing the claim, e.g. analysis/deal/event id. */
  sourceType: string;
  sourceId: string;
}

export interface Suggestion extends Versioned {
  agent: AgentName;
  kind: SuggestionKind;
  dealId?: string;
  personId?: string;
  title: string;
  /** Full proposed content (Hebrew draft, report body, etc.). */
  body: string;
  evidence: SuggestionEvidence[];
  status: SuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
  /** Stamped at accept time: true iff the user edited the body before accepting (edit-rate metric, D-029/D-036). */
  editedBeforeAccept?: boolean;
}

// ------------------------------------------------------------
// AgentRun — execution log for every agent invocation
// ------------------------------------------------------------

export type AgentRunTrigger = 'cron' | 'app_open' | 'manual' | 'event';

export type AgentRunOutcome = 'ok' | 'error' | 'capped';

export interface AgentRun extends Versioned {
  agent: AgentName;
  trigger: AgentRunTrigger;
  startedAt: string;
  finishedAt?: string;
  itemsProcessed: number;
  suggestionsCreated: number;
  tokensUsed?: number;
  outcome: AgentRunOutcome;
  error?: string;
}

// ------------------------------------------------------------
// AuditEvent — append-only, plan §7 shape
// ------------------------------------------------------------

export type AuditActor = 'human' | 'ai';

export interface AuditEvent {
  id: string;
  actor: AuditActor;
  /** Agent name when actor === 'ai' (e.g. 'screener', 'pitboss') — attribution chips, plan §2. */
  agent?: string;
  /** e.g. 'deal.move', 'suggestion.accept', 'person.delete', 'undo'. */
  action: string;
  /** Snapshot before the change (JSON-serializable), null on create. */
  before: unknown;
  /** Snapshot after the change, null on delete. */
  after: unknown;
  ts: string;
  /** Entity kind (e.g. 'deal', 'person', 'suggestion'). Required for per-entity rotation, plan §5. */
  entityType: string;
  /** Entity id the event is about. Required for per-entity rotation. */
  entityId: string;
}

// ------------------------------------------------------------
// Sync payload shapes (client ↔ /api/data v3 section)
// ------------------------------------------------------------

export interface PipelineSyncPayload {
  schemaVersion: number;
  persons: Person[];
  deals: Deal[];
  events: StageEvent[];
  suggestions: Suggestion[];
  agentRuns: AgentRun[];
}

export interface PipelineMeta {
  schemaVersion: number;
  lastSyncAt: string | null;
}
