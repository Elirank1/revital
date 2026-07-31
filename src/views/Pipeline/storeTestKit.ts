/**
 * Test-only helpers for kanban-ui DOM tests (jsdom) — Wave 1.
 * Resets the real pipeline store between tests and seeds it through the
 * PUBLIC contract actions (addPerson/addDeal/addSuggestion) so the UI
 * tests double as integration tests of the binding store API.
 * Not imported by any production code.
 */

import { usePipelineStore } from '../../store/pipelineStore';
import {
  DEFAULT_STAGE_PRIORS,
  useMoneyStore,
  type MandateFeeInput,
} from '../../lib/money';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Reset the Wave-2 money slice (fees + priors) to a clean default. */
export function resetMoneyStore(): void {
  useMoneyStore.setState({
    fees: {},
    priors: JSON.parse(JSON.stringify(DEFAULT_STAGE_PRIORS)),
  });
}

/** Seed a mandate fee through the public store action (audited). */
export function seedFee(input: MandateFeeInput) {
  return useMoneyStore.getState().setFee(input);
}

/** Wipe persisted v3 state and reset the store to a clean, flag-on board. */
export function resetPipelineStore(opts: { enabled?: boolean } = {}): void {
  const enabled = opts.enabled ?? true;
  localStorage.clear();
  if (enabled) localStorage.setItem('revital_v3_flag', 'on');
  usePipelineStore.setState({
    v3Enabled: enabled,
    persons: [],
    deals: [],
    stageEvents: [],
    suggestions: [],
    auditLog: [],
    undoStack: [],
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
}

/** Seed one person + one deal via the public contract actions. */
export function seedPersonWithDeal(args: {
  name: string;
  phone?: string;
  jobTitle: string;
  stage?: Parameters<ReturnType<typeof usePipelineStore.getState>['addDeal']>[0]['stage'];
}) {
  const store = usePipelineStore.getState();
  const { person } = store.addPerson({ name: args.name, phone: args.phone });
  const deal = store.addDeal({
    personId: person.id,
    jobId: `job_${person.id}`,
    jobTitle: args.jobTitle,
    stage: args.stage,
  });
  return { person, deal };
}

/** Rewind a deal's stageEnteredAt so aging tests are deterministic. */
export function backdateDeal(dealId: string, days: number): void {
  usePipelineStore.setState((s) => ({
    deals: s.deals.map((d) =>
      d.id === dealId
        ? { ...d, stageEnteredAt: new Date(Date.now() - days * DAY_MS).toISOString() }
        : d,
    ),
  }));
}
