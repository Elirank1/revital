/**
 * Reporting barrel — Client Reporter surface (Wave 2, integrations).
 * Deterministic core; the only LLM touchpoint (polishWithClaude) is
 * default-OFF and requires an injected fetch. Nothing here navigates,
 * sends, or writes to the store (G4 + single-writer).
 */

export { buildMandateReport } from './mandateReport';
export type {
  EvidenceRef,
  MandateReport,
  MandateReportOptions,
  ReportLine,
  ReportSection,
} from './mandateReport';

export { booleanStrings } from './booleanStrings';
export type { BooleanQuery, QueryLang } from './booleanStrings';

export { polishWithClaude } from './polish';
export type { PolishResult, PolishWithClaudeOptions } from './polish';
