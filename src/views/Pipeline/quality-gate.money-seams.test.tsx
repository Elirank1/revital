// @vitest-environment jsdom
/**
 * Wave-2 money seams (quality-gate, batch C) — independent cross-teammate
 * verification the owners could not do from inside their own modules:
 *
 *  1. fee→EV agreement across SURFACES: the same fee + priors must yield
 *     the same numbers on the header (platform-data math via MoneyHeader),
 *     the deal card chip, the column ΣEV, and the Money Board lane —
 *     four different call paths into src/lib/money. Expected values are
 *     HAND-COMPUTED from DEFAULT_STAGE_PRIORS constants (not read back
 *     from the lib), then cross-checked against the lib so a drift in
 *     either direction fails.
 *  2. Conservation: lane range midpoint == header qualified Σ + early
 *     range midpoint (no deal counted twice, none dropped).
 *  3. Today's ₪-at-risk agrees with dealEV × reason weight computed from
 *     the exported Pit Boss thresholds (rankMoveTheMoney is not trusted
 *     to grade its own homework).
 *  4. The FULL server→client loop: tick handler → redisBridgeStore over
 *     a mocked Redis blob → simulated /api/data GET → pullV3 → store →
 *     suggestions rendered in the board's inbox panel. Asserts the
 *     single-writer rail (persons/deals byte-identical after the agent
 *     write), server-assigned versions, money-free server suggestions
 *     (no ₪ across the wire — server fees are empty by design), and
 *     that the pull marks nothing dirty.
 *
 * Synthetic fixtures only; no real network (pullV3 gets an injected
 * fetch; Redis is an in-memory map) — gate G2.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { usePipelineStore } from '../../store/pipelineStore';
import {
  DEFAULT_STAGE_PRIORS,
  qualifiedPipeline,
  useMoneyStore,
} from '../../lib/money';
import { formatILS } from '../../components/pipeline/money';
import {
  FEEDBACK_OVERDUE_DAYS,
  rankMoveTheMoney,
} from '../../agents/pitboss';
import {
  agentDataKey,
  redisBridgeStore,
  type BlobRedis,
} from '../../../api/_lib/agentStore';
import { createTickHandler, type TickResponse } from '../../../api/agents/tick';
import { pullV3 } from '../../lib/persistence/sync';
import { PipelineView } from './PipelineView';
import { TodayView } from './TodayView';
import { resetMoneyStore, resetPipelineStore, seedFee } from './storeTestKit';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetPipelineStore();
  resetMoneyStore();
});

afterEach(() => {
  cleanup();
});

// ------------------------------------------------------------------
// Fixture helpers (public store actions only)
// ------------------------------------------------------------------

function addDealFor(name: string, jobId: string, jobTitle: string, stage: string) {
  const store = usePipelineStore.getState();
  const { person } = store.addPerson({ name });
  const deal = store.addDeal({
    personId: person.id,
    jobId,
    jobTitle,
    stage: stage as never,
  });
  return { person, deal };
}

/** Pin a deal's stage entry to an exact ISO instant (deterministic aging). */
function setStageEnteredAt(dealId: string, iso: string): void {
  usePipelineStore.setState((s) => ({
    deals: s.deals.map((d) => (d.id === dealId ? { ...d, stageEnteredAt: iso } : d)),
  }));
}

// ------------------------------------------------------------------
// 1+2 — fee→EV agreement across header / card / column / lane
// ------------------------------------------------------------------

describe('fee→EV agreement across surfaces (one fee, four call paths)', () => {
  // Hand-computed from DEFAULT_STAGE_PRIORS (fixed fee ₪40,000):
  //   Submitted       {0.20,0.35} → range  8,000–14,000, midpoint 11,000
  //   ClientInterview {0.30,0.50} → range 12,000–20,000, midpoint 16,000
  //   Outreach        {0.05,0.10} → range  2,000– 4,000, midpoint  3,000
  const FEE = 40_000;
  const EXPECTED = {
    header: '₪27,000', // 11,000 + 16,000 (Submitted+ midpoints only)
    early: '₪2,000–₪4,000',
    colSubmitted: '₪8,000–₪14,000',
    colClientInterview: '₪12,000–₪20,000',
    colOutreach: '₪2,000–₪4,000',
    lane: '₪22,000–₪38,000', // Σ ranges over all three deals
  };

  function seedBoard() {
    addDealFor('נועה לוי', 'job-A', 'Backend Lead', 'Submitted');
    addDealFor('אבי כהן', 'job-A', 'Backend Lead', 'ClientInterview');
    addDealFor('רות אדרי', 'job-A', 'Backend Lead', 'Outreach');
    // Control mandate: past-Screened deal but an INCOMPLETE fee (percent
    // without salary) — must contribute to no figure on any surface.
    addDealFor('גיל שחר', 'job-B', 'Data Analyst', 'Submitted');
    seedFee({ jobId: 'job-A', kind: 'fixed', fixedAmount: FEE });
    seedFee({ jobId: 'job-B', kind: 'percent', percent: 20 }); // no salary → null
  }

  it('header, cards, columns and lanes all render the SAME hand-computed numbers', () => {
    seedBoard();

    // Cross-check the lib against the hand arithmetic before rendering.
    const { deals } = usePipelineStore.getState();
    const { fees, priors } = useMoneyStore.getState();
    const qp = qualifiedPipeline(deals, fees, priors);
    expect(qp.qualifiedEV).toBe(27_000);
    expect(qp.qualifiedDealCount).toBe(2);
    expect(qp.earlyRange).toEqual({ lo: 2_000, hi: 4_000 });
    expect(qp.calibratedJobIds).toEqual(['job-A']);
    expect(qp.uncalibratedJobIds).toEqual(['job-B']);

    render(<PipelineView />);

    // Header (call path 1: qualifiedPipeline via MoneyHeader).
    expect(screen.getByTestId('qualified-ev').textContent).toContain(EXPECTED.header);
    expect(screen.getByTestId('early-range').textContent).toContain(EXPECTED.early);

    // Columns (call path 2: columnEvRange). The uncalibrated job-B deal
    // shares the Submitted column and must not move its Σ.
    expect(screen.getByTestId('ev-Submitted').textContent).toBe(`ΣEV ${EXPECTED.colSubmitted}`);
    expect(screen.getByTestId('ev-ClientInterview').textContent).toBe(`ΣEV ${EXPECTED.colClientInterview}`);
    expect(screen.getByTestId('ev-Outreach').textContent).toBe(`ΣEV ${EXPECTED.colOutreach}`);

    // Cards (call path 3: evRangeForCalibratedDeal). Exactly ONE chip in
    // the Submitted column — job-B's card renders no ₪.
    const submittedCol = screen.getByTestId('column-Submitted');
    const chips = within(submittedCol).getAllByTestId('ev-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe(EXPECTED.colSubmitted);

    // Lane (call path 4: buildMandateLanes in the Money Board).
    fireEvent.click(screen.getByTestId('tab-money'));
    expect(screen.getByTestId('lane-ev-job-A').textContent).toBe(EXPECTED.lane);
    expect(screen.queryByTestId('lane-ev-job-B')).toBeNull();
    expect(screen.getByTestId('lane-uncalibrated-job-B').textContent).toContain('ללא כיול');
  });

  it('conservation: lane midpoint == header qualified Σ + early-range midpoint', () => {
    seedBoard();
    const { deals } = usePipelineStore.getState();
    const { fees, priors } = useMoneyStore.getState();
    const qp = qualifiedPipeline(deals, fees, priors);

    // Lane bounds from the hand table: 22,000–38,000 → midpoint 30,000.
    const laneMid = (22_000 + 38_000) / 2;
    const earlyMid = ((qp.earlyRange?.lo ?? 0) + (qp.earlyRange?.hi ?? 0)) / 2;
    expect((qp.qualifiedEV ?? 0) + earlyMid).toBe(laneMid);
    expect(laneMid).toBe(30_000);
  });
});

// ------------------------------------------------------------------
// 3 — Today's ₪-at-risk agrees with dealEV × reason weight
// ------------------------------------------------------------------

describe("Today's evAtRisk agrees with money-lib EV × Pit Boss weights", () => {
  it('a 10-day Submitted deal shows exactly ₪ round(EV × (10-6)/6)', () => {
    const NOW_MS = Date.parse('2026-07-31T12:00:00.000Z');
    const FEE = 40_000;

    const { deal } = addDealFor('נועה לוי', 'job-A', 'Backend Lead', 'Submitted');
    // A second deal keeps the mandate calibrated but carries no risk
    // (fresh ClientInterview entry — sole deal in its stage, no reasons).
    const { deal: calm } = addDealFor('אבי כהן', 'job-A', 'Backend Lead', 'ClientInterview');
    seedFee({ jobId: 'job-A', kind: 'fixed', fixedAmount: FEE });
    setStageEnteredAt(deal.id, new Date(NOW_MS - 10 * DAY_MS).toISOString());
    setStageEnteredAt(calm.id, new Date(NOW_MS).toISOString());

    // Hand arithmetic from exported constants: EV = 40,000 × 0.275 = 11,000;
    // sole deal in Submitted ⇒ age == stage median ⇒ NO aging reason;
    // feedback weight = (10 − 6) / 6 = 2/3 ⇒ evAtRisk = 22,000/3 ≈ 7,333.33.
    const mid =
      (DEFAULT_STAGE_PRIORS.Submitted.lo + DEFAULT_STAGE_PRIORS.Submitted.hi) / 2;
    const expectedEv = FEE * mid;
    const weight = (10 - FEEDBACK_OVERDUE_DAYS) / FEEDBACK_OVERDUE_DAYS;
    const expectedAtRisk = expectedEv * weight;
    expect(formatILS(expectedAtRisk)).toBe('₪7,333');

    // Independent ranker call over the same inputs (server-style path).
    const { deals } = usePipelineStore.getState();
    const { fees, priors } = useMoneyStore.getState();
    const items = rankMoveTheMoney(deals, fees, priors, [], new Date(NOW_MS));
    expect(items).toHaveLength(1);
    expect(items[0].dealId).toBe(deal.id);
    expect(items[0].ev).toBeCloseTo(expectedEv, 8);
    expect(items[0].evAtRisk).toBeCloseTo(expectedAtRisk, 8);
    expect(items[0].reasons.map((r) => r.kind)).toEqual(['client_feedback_overdue']);

    // The rendered surface (client bridge path) shows the same shekels.
    render(<TodayView now={() => NOW_MS} />);
    const rows = screen.getAllByTestId('mtm-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByTestId('mtm-ev').textContent).toBe('₪7,333');
  });
});

// ------------------------------------------------------------------
// 4 — full loop: tick → bridge (mocked Redis) → pullV3 → rendered inbox
// ------------------------------------------------------------------

const NOW = '2026-07-31T12:00:00.000Z';
const SECRET = 'seam-secret';
const CODE = 'SEAM1';

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY_MS).toISOString();
}

function mockRedis(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const redis: BlobRedis = {
    async get(key) {
      const v = store.get(key);
      return v === undefined ? null : JSON.parse(JSON.stringify(v));
    },
    async set(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
      return 'OK';
    },
  };
  return { redis, store };
}

/** Server blob: one 5d-silent Outreach deal + one 10d Submitted deal. */
function serverBlob() {
  return {
    analyses: [{ id: 'legacy-1' }],
    savedJobs: [],
    log: [{ id: 'legacy-log' }],
    v3: {
      schemaVersion: 1,
      vCounter: 10,
      persons: [
        {
          id: 'p-dana',
          v: 1,
          updatedAt: NOW,
          name: 'דנה כהן',
          normalizedName: 'דנה כהן',
          phone: '0521234567',
          analysisIds: [],
          contactEvents: [{ kind: 'contacted', ts: daysAgo(5), channel: 'whatsapp' }],
        },
        {
          id: 'p-yossi',
          v: 2,
          updatedAt: NOW,
          name: 'יוסי לוי',
          normalizedName: 'יוסי לוי',
          analysisIds: [],
          contactEvents: [],
        },
      ],
      deals: [
        {
          id: 'd-out',
          v: 3,
          updatedAt: NOW,
          personId: 'p-dana',
          jobId: 'j1',
          jobTitle: 'Backend Engineer',
          stage: 'Outreach',
          stageEnteredAt: daysAgo(5),
          createdAt: daysAgo(12),
        },
        {
          id: 'd-sub',
          v: 4,
          updatedAt: NOW,
          personId: 'p-yossi',
          jobId: 'j2',
          jobTitle: 'Data Engineer',
          stage: 'Submitted',
          stageEnteredAt: daysAgo(10),
          createdAt: daysAgo(20),
        },
      ],
      events: [],
      suggestions: [],
      agentRuns: [],
    },
  };
}

function makeReq(body: unknown): VercelRequest {
  return {
    method: 'POST',
    headers: { 'x-cron-secret': SECRET },
    body,
  } as unknown as VercelRequest;
}

function makeRes() {
  const out: { status?: number; json?: TickResponse } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: never) {
      out.json = payload;
      return res;
    },
  };
  return { res: res as unknown as VercelResponse, out };
}

/** fetch stub that serves the mocked Redis blob as /api/data would. */
function fetchFromRedis(store: Map<string, unknown>): typeof fetch {
  return (async () => {
    const blob = JSON.parse(JSON.stringify(store.get(agentDataKey(CODE)) ?? {}));
    return {
      ok: true,
      status: 200,
      json: async () => blob,
    };
  }) as unknown as typeof fetch;
}

describe('server→client loop: tick → bridge → pullV3 → rendered inbox', () => {
  it('tick suggestions cross the wire and surface in the board inbox, money-free', async () => {
    const { redis, store: redisMap } = mockRedis({
      [agentDataKey(CODE)]: serverBlob(),
    });
    const handler = createTickHandler({
      store: redisBridgeStore(redis),
      env: { CRON_SECRET: SECRET },
      now: new Date(NOW),
    });

    // ---- server side: run the tick against the bridge ----------------
    const { res, out } = makeRes();
    await handler(makeReq({ codes: [CODE] }), res);
    expect(out.status).toBe(200);
    expect(out.json?.ok).toBe(true);
    expect(out.json?.partial).toBe(false);
    const byAgent = Object.fromEntries(
      (out.json?.ran ?? []).map((r) => [r.agent, r]),
    );
    expect(byAgent.outreach_runner?.produced).toBe(1); // d-out follow-up
    expect(byAgent.pit_boss?.produced).toBe(2); // d-out silence + d-sub feedback

    // Bridge rails on the stored blob: suggestions written with
    // server-assigned versions; persons/deals/legacy sections untouched.
    const before = serverBlob();
    const after = JSON.parse(JSON.stringify(redisMap.get(agentDataKey(CODE)))) as {
      analyses: unknown[];
      log: unknown[];
      v3: {
        persons: unknown[];
        deals: unknown[];
        events: unknown[];
        suggestions: Array<{ id: string; v: number; status: string; body: string }>;
      };
    };
    expect(after.v3.suggestions).toHaveLength(3);
    for (const s of after.v3.suggestions) {
      expect(s.v).toBeGreaterThan(before.v3.vCounter);
      expect(s.status).toBe('pending');
    }
    expect(after.v3.persons).toEqual(before.v3.persons);
    expect(after.v3.deals).toEqual(before.v3.deals);
    expect(after.v3.events).toEqual(before.v3.events);
    expect(after.analyses).toEqual(before.analyses);
    expect(after.log).toEqual(before.log);
    // Server ranks with EMPTY fees (client-local in Wave 2) — not one ₪
    // may exist anywhere in the agent-written records.
    expect(JSON.stringify(after.v3.suggestions)).not.toContain('₪');

    // ---- client side: pull the same blob and render ------------------
    const result = await pullV3(CODE, fetchFromRedis(redisMap));
    expect(result.ok).toBe(true);

    const state = usePipelineStore.getState();
    expect(state.suggestions).toHaveLength(3);
    expect(state.deals.map((d) => d.id).sort()).toEqual(['d-out', 'd-sub']);
    // A pull must not create dirty state (nothing to echo back).
    const payload = state.buildPushPayload();
    expect(payload.persons).toHaveLength(0);
    expect(payload.deals).toHaveLength(0);
    expect(payload.events).toHaveLength(0);
    expect(payload.suggestions).toHaveLength(0);

    render(<PipelineView />);
    expect(screen.getByTestId('inbox-badge-count').textContent).toBe('3');

    // The pulled deals feed the same board the suggestions point at.
    const outreachCol = screen.getByTestId('column-Outreach');
    expect(within(outreachCol).getByText('דנה כהן')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('inbox-badge'));
    });
    const items = screen.getAllByTestId('suggestion-item');
    expect(items).toHaveLength(3);
    const inboxText = items.map((el) => el.textContent ?? '').join('\n');
    expect(inboxText).toContain('לטיפול: Backend Engineer (Outreach)');
    expect(inboxText).toContain('לטיפול: Data Engineer (Submitted)');
    expect(inboxText).toContain('טיוטת פולו-אפ: דנה כהן — Backend Engineer');
    // Evidence claims carry the day counts (numeric, auditable)…
    expect(inboxText).toMatch(/ימים ללא מענה/);
    expect(inboxText).toMatch(/ללא משוב לקוח/);
    // …and the calibration hard rule holds across the wire: no ₪.
    expect(inboxText).not.toContain('₪');
  });

  it('re-ticking after the pull produces nothing new (episode idempotency through the real bridge)', async () => {
    const { redis, store: redisMap } = mockRedis({
      [agentDataKey(CODE)]: serverBlob(),
    });
    const handler = createTickHandler({
      store: redisBridgeStore(redis),
      env: { CRON_SECRET: SECRET },
      now: new Date(NOW),
    });

    const first = makeRes();
    await handler(makeReq({ codes: [CODE] }), first.res);
    const second = makeRes();
    await handler(makeReq({ codes: [CODE] }), second.res);

    expect(second.out.status).toBe(200);
    for (const entry of second.out.json?.ran ?? []) {
      expect(entry.produced).toBe(0);
    }
    const after = JSON.parse(
      JSON.stringify(redisMap.get(agentDataKey(CODE))),
    ) as { v3: { suggestions: unknown[] } };
    expect(after.v3.suggestions).toHaveLength(3); // same three episodes
  });
});
