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
import { reloadSeeding } from '../../lib/money/seeding';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Reset the Wave-2/3 money slice (fees + priors + seeding) to a clean
 *  default. Re-hydrates the seeding registry from localStorage — call
 *  AFTER resetPipelineStore's localStorage.clear() (the existing test
 *  ordering) so the registry comes back empty. */
export function resetMoneyStore(): void {
  useMoneyStore.setState({
    fees: {},
    priors: JSON.parse(JSON.stringify(DEFAULT_STAGE_PRIORS)),
    seeding: reloadSeeding(),
  });
}

/** Seed a mandate fee through the public store actions (audited).
 *  Wave-3 C-seed: also marks the mandate SEEDED — this helper models the
 *  first-open wizard fixture (fee captured + cards confirmed), which is
 *  what every pre-C-seed test meant by "the fee exists". Tests probing
 *  the unseeded state call `setFee` directly instead. */
export function seedFee(input: MandateFeeInput) {
  const fee = useMoneyStore.getState().setFee(input);
  useMoneyStore.getState().markMandateSeeded(input.jobId);
  return fee;
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
