// Revital V3 — money lib public surface (Wave 2, platform-data).
// Consumers (kanban-ui, agents-engine) import from 'src/lib/money'.

export {
  feeAmount,
  type MandateFee,
  type MandateFeeKind,
  type MandateInvoiceStatus,
} from './mandateFee';

export {
  BLEND_MIN_OBSERVATIONS,
  DEFAULT_STAGE_PRIORS,
  PRIORS_KEY,
  effectiveProbability,
  effectiveProbabilityRange,
  loadPriors,
  observedStageStats,
  priorMidpoint,
  sanitizePriors,
  savePriors,
  type EffectiveProbabilityRange,
  type ObservedStageStats,
  type StagePriorRange,
  type StagePriors,
} from './priors';

export {
  EARLY_STAGES,
  QUALIFIED_STAGES,
  dealEV,
  isPastScreened,
  mandateCalibrated,
  qualifiedPipeline,
  type ObservedByStage,
  type QualifiedPipelineResult,
} from './ev';

export {
  SEEDING_KEY,
  asyncSeedingFormText,
  buildPendingSeeding,
  deriveBaseline,
  isSeeded,
  sanitizeSeeding,
  type BaselineBasis,
  type BaselineMetrics,
  type DeriveBaselineOptions,
  type LegacyHistoryRef,
  type MandateSeeding,
  type PendingSeeding,
  type PendingSeedingCandidate,
  type PendingSeedingMandate,
  type SeedingState,
} from './seeding';

export {
  MONEY_KEYS,
  feeAmountForJob,
  feeForJob,
  isMandateCalibrated,
  isMandateSeeded,
  qualifiedPipelineSnapshot,
  unseededMandates,
  useMoneyStore,
  type MandateFeeInput,
  type MoneyState,
} from './moneyStore';
