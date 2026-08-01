// Wave-3B Bench Sourcer: precision-throttle math, incremental cursors,
// defensive JSON parsing with citation grounding, budget/spend-cap
// behavior, and the injected-transport rail (zero real network)
// (docs/waves/wave3-tasks.md §Bench Sourcer).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Deal, Person, Suggestion } from '../types/pipeline';
import {
  BENCH_AGENT,
  BENCH_BASE_VOLUME,
  BENCH_BATCH_PERSONS,
  BENCH_MIN_SCORE,
  BenchSpendCapError,
  benchAcceptStats,
  benchPersonSnapshot,
  benchSuggestionId,
  buildBenchPrompt,
  buildBenchSuggestion,
  isSpendCapError,
  lastBenchCursor,
  lastBenchVolume,
  openMandates,
  parseBenchResponse,
  planBenchPairs,
  runBenchPass,
  throttledVolume,
  type BenchMandate,
  type BenchMatchTransport,
  type BenchPersonSnapshot,
  type BenchRunMeta,
  type BenchSourcerView,
} from './benchSourcer';

const NOW = '2026-07-31T12:00:00.000Z';

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function person(id: string, v: number, overrides: Partial<Person> = {}): Person {
  return {
    id,
    v,
    updatedAt: NOW,
    name: `Person ${id}`,
    normalizedName: `person ${id}`,
    analysisIds: [],
    contactEvents: [],
    bench: { reason: 'סיבה', since: NOW },
    ...overrides,
  };
}

function deal(
  id: string,
  personId: string,
  jobId: string,
  stage: Deal['stage'],
  v: number,
  overrides: Partial<Deal> = {},
): Deal {
  return {
    id,
    v,
    updatedAt: NOW,
    personId,
    jobId,
    jobTitle: `Job ${jobId}`,
    stage,
    stageEnteredAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function benchSuggestion(
  id: string,
  status: Suggestion['status'],
  overrides: Partial<Suggestion> = {},
): Suggestion {
  return {
    id,
    v: 1,
    updatedAt: NOW,
    agent: BENCH_AGENT,
    kind: 'bench_match',
    personId: 'p1',
    title: 't',
    body: 'b',
    evidence: [],
    status,
    createdAt: NOW,
    ...overrides,
  };
}

function benchRun(v: number, overrides: Partial<BenchRunMeta> = {}): BenchRunMeta {
  return {
    id: `run-${v}`,
    v,
    updatedAt: NOW,
    agent: BENCH_AGENT,
    trigger: 'cron',
    startedAt: NOW,
    itemsProcessed: 0,
    suggestionsCreated: 0,
    outcome: 'ok',
    ...overrides,
  };
}

function view(overrides: Partial<BenchSourcerView> = {}): BenchSourcerView {
  return {
    persons: [],
    deals: [],
    suggestions: [],
    agentRuns: [],
    jobs: [],
    analyses: [],
    ...overrides,
  };
}

function mockTransport(responses: string[]): {
  transport: BenchMatchTransport;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    transport: {
      async complete(prompt) {
        calls.push(prompt);
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        return r;
      },
    },
  };
}

function matchJson(
  entries: Array<{
    personId: string;
    score: number;
    whyMatched?: string;
    citations?: Array<{ field: string; quote: string }>;
  }>,
): string {
  return JSON.stringify({
    matches: entries.map((e) => ({
      whyMatched: 'התאמה טובה לניסיון',
      citations: [{ field: 'name', quote: `Person ${e.personId}` }],
      ...e,
    })),
  });
}

// ------------------------------------------------------------------
// Throttle math (contract: <1/5 accept-rate halves volume, floor 1)
// ------------------------------------------------------------------

describe('throttledVolume', () => {
  it('null acceptRate (nothing resolved) = full volume', () => {
    expect(throttledVolume(null)).toBe(BENCH_BASE_VOLUME);
    expect(throttledVolume(null, 1)).toBe(BENCH_BASE_VOLUME);
  });

  it('acceptRate at or above 0.2 = full volume (0.2 itself is healthy)', () => {
    expect(throttledVolume(0.2)).toBe(BENCH_BASE_VOLUME);
    expect(throttledVolume(1)).toBe(BENCH_BASE_VOLUME);
    expect(throttledVolume(0.2, 1)).toBe(BENCH_BASE_VOLUME); // recovery is immediate
  });

  it('acceptRate strictly below 0.2 halves the previous volume, floor 1', () => {
    expect(throttledVolume(0.19)).toBe(2); // no prev → halves base 5
    expect(throttledVolume(0, 5)).toBe(2);
    expect(throttledVolume(0, 2)).toBe(1);
    expect(throttledVolume(0, 1)).toBe(1); // floor
  });

  it('compounds across consecutive low-precision runs: 5 → 2 → 1 → 1', () => {
    const seq = [BENCH_BASE_VOLUME];
    for (let i = 0; i < 3; i++) {
      seq.push(throttledVolume(0.1, seq[seq.length - 1]));
    }
    expect(seq).toEqual([5, 2, 1, 1]);
  });

  it('ignores garbage previous volumes (defensive)', () => {
    expect(throttledVolume(0.1, Number.NaN)).toBe(2);
    expect(throttledVolume(0.1, -3)).toBe(2);
    expect(throttledVolume(0.1, 999)).toBe(2); // prev clamped to base
  });
});

describe('benchAcceptStats', () => {
  it('mirrors the store selector: accepted/(accepted+dismissed), null until resolved', () => {
    expect(benchAcceptStats([]).acceptRate).toBeNull();
    expect(
      benchAcceptStats([benchSuggestion('s1', 'pending')]).acceptRate,
    ).toBeNull();

    const stats = benchAcceptStats([
      benchSuggestion('s1', 'accepted'),
      benchSuggestion('s2', 'dismissed'),
      benchSuggestion('s3', 'dismissed'),
      benchSuggestion('s4', 'pending'),
    ]);
    expect(stats.accepted).toBe(1);
    expect(stats.dismissed).toBe(2);
    expect(stats.resolved).toBe(3);
    expect(stats.acceptRate).toBeCloseTo(1 / 3);
  });

  it('counts only live bench_match suggestions of the bench agent', () => {
    const stats = benchAcceptStats([
      benchSuggestion('s1', 'accepted', { deleted: true }),
      benchSuggestion('s2', 'accepted', { agent: 'pit_boss' }),
      benchSuggestion('s3', 'accepted', { kind: 'flag' }),
    ]);
    expect(stats.resolved).toBe(0);
    expect(stats.acceptRate).toBeNull();
  });
});

// ------------------------------------------------------------------
// Cursor + volume ride-along on agent runs
// ------------------------------------------------------------------

describe('bench run cursors', () => {
  it('lastBenchCursor: max cursor across live bench runs only', () => {
    expect(lastBenchCursor([])).toBe(0);
    expect(
      lastBenchCursor([
        benchRun(1, { cursor: 5 }),
        benchRun(2, { cursor: 9 }),
        benchRun(3, { cursor: 20, deleted: true }),
        benchRun(4, { cursor: 30, agent: 'pit_boss' }),
        benchRun(5, {}), // no cursor recorded
      ]),
    ).toBe(9);
  });

  it('lastBenchVolume: newest live bench run by v, null when never recorded', () => {
    expect(lastBenchVolume([])).toBeNull();
    expect(lastBenchVolume([benchRun(1, {})])).toBeNull();
    expect(
      lastBenchVolume([
        benchRun(1, { volume: 5 }),
        benchRun(3, { volume: 2 }),
        benchRun(2, { volume: 4 }),
        benchRun(9, { volume: 1, deleted: true }),
      ]),
    ).toBe(2);
  });
});

// ------------------------------------------------------------------
// Open mandates + incremental pair planning
// ------------------------------------------------------------------

describe('openMandates', () => {
  it('open = live deal in a pre-Placed pipeline stage; filled mandates close', () => {
    const mandates = openMandates([
      deal('d1', 'px', 'j-open', 'Outreach', 3),
      deal('d2', 'py', 'j-filled', 'Submitted', 4),
      deal('d3', 'pz', 'j-filled', 'Placed', 5),
      deal('d4', 'pq', 'j-closed', 'Rejected', 6),
      deal('d5', 'pr', 'j-benchonly', 'Bench', 7),
      deal('d6', 'ps', 'j-deleted', 'Outreach', 8, { deleted: true }),
    ]);
    expect(mandates.map((m) => m.jobId)).toEqual(['j-open']);
    expect(mandates[0].mandateV).toBe(3);
  });

  it('mandateV = max v across the mandate\'s live deals; title from latest deal, JD text from savedJobs', () => {
    const mandates = openMandates(
      [
        deal('d1', 'p1', 'j1', 'Outreach', 3, { jobTitle: 'Old', updatedAt: '2026-07-01T00:00:00.000Z' }),
        deal('d2', 'p2', 'j1', 'Screened', 8, { jobTitle: 'New', updatedAt: NOW }),
      ],
      [{ id: 'j1', title: 'JD Title', rawText: 'full JD' }],
    );
    expect(mandates).toEqual([
      { jobId: 'j1', jobTitle: 'New', rawText: 'full JD', mandateV: 8, isNewJd: false },
    ]);
  });

  it('newJdJobIds opens a deal-less JD by fiat (title from savedJobs), but never a filled one', () => {
    const mandates = openMandates(
      [deal('d1', 'p1', 'j-filled', 'Paid', 3)],
      [{ id: 'j-new', title: 'Fresh JD' }],
      ['j-new', 'j-filled'],
    );
    expect(mandates).toEqual([
      { jobId: 'j-new', jobTitle: 'Fresh JD', mandateV: 0, isNewJd: true },
    ]);
  });
});

describe('planBenchPairs — incremental cursor semantics', () => {
  const twoBenchOneMandate = () =>
    view({
      persons: [person('p1', 11), person('p2', 5)],
      deals: [deal('d1', 'px', 'j1', 'Outreach', 7)],
    });

  it('cursor 0 (first run): every bench person × every open mandate', () => {
    const plan = planBenchPairs(twoBenchOneMandate());
    expect(plan.cursor).toBe(0);
    expect(plan.pairs.map((p) => p.snapshot.personId)).toEqual(['p1', 'p2']);
    expect(plan.unchanged).toBe(0);
  });

  it('with a cursor: only changed persons pair against unchanged mandates', () => {
    const v = twoBenchOneMandate();
    const plan = planBenchPairs(
      view({ ...v, agentRuns: [benchRun(1, { cursor: 10 })] }),
    );
    // p1 (v=11 > 10) changed; p2 (v=5) not; mandate (v=7) not.
    expect(plan.cursor).toBe(10);
    expect(plan.pairs.map((p) => p.snapshot.personId)).toEqual(['p1']);
    expect(plan.unchanged).toBe(1);
  });

  it('a changed mandate re-pairs ALL bench persons', () => {
    const v = view({
      persons: [person('p1', 2), person('p2', 3)],
      deals: [deal('d1', 'px', 'j1', 'Outreach', 12)],
      agentRuns: [benchRun(1, { cursor: 10 })],
    });
    const plan = planBenchPairs(v);
    expect(plan.pairs.map((p) => p.snapshot.personId)).toEqual(['p1', 'p2']);
  });

  it('newJdJobIds forces the pairing regardless of the cursor', () => {
    const v = view({
      persons: [person('p1', 2)],
      deals: [deal('d1', 'px', 'j1', 'Outreach', 3)],
      agentRuns: [benchRun(1, { cursor: 10 })],
    });
    expect(planBenchPairs(v).pairs).toHaveLength(0); // nothing changed
    const plan = planBenchPairs(v, { newJdJobIds: ['j1'] });
    expect(plan.pairs).toHaveLength(1);
    expect(plan.pairs[0].mandate.isNewJd).toBe(true);
  });

  it('skips pairs whose deterministic suggestion exists in ANY status — dismissals are final', () => {
    const v = view({
      persons: [person('p1', 11)],
      deals: [deal('d1', 'px', 'j1', 'Outreach', 7)],
      suggestions: [
        benchSuggestion(benchSuggestionId('p1', 'j1'), 'dismissed'),
      ],
    });
    const plan = planBenchPairs(v);
    expect(plan.pairs).toHaveLength(0);
    expect(plan.skipped).toEqual([{ personId: 'p1', jobId: 'j1', reason: 'exists' }]);
  });

  it('skips persons already on that mandate (any live deal, incl. Rejected-for-that-job)', () => {
    const v = view({
      persons: [person('p1', 11)],
      deals: [
        deal('d1', 'px', 'j1', 'Outreach', 7),
        deal('d2', 'p1', 'j1', 'Rejected', 8),
      ],
    });
    const plan = planBenchPairs(v);
    expect(plan.pairs).toHaveLength(0);
    expect(plan.skipped).toEqual([
      { personId: 'p1', jobId: 'j1', reason: 'already_on_job' },
    ]);
  });

  it('ignores tombstoned and non-bench persons', () => {
    const v = view({
      persons: [
        person('p1', 11, { deleted: true }),
        person('p2', 12, { bench: undefined }),
      ],
      deals: [deal('d1', 'px', 'j1', 'Outreach', 7)],
    });
    expect(planBenchPairs(v).pairs).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// Snapshot + prompt
// ------------------------------------------------------------------

describe('benchPersonSnapshot / buildBenchPrompt', () => {
  it('snapshot carries citable fields + latest linked analysis summary', () => {
    const p = person('p1', 3, {
      name: 'דנה כהן',
      notes: 'זמינה מיידית',
      analysisIds: ['a-old', 'a-new'],
      bench: { reason: 'legacy', since: NOW, benchReason: 'הפסידה בפוטו-פיניש', silverMedalist: true },
    });
    const snap = benchPersonSnapshot(p, [
      { id: 'a-old', timestamp: '2026-01-01T00:00:00.000Z', profileSummary: 'old summary' },
      { id: 'a-new', timestamp: NOW, profileSummary: 'senior backend, 7y' },
      { id: 'a-unlinked', timestamp: NOW, profileSummary: 'someone else' },
    ]);
    expect(snap.silver).toBe(true);
    expect(snap.fields.benchReason).toBe('הפסידה בפוטו-פיניש'); // benchedAt-era field wins
    expect(snap.fields.profileSummary).toBe('senior backend, 7y');
    expect(snap.analysisId).toBe('a-new');
  });

  it('prompt names every personId, the mandate, and the JSON schema', () => {
    const mandate: BenchMandate = {
      jobId: 'j1',
      jobTitle: 'Backend Engineer',
      rawText: 'Node, Postgres',
      mandateV: 1,
      isNewJd: false,
    };
    const prompt = buildBenchPrompt(mandate, [
      benchPersonSnapshot(person('p1', 1)),
      benchPersonSnapshot(person('p2', 2)),
    ]);
    expect(prompt).toContain('personId: p1');
    expect(prompt).toContain('personId: p2');
    expect(prompt).toContain('Backend Engineer');
    expect(prompt).toContain('Node, Postgres');
    expect(prompt).toContain('"matches"');
    expect(prompt).toContain(`score ${BENCH_MIN_SCORE}`);
  });
});

// ------------------------------------------------------------------
// Defensive parsing + grounding
// ------------------------------------------------------------------

describe('parseBenchResponse', () => {
  const mandate: BenchMandate = {
    jobId: 'j1',
    jobTitle: 'BE',
    mandateV: 1,
    isNewJd: false,
  };
  const snaps: BenchPersonSnapshot[] = [
    {
      personId: 'p1',
      personV: 1,
      name: 'דנה כהן',
      silver: false,
      fields: { name: 'דנה כהן', notes: 'ניסיון עם Node ו-Postgres בסטארטאפ' },
    },
    {
      personId: 'p2',
      personV: 2,
      name: 'יוסי לוי',
      silver: true,
      fields: { name: 'יוסי לוי', profileSummary: 'מפתח בכיר, שבע שנים בתשתיות' },
      analysisId: 'a7',
    },
  ];

  it('parses fenced JSON with prose around it', () => {
    const text = `הנה התוצאה:\n\`\`\`json\n${matchJson([
      { personId: 'p1', score: 88, citations: [{ field: 'notes', quote: 'Node ו-Postgres' }] },
    ])}\n\`\`\`\nבהצלחה`;
    const out = parseBenchResponse(text, mandate, snaps);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]).toMatchObject({ personId: 'p1', jobId: 'j1', score: 88 });
  });

  it('never throws on garbage — invalid JSON reported, zero matches', () => {
    const out = parseBenchResponse('not json at all', mandate, snaps);
    expect(out.matches).toEqual([]);
    expect(out.dropped).toEqual([{ reason: 'invalid_json' }]);
  });

  it('drops unknown/duplicate persons, bad scores, empty reasons', () => {
    const text = JSON.stringify({
      matches: [
        { personId: 'ghost', score: 90, whyMatched: 'x', citations: [{ field: 'name', quote: 'דנה' }] },
        { personId: 'p1', score: 'high', whyMatched: 'x', citations: [{ field: 'name', quote: 'דנה' }] },
        { personId: 'p1', score: 80, whyMatched: '', citations: [{ field: 'name', quote: 'דנה' }] },
        { personId: 'p1', score: 80, whyMatched: 'ok', citations: [{ field: 'name', quote: 'דנה כהן' }] },
        { personId: 'p1', score: 99, whyMatched: 'dup', citations: [{ field: 'name', quote: 'דנה כהן' }] },
        7,
      ],
    });
    const out = parseBenchResponse(text, mandate, snaps);
    expect(out.matches.map((m) => m.personId)).toEqual(['p1']);
    expect(out.matches[0].score).toBe(80);
    expect(out.dropped.map((d) => d.reason).sort()).toEqual([
      'bad_score',
      'duplicate_person',
      'empty_why',
      'not_an_object',
      'unknown_person',
    ]);
  });

  it('GROUNDING: a citation quote must appear verbatim in the cited field', () => {
    const text = JSON.stringify({
      matches: [
        {
          personId: 'p1',
          score: 85,
          whyMatched: 'ok',
          citations: [
            { field: 'notes', quote: 'ניסיון עם Kubernetes' }, // invented — dropped
            { field: 'notes', quote: 'Node ו-Postgres' }, // real substring — kept
            { field: 'profileSummary', quote: 'anything' }, // field absent on p1 — dropped
            { field: 'phone', quote: 'x' }, // not citable — dropped
          ],
        },
        {
          personId: 'p2',
          score: 90,
          whyMatched: 'ok',
          citations: [{ field: 'notes', quote: 'שבע שנים' }], // wrong field — ungrounded
        },
      ],
    });
    const out = parseBenchResponse(text, mandate, snaps);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].citations).toEqual([
      { field: 'notes', quote: 'Node ו-Postgres', sourceType: 'person', sourceId: 'p1' },
    ]);
    expect(out.dropped).toContainEqual({ reason: 'ungrounded', personId: 'p2' });
  });

  it('profileSummary citations point at the analysis record; whitespace is normalized; scores clamp', () => {
    const text = JSON.stringify({
      matches: [
        {
          personId: 'p2',
          score: 250,
          whyMatched: 'התאמה ‮חזקה', // BiDi override control must be stripped
          citations: [{ field: 'profileSummary', quote: 'מפתח  בכיר,\n שבע שנים' }],
        },
      ],
    });
    const out = parseBenchResponse(text, mandate, snaps);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].score).toBe(100);
    expect(out.matches[0].whyMatched).not.toContain('‮');
    expect(out.matches[0].citations[0]).toMatchObject({
      sourceType: 'analysis',
      sourceId: 'a7',
    });
    expect(out.matches[0].silver).toBe(true);
  });
});

// ------------------------------------------------------------------
// Suggestion building
// ------------------------------------------------------------------

describe('buildBenchSuggestion', () => {
  it('bench_match suggestion: deterministic id, personId only (no dealId), Hebrew title/body, field-cited evidence', () => {
    const snap = benchPersonSnapshot(
      person('p1', 3, {
        name: 'דנה כהן',
        bench: { reason: 'x', since: NOW, silverMedalist: true },
      }),
    );
    const mandate: BenchMandate = {
      jobId: 'j1',
      jobTitle: 'Backend Engineer',
      mandateV: 1,
      isNewJd: false,
    };
    const input = buildBenchSuggestion(
      {
        personId: 'p1',
        jobId: 'j1',
        score: 87,
        whyMatched: 'ניסיון רלוונטי מאוד',
        silver: true,
        citations: [
          { field: 'name', quote: 'דנה כהן', sourceType: 'person', sourceId: 'p1' },
        ],
      },
      snap,
      mandate,
    );

    expect(input.id).toBe(benchSuggestionId('p1', 'j1'));
    expect(input.agent).toBe(BENCH_AGENT);
    expect(input.kind).toBe('bench_match');
    expect(input.personId).toBe('p1');
    expect(input.dealId).toBeUndefined(); // NEVER creates/targets a deal
    expect(input.title).toContain('דנה כהן');
    expect(input.title).toContain('Backend Engineer');
    expect(input.body).toContain('ניסיון רלוונטי מאוד');
    expect(input.body).toContain('87/100');
    // Evidence: the open mandate + the grounded person-field citation +
    // the silver-medalist marker.
    expect(input.evidence).toContainEqual({
      claim: 'מנדט פתוח: Backend Engineer',
      sourceType: 'job',
      sourceId: 'j1',
    });
    expect(input.evidence?.some((e) => e.sourceType === 'person' && e.claim.includes('דנה כהן'))).toBe(true);
    expect(input.evidence?.some((e) => e.claim.includes('מדליית כסף'))).toBe(true);
  });
});

// ------------------------------------------------------------------
// The pass — batching, budget, throttle, capped/error outcomes
// ------------------------------------------------------------------

describe('runBenchPass', () => {
  const groundedView = () =>
    view({
      persons: [
        person('p1', 11, { name: 'Person p1' }),
        person('p2', 12, {
          name: 'Person p2',
          bench: { reason: 'x', since: NOW, silverMedalist: true },
        }),
      ],
      deals: [deal('d1', 'px', 'j1', 'Outreach', 7)],
      jobs: [{ id: 'j1', title: 'BE', rawText: 'JD' }],
    });

  it('happy path: files ranked bench_match suggestions with grounded evidence', async () => {
    const { transport, calls } = mockTransport([
      matchJson([
        { personId: 'p1', score: 70 },
        { personId: 'p2', score: 90 },
      ]),
    ]);
    const out = await runBenchPass(groundedView(), { transport });

    expect(calls).toHaveLength(1); // 2 persons ≤ batch size ⇒ one call
    expect(out.outcome).toBe('ok');
    expect(out.partial).toBe(false);
    expect(out.itemsProcessed).toBe(2);
    expect(out.pairsPlanned).toBe(2);
    expect(out.volume).toBe(BENCH_BASE_VOLUME);
    expect(out.acceptRate).toBeNull();
    // Ranked score-desc.
    expect(out.suggestions.map((s) => s.personId)).toEqual(['p2', 'p1']);
    expect(out.suggestions.every((s) => s.kind === 'bench_match')).toBe(true);
    expect(out.suggestions.every((s) => s.dealId === undefined)).toBe(true);
  });

  it('volume-caps filed suggestions (throttled run files fewer, best first)', async () => {
    // 5 dismissed, 0 accepted ⇒ acceptRate 0 < 0.2 ⇒ half of base = 2.
    const dismissed = ['x1', 'x2', 'x3', 'x4', 'x5'].map((id) =>
      benchSuggestion(`s_${id}`, 'dismissed'),
    );
    const v = view({
      ...groundedView(),
      persons: [
        person('p1', 11, { name: 'Person p1' }),
        person('p2', 12, { name: 'Person p2' }),
        person('p3', 13, { name: 'Person p3' }),
      ],
      suggestions: dismissed,
    });
    const { transport } = mockTransport([
      matchJson([
        { personId: 'p1', score: 95 },
        { personId: 'p2', score: 85 },
        { personId: 'p3', score: 75 },
      ]),
    ]);
    const out = await runBenchPass(v, { transport });
    expect(out.volume).toBe(2);
    expect(out.acceptRate).toBe(0);
    expect(out.matchesConsidered).toBe(3);
    expect(out.suggestions.map((s) => s.personId)).toEqual(['p1', 'p2']);
  });

  it('reads the previous run volume for compounding halving', async () => {
    const v = view({
      ...groundedView(),
      suggestions: [benchSuggestion('s_x', 'dismissed')],
      agentRuns: [benchRun(3, { cursor: 0, volume: 2 })],
    });
    const { transport } = mockTransport([matchJson([{ personId: 'p1', score: 90 }])]);
    const out = await runBenchPass(v, { transport });
    expect(out.volume).toBe(1); // half of previous 2, floor respected
  });

  it('filters below-threshold scores even when the model ignores instructions', async () => {
    const { transport } = mockTransport([
      matchJson([
        { personId: 'p1', score: BENCH_MIN_SCORE - 1 },
        { personId: 'p2', score: BENCH_MIN_SCORE },
      ]),
    ]);
    const out = await runBenchPass(groundedView(), { transport });
    expect(out.suggestions.map((s) => s.personId)).toEqual(['p2']);
  });

  it('batches few-at-a-time per mandate', async () => {
    const many = Array.from({ length: BENCH_BATCH_PERSONS + 2 }, (_, i) =>
      person(`p${i}`, 10 + i, { name: `Person p${i}` }),
    );
    const { transport, calls } = mockTransport(['{"matches":[]}']);
    const out = await runBenchPass(
      view({ persons: many, deals: [deal('d1', 'px', 'j1', 'Outreach', 7)] }),
      { transport },
    );
    expect(calls).toHaveLength(2); // 6 persons → 4 + 2
    expect(out.itemsProcessed).toBe(BENCH_BATCH_PERSONS + 2);
  });

  it('budget-aware: budget 0 makes zero LLM calls and reports partial', async () => {
    const { transport, calls } = mockTransport(['{"matches":[]}']);
    const out = await runBenchPass(groundedView(), { transport, budgetMs: 0 });
    expect(calls).toHaveLength(0);
    expect(out.partial).toBe(true);
    expect(out.itemsProcessed).toBe(0);
    expect(out.outcome).toBe('ok');
  });

  it('budget-aware: stops between batches when the clock runs out', async () => {
    const many = Array.from({ length: BENCH_BATCH_PERSONS * 2 }, (_, i) =>
      person(`p${i}`, 10 + i, { name: `Person p${i}` }),
    );
    let t = 0;
    const { transport, calls } = mockTransport(['{"matches":[]}']);
    const slowClock = () => {
      t += 60; // each observation advances well past the budget
      return t;
    };
    const out = await runBenchPass(
      view({ persons: many, deals: [deal('d1', 'px', 'j1', 'Outreach', 7)] }),
      { transport, budgetMs: 100, nowMs: slowClock },
    );
    expect(calls).toHaveLength(1); // first batch ran, second hit the budget
    expect(out.partial).toBe(true);
  });

  it('spend cap: BenchSpendCapError ⇒ outcome capped, work already gathered still files', async () => {
    const many = Array.from({ length: BENCH_BATCH_PERSONS + 1 }, (_, i) =>
      person(`p${i}`, 10 + i, { name: `Person p${i}` }),
    );
    let call = 0;
    const transport: BenchMatchTransport = {
      async complete() {
        call += 1;
        if (call === 2) throw new BenchSpendCapError('cap (200/200)');
        return matchJson([{ personId: 'p0', score: 91 }]);
      },
    };
    const out = await runBenchPass(
      view({ persons: many, deals: [deal('d1', 'px', 'j1', 'Outreach', 7)] }),
      { transport },
    );
    expect(out.outcome).toBe('capped');
    expect(out.error).toMatch(/cap/);
    expect(out.suggestions.map((s) => s.personId)).toEqual(['p0']);
    expect(out.itemsProcessed).toBe(BENCH_BATCH_PERSONS); // only batch 1 completed
  });

  it('transport failure ⇒ outcome error, never a throw', async () => {
    const transport: BenchMatchTransport = {
      async complete() {
        throw new Error('LLM API error: 500');
      },
    };
    const out = await runBenchPass(groundedView(), { transport });
    expect(out.outcome).toBe('error');
    expect(out.error).toMatch(/500/);
    expect(out.suggestions).toEqual([]);
  });

  it('no pairs ⇒ the transport is never consulted', async () => {
    const complete = vi.fn();
    const out = await runBenchPass(view(), { transport: { complete } });
    expect(complete).not.toHaveBeenCalled();
    expect(out.outcome).toBe('ok');
    expect(out.suggestions).toEqual([]);
  });

  it('isSpendCapError duck-types the code for cross-module robustness', () => {
    expect(isSpendCapError(new BenchSpendCapError())).toBe(true);
    expect(isSpendCapError({ code: 'spend_cap' })).toBe(true);
    expect(isSpendCapError(new Error('nope'))).toBe(false);
  });
});

// ------------------------------------------------------------------
// Transport rail: this module can never reach the network itself
// ------------------------------------------------------------------

describe('bench sourcer network rail', () => {
  it('the engine never fetches, never touches an API key, never imports a vendor SDK', () => {
    const source = readFileSync(new URL('./benchSourcer.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/fetch\(/);
    expect(source).not.toMatch(/anthropic/i);
    expect(source).not.toMatch(/API_KEY/);
    expect(source).not.toMatch(/https?:\/\//);
  });
});
