// Wave-2 SLA silence sweep: detection thresholds, episode idempotency,
// dismissal finality, flag gate (docs/waves/wave2-tasks.md §agents-engine 3).
import { describe, it, expect, beforeEach } from 'vitest';
import type { Deal, Person, Suggestion } from '../types/pipeline';
import type { ContactRef } from '../lib/metrics/leadingIndicators';

// ---- in-memory localStorage BEFORE store import (node env) ----
class MemStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}
(globalThis as { localStorage?: Storage }).localStorage = new MemStorage();

const { usePipelineStore } = await import('../store/pipelineStore');
const {
  SLA_SILENCE_DAYS,
  detectSilences,
  slaSuggestionId,
  buildSlaSuggestion,
  planSlaSweep,
  runSlaSweepOnLoad,
} = await import('./sla');

const NOW = '2026-07-31T12:00:00.000Z';

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 24 * 60 * 60 * 1000).toISOString();
}

let seq = 0;
function makeDeal(overrides: Partial<Deal> = {}): Deal {
  seq += 1;
  return {
    id: `d${seq}`,
    v: seq,
    updatedAt: daysAgo(1),
    personId: `p${seq}`,
    jobId: `job-${seq}`,
    jobTitle: 'Backend Engineer',
    stage: 'Outreach',
    stageEnteredAt: daysAgo(5),
    createdAt: daysAgo(10),
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  seq += 1;
  return {
    id: `p${seq}`,
    v: seq,
    updatedAt: daysAgo(1),
    name: 'דנה כהן',
    normalizedName: 'דנה כהן',
    analysisIds: [],
    contactEvents: [],
    ...overrides,
  };
}

function contacted(dealId: string | undefined, personId: string, ts: string): ContactRef {
  return { kind: 'contacted', ts, ...(dealId ? { dealId } : {}), personId };
}

beforeEach(() => {
  seq = 0;
  localStorage.clear();
  usePipelineStore.setState({
    v3Enabled: false,
    persons: [],
    deals: [],
    stageEvents: [],
    suggestions: [],
    auditLog: [],
    undoStack: [],
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
});

// ------------------------------------------------------------------
// detectSilences
// ------------------------------------------------------------------

describe('detectSilences', () => {
  it('flags a deal contacted >=3d ago with no reply (Outreach/InConversation)', () => {
    const deal = makeDeal({ id: 'd1', personId: 'p1', stage: 'Outreach' });
    const breaches = detectSilences([deal], [contacted('d1', 'p1', daysAgo(4))], NOW);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].dealId).toBe('d1');
    expect(breaches[0].daysSilent).toBeCloseTo(4, 5);
    expect(breaches[0].lastContactTs).toBe(daysAgo(4));
  });

  it('exactly 3 days is a breach; 2.9 days is not', () => {
    const deal = makeDeal({ id: 'd1', personId: 'p1', stage: 'InConversation' });
    expect(
      detectSilences([deal], [contacted('d1', 'p1', daysAgo(SLA_SILENCE_DAYS))], NOW),
    ).toHaveLength(1);
    expect(
      detectSilences([deal], [contacted('d1', 'p1', daysAgo(2.9))], NOW),
    ).toHaveLength(0);
  });

  it('a reply at/after the last contact clears the breach; an older reply does not', () => {
    const deal = makeDeal({ id: 'd1', personId: 'p1' });
    const contact = contacted('d1', 'p1', daysAgo(5));
    const replyAfter: ContactRef = { kind: 'replied', ts: daysAgo(4), personId: 'p1' };
    const replyBefore: ContactRef = { kind: 'replied', ts: daysAgo(6), personId: 'p1' };
    expect(detectSilences([deal], [contact, replyAfter], NOW)).toHaveLength(0);
    expect(detectSilences([deal], [contact, replyBefore], NOW)).toHaveLength(1);
  });

  it('meeting_set clears silence; no_reply does NOT clear it', () => {
    const deal = makeDeal({ id: 'd1', personId: 'p1' });
    const contact = contacted('d1', 'p1', daysAgo(5));
    const meeting: ContactRef = { kind: 'meeting_set', ts: daysAgo(3), personId: 'p1' };
    const noReply: ContactRef = { kind: 'no_reply', ts: daysAgo(3), personId: 'p1' };
    expect(detectSilences([deal], [contact, meeting], NOW)).toHaveLength(0);
    expect(detectSilences([deal], [contact, noReply], NOW)).toHaveLength(1);
  });

  it('a new contact restarts the episode clock', () => {
    const deal = makeDeal({ id: 'd1', personId: 'p1' });
    const contacts = [contacted('d1', 'p1', daysAgo(10)), contacted('d1', 'p1', daysAgo(1))];
    expect(detectSilences([deal], contacts, NOW)).toHaveLength(0); // 1d < 3d
  });

  it('never-contacted deals are not breaches (first-touch SLA is metrics territory)', () => {
    expect(detectSilences([makeDeal()], [], NOW)).toHaveLength(0);
  });

  it('only Outreach/InConversation stages sweep; tombstoned deals never', () => {
    const submitted = makeDeal({ id: 'd1', personId: 'p1', stage: 'Submitted' });
    const bench = makeDeal({ id: 'd2', personId: 'p2', stage: 'Bench' });
    const dead = makeDeal({ id: 'd3', personId: 'p3', stage: 'Outreach', deleted: true });
    const contacts = [
      contacted('d1', 'p1', daysAgo(5)),
      contacted('d2', 'p2', daysAgo(5)),
      contacted('d3', 'p3', daysAgo(5)),
    ];
    expect(detectSilences([submitted, bench, dead], contacts, NOW)).toHaveLength(0);
  });

  it('attributes by dealId first, personId only when no dealId was captured', () => {
    const deal = makeDeal({ id: 'd1', personId: 'p1' });
    // Contact explicitly for ANOTHER deal of the same person: not attributable.
    expect(
      detectSilences([deal], [contacted('other-deal', 'p1', daysAgo(5))], NOW),
    ).toHaveLength(0);
    // No dealId captured → person-level attribution applies.
    expect(
      detectSilences([deal], [contacted(undefined, 'p1', daysAgo(5))], NOW),
    ).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// Suggestion building + planning
// ------------------------------------------------------------------

describe('slaSuggestionId / buildSlaSuggestion', () => {
  it('is deterministic per (deal, last contact) episode', () => {
    expect(slaSuggestionId('d1', '2026-07-27T12:00:00.000Z')).toBe(
      slaSuggestionId('d1', '2026-07-27T12:00:00.000Z'),
    );
    expect(slaSuggestionId('d1', '2026-07-27T12:00:00.000Z')).not.toBe(
      slaSuggestionId('d1', '2026-07-28T12:00:00.000Z'),
    );
  });

  it('builds an outreach_runner draft with numeric evidence', () => {
    const person = makePerson({ id: 'p1' });
    const deal = makeDeal({ id: 'd1', personId: 'p1' });
    const breach = detectSilences([deal], [contacted('d1', 'p1', daysAgo(4))], NOW)[0];
    const input = buildSlaSuggestion(breach, person, deal);
    expect(input.id).toBe(slaSuggestionId('d1', breach.lastContactTs));
    expect(input.agent).toBe('outreach_runner');
    expect(input.kind).toBe('draft_message');
    expect(input.dealId).toBe('d1');
    // Evidence cites the numbers: days silent + the episode timestamp.
    const claims = (input.evidence ?? []).map((e) => e.claim).join('\n');
    expect(claims).toContain('4.0');
    expect(claims).toContain(breach.lastContactTs);
    expect(claims).toContain(String(SLA_SILENCE_DAYS));
  });
});

describe('planSlaSweep', () => {
  function fixture() {
    const person = makePerson({
      id: 'p1',
      contactEvents: [{ kind: 'contacted', ts: daysAgo(4), channel: 'whatsapp' }],
    });
    const deal = makeDeal({ id: 'd1', personId: 'p1', stage: 'Outreach' });
    return { person, deal };
  }

  it('plans a suggestion for a fresh breach', () => {
    const { person, deal } = fixture();
    const plan = planSlaSweep([deal], [person], [], NOW);
    expect(plan.breaches).toHaveLength(1);
    expect(plan.toFile).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it("skips 'exists' for ANY status — a dismissed episode stays dismissed", () => {
    const { person, deal } = fixture();
    const first = planSlaSweep([deal], [person], [], NOW);
    const filedId = first.toFile[0].input.id as string;
    const dismissed: Suggestion = {
      id: filedId,
      v: 5,
      updatedAt: NOW,
      agent: 'outreach_runner',
      kind: 'draft_message',
      dealId: 'd1',
      personId: 'p1',
      title: 't',
      body: 'b',
      evidence: [],
      status: 'dismissed',
      createdAt: daysAgo(1),
    };
    const plan = planSlaSweep([deal], [person], [dismissed], NOW);
    expect(plan.toFile).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('exists');
  });

  it("skips 'pending_draft' when an earlier pending follow-up exists for the deal", () => {
    const { person, deal } = fixture();
    const pendingOld: Suggestion = {
      id: 'older-episode',
      v: 3,
      updatedAt: NOW,
      agent: 'outreach_runner',
      kind: 'draft_message',
      dealId: 'd1',
      title: 't',
      body: 'b',
      evidence: [],
      status: 'pending',
      createdAt: daysAgo(9),
    };
    const plan = planSlaSweep([deal], [person], [pendingOld], NOW);
    expect(plan.toFile).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('pending_draft');
  });

  it("skips 'missing_person' when the person is tombstoned", () => {
    const { person, deal } = fixture();
    const plan = planSlaSweep([deal], [{ ...person, deleted: true }], [], NOW);
    // Tombstoned person ⇒ contacts excluded ⇒ no breach at all.
    expect(plan.breaches).toHaveLength(0);
    // But a breach attributed via dealId with a missing person record skips:
    const orphanDeal = makeDeal({ id: 'd9', personId: 'ghost', stage: 'Outreach' });
    const p2 = makePerson({
      id: 'px',
      contactEvents: [{ kind: 'contacted', ts: daysAgo(4), dealId: 'd9' }],
    });
    const plan2 = planSlaSweep([orphanDeal], [p2], [], NOW);
    expect(plan2.breaches).toHaveLength(1);
    expect(plan2.skipped[0]?.reason).toBe('missing_person');
  });
});

// ------------------------------------------------------------------
// runSlaSweepOnLoad — client variant through the real store
// ------------------------------------------------------------------

describe('runSlaSweepOnLoad', () => {
  function seedStore() {
    const person = makePerson({
      id: 'p1',
      contactEvents: [{ kind: 'contacted', ts: daysAgo(4), channel: 'whatsapp' }],
    });
    const deal = makeDeal({ id: 'd1', personId: 'p1', stage: 'Outreach' });
    usePipelineStore.setState({ persons: [person], deals: [deal] });
    return { person, deal };
  }

  it('is flag-gated: v3 off means the store is never touched', () => {
    seedStore();
    const result = runSlaSweepOnLoad(usePipelineStore, NOW);
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('flag_off');
    expect(usePipelineStore.getState().suggestions).toHaveLength(0);
  });

  it('files follow-up suggestions with ai/outreach_runner audit attribution', () => {
    seedStore();
    usePipelineStore.getState().setV3Flag(true);
    const result = runSlaSweepOnLoad(usePipelineStore, NOW);
    expect(result.ran).toBe(true);
    expect(result.created).toHaveLength(1);
    const s = usePipelineStore.getState().suggestions;
    expect(s).toHaveLength(1);
    expect(s[0].agent).toBe('outreach_runner');
    expect(s[0].status).toBe('pending');
    const audit = usePipelineStore.getState().auditLog.at(-1);
    expect(audit?.actor).toBe('ai');
    expect(audit?.agent).toBe('outreach_runner');
    expect(audit?.action).toBe('suggestion.create');
  });

  it('re-running the same episode is a no-op (idempotent sweep)', () => {
    seedStore();
    usePipelineStore.getState().setV3Flag(true);
    runSlaSweepOnLoad(usePipelineStore, NOW);
    const again = runSlaSweepOnLoad(usePipelineStore, NOW);
    expect(again.created).toHaveLength(0);
    expect(again.skipped[0]?.reason).toBe('exists');
    expect(usePipelineStore.getState().suggestions).toHaveLength(1);
  });

  it('a dismissed episode is never resurrected', () => {
    seedStore();
    usePipelineStore.getState().setV3Flag(true);
    const first = runSlaSweepOnLoad(usePipelineStore, NOW);
    const id = first.created[0].id;
    usePipelineStore.getState().dismissSuggestion(id);
    const again = runSlaSweepOnLoad(usePipelineStore, NOW);
    expect(again.created).toHaveLength(0);
    const s = usePipelineStore.getState().suggestions.find((x) => x.id === id);
    expect(s?.status).toBe('dismissed');
  });
});
