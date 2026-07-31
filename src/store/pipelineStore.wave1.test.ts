// Wave-1 binding store contract (docs/waves/wave1-store-contract.md)
import { describe, it, expect, beforeEach } from 'vitest';
import type { DealStage } from '../types/pipeline';

// ---- in-memory localStorage (vitest runs in node env; no jsdom dep) ----
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

const {
  usePipelineStore,
  dealsByStage,
  benchPersons,
  personById,
  pipelineContactLogger,
  ALL_DEAL_STAGES,
} = await import('./pipelineStore');
const { V3_KEYS } = await import('../lib/persistence/keys');

function reset() {
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
}

beforeEach(reset);

function seedPersonAndDeal(stage: DealStage = 'Sourced') {
  const { person } = usePipelineStore.getState().addPerson({ name: 'רון כהן', phone: '052-1234567' });
  const deal = usePipelineStore.getState().addDeal({
    personId: person.id,
    jobId: 'job-1',
    jobTitle: 'Backend Engineer',
    stage,
  });
  return { person, deal };
}

// ------------------------------------------------------------------
// addPerson
// ------------------------------------------------------------------

describe('addPerson', () => {
  it('creates a new person with normalizedName, audits, marks dirty', () => {
    const { person, duplicateOf } = usePipelineStore
      .getState()
      .addPerson({ name: 'Ron  Cohen.', email: 'ron@x.com' });
    expect(duplicateOf).toBeUndefined();
    expect(person.normalizedName).toBe('ron cohen');
    expect(person.v).toBe(0);
    const st = usePipelineStore.getState();
    expect(st.persons).toHaveLength(1);
    expect(st.dirtyIds.persons).toContain(person.id);
    const audit = st.auditLog[st.auditLog.length - 1]!;
    expect(audit.action).toBe('person.create');
    expect(audit.entityType).toBe('person');
  });

  it('exact dedupe (phone) attaches additively and returns duplicateOf', () => {
    const first = usePipelineStore.getState().addPerson({
      name: 'רון כהן',
      phone: '+972-52-1234567',
      analysisIds: ['a1'],
    });
    const second = usePipelineStore.getState().addPerson({
      name: 'Ron Cohen', // different name — phone is the identity
      phone: '0521234567',
      email: 'ron@x.com',
      analysisIds: ['a2'],
    });
    expect(second.duplicateOf?.id).toBe(first.person.id);
    expect(second.person.id).toBe(first.person.id);
    expect(second.person.name).toBe('רון כהן'); // existing wins
    expect(second.person.email).toBe('ron@x.com'); // missing field filled
    expect(second.person.analysisIds.sort()).toEqual(['a1', 'a2']);
    expect(usePipelineStore.getState().persons).toHaveLength(1);
  });

  it('name-only collision creates the person AND a merge_person suggestion', () => {
    const first = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    const second = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    expect(second.person.id).not.toBe(first.person.id);
    expect(second.duplicateOf?.id).toBe(first.person.id);
    const st = usePipelineStore.getState();
    expect(st.persons).toHaveLength(2);
    const merges = st.suggestions.filter((s) => s.kind === 'merge_person');
    expect(merges).toHaveLength(1);
    expect(merges[0].status).toBe('pending');
    expect(merges[0].evidence.map((e) => e.sourceId)).toContain(first.person.id);
  });

  it('does not duplicate a pending merge suggestion for the same collision', () => {
    usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    const merges = usePipelineStore
      .getState()
      .suggestions.filter((s) => s.kind === 'merge_person' && s.status === 'pending');
    expect(merges).toHaveLength(1);
  });

  it('ai attribution lands in the audit entry', () => {
    usePipelineStore.getState().addPerson({ name: 'דנה לוי', actor: 'ai', agent: 'screener' });
    const audit = usePipelineStore.getState().auditLog[usePipelineStore.getState().auditLog.length - 1]!;
    expect(audit.actor).toBe('ai');
    expect(audit.agent).toBe('screener');
  });
});

// ------------------------------------------------------------------
// addDeal
// ------------------------------------------------------------------

describe('addDeal', () => {
  it('defaults stage to Sourced and logs a creation StageEvent (from null)', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    const deal = usePipelineStore
      .getState()
      .addDeal({ personId: person.id, jobId: 'j1', jobTitle: 'DevOps' });
    expect(deal.stage).toBe('Sourced');
    expect(deal.stageEnteredAt).toBeTruthy();
    const st = usePipelineStore.getState();
    const ev = st.stageEvents[st.stageEvents.length - 1]!;
    expect(ev.from).toBeNull();
    expect(ev.to).toBe('Sourced');
    expect(ev.skippedStages).toEqual([]);
    const audit = st.auditLog[st.auditLog.length - 1]!;
    expect(audit.action).toBe('deal.create');
  });

  it('entry at a later stage records skipped stages on the creation event', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    usePipelineStore.getState().addDeal({
      personId: person.id,
      jobId: 'j1',
      jobTitle: 'DevOps',
      stage: 'Submitted',
    });
    const ev = usePipelineStore.getState().stageEvents.slice(-1)[0]!;
    expect(ev.from).toBeNull();
    expect(ev.to).toBe('Submitted');
    expect(ev.skippedStages).toEqual(['Sourced', 'Screened', 'Outreach', 'InConversation']);
  });

  it('requires a known personId', () => {
    expect(() =>
      usePipelineStore.getState().addDeal({ personId: 'ghost', jobId: 'j', jobTitle: 't' }),
    ).toThrow(/unknown personId/);
  });

  it('is idempotent for deterministic ids', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    const a = usePipelineStore
      .getState()
      .addDeal({ id: 'd_fixed', personId: person.id, jobId: 'j1', jobTitle: 'X' });
    const b = usePipelineStore
      .getState()
      .addDeal({ id: 'd_fixed', personId: person.id, jobId: 'j1', jobTitle: 'X' });
    expect(b).toEqual(a);
    expect(usePipelineStore.getState().deals).toHaveLength(1);
    expect(usePipelineStore.getState().stageEvents).toHaveLength(1); // no second creation event
  });
});

// ------------------------------------------------------------------
// moveDeal
// ------------------------------------------------------------------

describe('moveDeal', () => {
  it('returns the StageEvent, updates stageEnteredAt, audits, snapshots undo', () => {
    const { deal } = seedPersonAndDeal();
    const before = usePipelineStore.getState().deals[0]!.stageEnteredAt;
    const ev = usePipelineStore.getState().moveDeal(deal.id, 'Screened');
    expect(ev).not.toBeNull();
    expect(ev!.from).toBe('Sourced');
    expect(ev!.to).toBe('Screened');
    const st = usePipelineStore.getState();
    expect(st.deals[0]!.stage).toBe('Screened');
    expect(st.deals[0]!.stageEnteredAt >= before).toBe(true);
    expect(st.undoStack).toHaveLength(1);
    expect(st.auditLog[st.auditLog.length - 1]!.action).toBe('deal.move');
  });

  it('returns null for unknown deal, same-stage no-op, and Rejected without reason', () => {
    const { deal } = seedPersonAndDeal();
    expect(usePipelineStore.getState().moveDeal('ghost', 'Screened')).toBeNull();
    expect(usePipelineStore.getState().moveDeal(deal.id, 'Sourced')).toBeNull();
    expect(usePipelineStore.getState().moveDeal(deal.id, 'Rejected')).toBeNull();
    expect(usePipelineStore.getState().deals[0]!.stage).toBe('Sourced');
  });

  it('Rejected with reason records rejection AND files the person to Bench', () => {
    const { person, deal } = seedPersonAndDeal();
    const ev = usePipelineStore
      .getState()
      .moveDeal(deal.id, 'Rejected', { reason: 'פער שכר' });
    expect(ev!.reason).toBe('פער שכר');
    const st = usePipelineStore.getState();
    expect(st.deals[0]!.rejection?.reason).toBe('פער שכר');
    const p = st.persons.find((x) => x.id === person.id)!;
    expect(p.bench?.reason).toBe('פער שכר');
    expect(benchPersons().map((x) => x.id)).toContain(person.id);
  });

  it('ai actor + agent attribute the audit entry and mark the event as agent', () => {
    const { deal } = seedPersonAndDeal();
    const ev = usePipelineStore
      .getState()
      .moveDeal(deal.id, 'Screened', { actor: 'ai', agent: 'screener' });
    expect(ev!.actor).toBe('agent');
    const audit = usePipelineStore.getState().auditLog.slice(-1)[0]!;
    expect(audit.actor).toBe('ai');
    expect(audit.agent).toBe('screener');
  });

  it('forward jumps carry skippedStages', () => {
    const { deal } = seedPersonAndDeal();
    const ev = usePipelineStore.getState().moveDeal(deal.id, 'Submitted');
    expect(ev!.skippedStages).toEqual(['Screened', 'Outreach', 'InConversation']);
  });
});

// ------------------------------------------------------------------
// undoLast
// ------------------------------------------------------------------

describe('undoLast', () => {
  it('returns false on an empty stack', () => {
    expect(usePipelineStore.getState().undoLast()).toBe(false);
  });

  it('round-trips a move: stage + stageEnteredAt restored, audit + compensating event', () => {
    const { deal } = seedPersonAndDeal();
    const orig = usePipelineStore.getState().deals[0]!;
    usePipelineStore.getState().moveDeal(deal.id, 'Outreach');
    expect(usePipelineStore.getState().undoLast()).toBe(true);
    const st = usePipelineStore.getState();
    expect(st.deals[0]!.stage).toBe('Sourced');
    expect(st.deals[0]!.stageEnteredAt).toBe(orig.stageEnteredAt);
    expect(st.undoStack).toHaveLength(0);
    expect(st.auditLog.slice(-1)[0]!.action).toBe('undo');
    const comp = st.stageEvents.slice(-1)[0]!;
    expect(comp.from).toBe('Outreach');
    expect(comp.to).toBe('Sourced');
    expect(comp.reason).toBe('undo');
    expect(comp.actor).toBe('system');
  });

  it('undoing a rejection un-benches the person', () => {
    const { person, deal } = seedPersonAndDeal();
    usePipelineStore.getState().moveDeal(deal.id, 'Rejected', { reason: 'לא רלוונטי' });
    expect(benchPersons()).toHaveLength(1);
    usePipelineStore.getState().undoLast();
    const p = usePipelineStore.getState().persons.find((x) => x.id === person.id)!;
    expect(p.bench).toBeUndefined();
    expect(benchPersons()).toHaveLength(0);
    expect(usePipelineStore.getState().deals[0]!.rejection).toBeUndefined();
  });

  it('keeps the current server version on restored records', () => {
    const { deal } = seedPersonAndDeal();
    usePipelineStore.getState().moveDeal(deal.id, 'Screened');
    // Simulate a server stamp landing after the move
    const st = usePipelineStore.getState();
    usePipelineStore.setState({
      deals: st.deals.map((d) => ({ ...d, v: 9 })),
    });
    usePipelineStore.getState().undoLast();
    expect(usePipelineStore.getState().deals[0]!.v).toBe(9);
    expect(usePipelineStore.getState().deals[0]!.stage).toBe('Sourced');
  });
});

// ------------------------------------------------------------------
// setReplyState + logContact
// ------------------------------------------------------------------

describe('reply chips + contact logging', () => {
  it('setReplyState appends the chip event and audits', () => {
    const { person } = seedPersonAndDeal();
    usePipelineStore.getState().setReplyState(person.id, 'replied', '2026-07-31T09:00:00.000Z');
    usePipelineStore.getState().setReplyState(person.id, 'meeting_set');
    const p = usePipelineStore.getState().persons[0]!;
    expect(p.contactEvents.map((e) => e.kind)).toEqual(['replied', 'meeting_set']);
    expect(p.contactEvents[0]!.ts).toBe('2026-07-31T09:00:00.000Z');
    expect(usePipelineStore.getState().auditLog.slice(-1)[0]!.action).toBe('person.reply_state');
  });

  it('setReplyState on an unknown person is a safe no-op', () => {
    usePipelineStore.getState().setReplyState('ghost', 'no_reply');
    expect(usePipelineStore.getState().auditLog).toHaveLength(0);
  });

  it('logContact appends a contacted event with hash and persists the channel', () => {
    const { person } = seedPersonAndDeal();
    usePipelineStore.getState().logContact(person.id, 'whatsapp', 'abcd1234');
    const p = usePipelineStore.getState().persons[0]!;
    const ev = p.contactEvents[p.contactEvents.length - 1]!;
    expect(ev.kind).toBe('contacted');
    expect(ev.messageHash).toBe('abcd1234');
    // channel rides the persisted JSON ahead of the type (D-018)
    const raw = JSON.parse(localStorage.getItem(V3_KEYS.persons)!);
    expect(raw[0].contactEvents[raw[0].contactEvents.length - 1].channel).toBe('whatsapp');
    expect(usePipelineStore.getState().auditLog.slice(-1)[0]!.action).toBe('person.contact');
  });

  it('pipelineContactLogger implements the outreach ContactLogger (epoch → ISO)', () => {
    const { person } = seedPersonAndDeal();
    pipelineContactLogger.logContact(person.id, 'email', 'ffff0000', 1753948800000);
    const ev = usePipelineStore.getState().persons[0]!.contactEvents.slice(-1)[0]!;
    expect(ev.messageHash).toBe('ffff0000');
    expect(ev.ts).toBe(new Date(1753948800000).toISOString());
  });
});

// ------------------------------------------------------------------
// Suggestions: add / accept / dismiss
// ------------------------------------------------------------------

describe('suggestions contract', () => {
  it('addSuggestion returns the pending suggestion and audits with agent attribution', () => {
    const s = usePipelineStore.getState().addSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      title: 'טיוטת פתיחה',
      body: 'היי רון...',
    });
    expect(s.status).toBe('pending');
    expect(s.v).toBe(0);
    const audit = usePipelineStore.getState().auditLog.slice(-1)[0]!;
    expect(audit.action).toBe('suggestion.create');
    expect(audit.actor).toBe('ai');
    expect(audit.agent).toBe('outreach_runner');
  });

  it('acceptSuggestion applies next_action to the deal (single-writer via client)', () => {
    const { deal } = seedPersonAndDeal();
    const s = usePipelineStore.getState().addSuggestion({
      agent: 'pit_boss',
      kind: 'next_action',
      dealId: deal.id,
      title: 'להתקשר ללקוח',
      body: 'עברו 6 ימים ללא מענה',
    });
    usePipelineStore.getState().acceptSuggestion(s.id);
    const st = usePipelineStore.getState();
    expect(st.suggestions.find((x) => x.id === s.id)!.status).toBe('accepted');
    expect(st.deals[0]!.nextAction).toEqual({ label: 'להתקשר ללקוח', owner: 'revital' });
    expect(st.auditLog.slice(-1)[0]!.action).toBe('suggestion.accepted');
  });

  it('accept round-trips through undoLast (suggestion back to pending, deal restored)', () => {
    const { deal } = seedPersonAndDeal();
    const s = usePipelineStore.getState().addSuggestion({
      agent: 'pit_boss',
      kind: 'next_action',
      dealId: deal.id,
      title: 'פעולה',
      body: '...',
    });
    usePipelineStore.getState().acceptSuggestion(s.id);
    expect(usePipelineStore.getState().undoLast()).toBe(true);
    const st = usePipelineStore.getState();
    expect(st.suggestions.find((x) => x.id === s.id)!.status).toBe('pending');
    expect(st.deals[0]!.nextAction).toBeUndefined();
  });

  it('dismissSuggestion resolves without an undo snapshot', () => {
    const s = usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'flag',
      title: 'דגל',
      body: '...',
    });
    usePipelineStore.getState().dismissSuggestion(s.id);
    const st = usePipelineStore.getState();
    expect(st.suggestions[0]!.status).toBe('dismissed');
    expect(st.undoStack).toHaveLength(0);
    expect(st.auditLog.slice(-1)[0]!.action).toBe('suggestion.dismissed');
  });

  it('accept/dismiss on non-pending suggestions are no-ops', () => {
    const s = usePipelineStore.getState().addSuggestion({
      agent: 'screener',
      kind: 'flag',
      title: 'דגל',
      body: '...',
    });
    usePipelineStore.getState().dismissSuggestion(s.id);
    usePipelineStore.getState().acceptSuggestion(s.id);
    expect(usePipelineStore.getState().suggestions[0]!.status).toBe('dismissed');
  });
});

// ------------------------------------------------------------------
// Selectors
// ------------------------------------------------------------------

describe('selectors', () => {
  it('dealsByStage returns every stage key and excludes tombstones', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    const d1 = usePipelineStore
      .getState()
      .addDeal({ personId: person.id, jobId: 'j1', jobTitle: 'A' });
    const d2 = usePipelineStore
      .getState()
      .addDeal({ personId: person.id, jobId: 'j2', jobTitle: 'B', stage: 'Screened' });
    usePipelineStore.getState().deleteDeal(d1.id);
    const grouped = dealsByStage();
    for (const stage of ALL_DEAL_STAGES) {
      expect(Array.isArray(grouped[stage])).toBe(true);
    }
    expect(grouped.Sourced).toHaveLength(0); // tombstoned
    expect(grouped.Screened.map((d) => d.id)).toEqual([d2.id]);
    // state-attached variant matches
    expect(usePipelineStore.getState().dealsByStage()).toEqual(grouped);
  });

  it('personById resolves live persons only', () => {
    const { person } = usePipelineStore.getState().addPerson({ name: 'רון כהן' });
    expect(personById(person.id)?.id).toBe(person.id);
    usePipelineStore.getState().deletePerson(person.id);
    expect(personById(person.id)).toBeUndefined();
    expect(personById('ghost')).toBeUndefined();
  });
});
