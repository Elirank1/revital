/**
 * Pipeline column model — Wave 0 scaffold (kanban-ui).
 *
 * The 9 deal-stage board columns of the V3 Placement OS (plan §2), plus the
 * Bench rail. Pure render data (labels + order) for the board UI.
 *
 * Stage ids are the canonical `PipelineStage` values from
 * `src/types/pipeline.ts` (authored by platform-data, owned by the lead
 * post-Wave-0) — imported as a type only, never redefined here.
 */

import type { DealStage, PipelineStage } from '../../types/pipeline';

export interface StageColumnDef {
  /** Canonical stage id (matches `PipelineStage` in `src/types/pipeline.ts`). */
  id: PipelineStage;
  /** Hebrew label (renders with dir="auto"). */
  he: string;
  /** English label (renders with dir="auto"). */
  en: string;
}

/** The 9 board columns, in pipeline order (plan §2 / charter task 2). */
export const STAGE_COLUMNS: readonly StageColumnDef[] = [
  { id: 'Sourced', he: 'מקורות', en: 'Sourced' },
  { id: 'Screened', he: 'סוננו', en: 'Screened' },
  { id: 'Outreach', he: 'פנייה', en: 'Outreach' },
  { id: 'InConversation', he: 'בשיחה', en: 'In Conversation' },
  { id: 'Submitted', he: 'הוגשו', en: 'Submitted' },
  { id: 'ClientInterview', he: 'ראיון לקוח', en: 'Client Interview' },
  { id: 'Offer', he: 'הצעה', en: 'Offer' },
  { id: 'Placed', he: 'הושמו', en: 'Placed' },
  { id: 'Paid', he: 'שולם', en: 'Paid' },
] as const;

/** Side rail: rejected / silver-medalist Persons archive here as reusable capital. */
export const BENCH_RAIL: { id: DealStage; he: string; en: string } = {
  id: 'Bench',
  he: 'ספסל',
  en: 'Bench',
} as const;
