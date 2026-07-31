// Wave-3 Batch A — platform-data (docs/waves/wave3-tasks.md):
//   acceptSuggestion(id, opts?) edit absorption · deletion cascade +
//   retention/purge · bench metadata (silver medalist) · agentAcceptStats.
// Node env with in-memory localStorage, matching the Wave-1 conventions.
import { describe, it, expect, beforeEach } from 'vitest';
import type { DealStage, Person, Suggestion } from '../types/pipeline';

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
  benchBySilver,
  benchPersons,
  agentAcceptStats,
  computeSilverMedalist,
  dealsByStage,
  personById,
} = await import('./pipelineStore');
type SuggestionWithEditMarker = import('./pipelineStore').SuggestionWithEditMarker;
type PersonWithBenchMeta = import('./pipelineStore').PersonWithBenchMeta;
const { V3_KEYS } = await import('../lib/persistence/keys');
const { computeLeadingIndicators } = await import(
  '../lib/metrics/leadingIndicators'
);

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
    retentionMonths: null,
    dirtyIds: { persons: [], deals: [], events: [], suggestions: [] },
  });
}

beforeEach(reset);

function store() {
  return usePipelineStore.getState();
}

let phoneSeq = 0;

function seedPersonAndDeal(stage: DealStage = 'Sourced', name = 'רון כהן') {
  // Unique phone per seeded person — a shared phone is an EXACT dedupe hit
  // and would silently merge fixture persons.
  const { person } = store().addPerson({
    name,
    phone: `05${(++phoneSeq).toString().padStart(8, '0')}`,
  });
  const deal = store().addDeal({
    personId: person.id,
    jobId: `job-${name}`,
    jobTitle: 'Backend Engineer',
    stage,
  });
  return { person, deal };
}

function seedDraft(body = 'היי נועה, ראיתי את הפרופיל שלך') {
  const { person } = store().addPerson({ name: 'נועה כהן', phone: '0501234567' });
  const sug = store().addSuggestion({
    agent: 'outreach_runner',
    kind: 'draft_message',
    personId: person.id,
    title: 'טיוטת פנייה',
    body,
  });
  return { person, sug };
}

function storedSug(id: string): SuggestionWithEditMarker | undefined {
  return store().suggestions.find((x) => x.id === id) as
    | SuggestionWithEditMarker
    | undefined;
}

// ==================================================================
// 1. acceptSuggestion(id, opts?) — editedBeforeAccept absorption
// ==================================================================

describe('acceptSuggestion opts absorption', () => {
  it('edited accept: replaces body, stamps true, audits edit BEFORE accept, persists', () => {
    const { sug } = seedDraft('שלום נועה');
    const ok = store().acceptSuggestion(sug.id, { editedBody: 'שלום נועה, ערכתי' });
    expect(ok).toBe(true);

    const after = storedSug(sug.id)!;
    expect(after.status).toBe('accepted');
    expect(after.body).toBe('שלום נועה, ערכתי');
    expect(after.editedBeforeAccept).toBe(true);

    // marker + edited body survive persistence (metrics read this JSON)
    const persisted = JSON.parse(localStorage.getItem(V3_KEYS.suggestions)!);
    const rec = persisted.find((x: { id: string }) => x.id === sug.id);
    expect(rec.editedBeforeAccept).toBe(true);
    expect(rec.body).toBe('שלום נועה, ערכתי');

    const actions = store().auditLog.map((e) => e.action);
    expect(actions).toContain('suggestion.edit');
    expect(actions.indexOf('suggestion.edit')).toBeLessThan(
      actions.indexOf('suggestion.accepted'),
    );
    const edit = store().auditLog.find((e) => e.action === 'suggestion.edit')!;
    expect(edit.actor).toBe('human');
    expect(edit.before).toEqual({ body: 'שלום נועה' });
    expect(edit.after).toEqual({
      body: 'שלום נועה, ערכתי',
      editedBeforeAccept: true,
    });
  });

  it('opts with an identical body counts as NOT edited (false, no edit audit)', () => {
    const { sug } = seedDraft('טקסט מקורי');
    expect(store().acceptSuggestion(sug.id, { editedBody: 'טקסט מקורי' })).toBe(true);
    const after = storedSug(sug.id)!;
    expect(after.body).toBe('טקסט מקורי');
    expect(after.editedBeforeAccept).toBe(false);
    expect(store().auditLog.some((e) => e.action === 'suggestion.edit')).toBe(false);
  });

  it('opts without editedBody stamps false', () => {
    const { sug } = seedDraft();
    store().acceptSuggestion(sug.id, {});
    expect(storedSug(sug.id)!.editedBeforeAccept).toBe(false);
  });

  it('no-opts call = not edited: stamps false (backward-compatible denominator)', () => {
    const { sug } = seedDraft();
    expect(store().acceptSuggestion(sug.id)).toBe(true);
    const after = storedSug(sug.id)!;
    expect(after.status).toBe('accepted');
    expect(after.body).toBe(sug.body);
    expect(after.editedBeforeAccept).toBe(false);
    expect(store().auditLog.some((e) => e.action === 'suggestion.edit')).toBe(false);
  });

  it('no-opts call PRESERVES a marker pre-patched by the legacy acceptDraft path', () => {
    // Simulates src/views/Inbox/acceptDraft.ts until kanban-ui re-points:
    // pre-patch body+marker in state, then call acceptSuggestion(id) bare.
    const { sug } = seedDraft('גוף מקורי');
    usePipelineStore.setState((s) => ({
      suggestions: s.suggestions.map((x) =>
        x.id === sug.id
          ? ({
              ...x,
              body: 'גוף ערוך מראש',
              editedBeforeAccept: true,
            } as Suggestion)
          : x,
      ),
    }));
    store().acceptSuggestion(sug.id);
    const after = storedSug(sug.id)!;
    expect(after.status).toBe('accepted');
    expect(after.body).toBe('גוף ערוך מראש'); // spread carries the patched body
    expect(after.editedBeforeAccept).toBe(true); // NOT clobbered to false
  });

  it('refuses missing / resolved / tombstoned suggestions with zero mutation', () => {
    expect(store().acceptSuggestion('ghost', { editedBody: 'x' })).toBe(false);

    const { sug } = seedDraft();
    store().dismissSuggestion(sug.id);
    expect(store().acceptSuggestion(sug.id, { editedBody: 'x' })).toBe(false);
    expect(storedSug(sug.id)!.status).toBe('dismissed');
    expect(storedSug(sug.id)!.editedBeforeAccept).toBeUndefined();

    const { sug: sug2 } = seedDraft('שני');
    usePipelineStore.setState((s) => ({
      suggestions: s.suggestions.map((x) =>
        x.id === sug2.id ? { ...x, deleted: true as const } : x,
      ),
    }));
    expect(store().acceptSuggestion(sug2.id)).toBe(false);
    expect(storedSug(sug2.id)!.status).toBe('pending');
  });

  it('dismiss never stamps the marker', () => {
    const { sug } = seedDraft();
    expect(store().dismissSuggestion(sug.id)).toBe(true);
    expect(storedSug(sug.id)!.editedBeforeAccept).toBeUndefined();
  });

  it('undo of an edited accept restores the ORIGINAL body and pending status', () => {
    const { sug } = seedDraft('גוף מקורי');
    store().acceptSuggestion(sug.id, { editedBody: 'גוף ערוך' });
    expect(store().undoLast()).toBe(true);
    const after = storedSug(sug.id)!;
    expect(after.status).toBe('pending');
    expect(after.body).toBe('גוף מקורי');
  });

  it('next_action applied effect still fires on an edited accept', () => {
    const { deal } = seedPersonAndDeal();
    const s = store().addSuggestion({
      agent: 'pit_boss',
      kind: 'next_action',
      dealId: deal.id,
      title: 'להתקשר ללקוח',
      body: 'עברו 6 ימים',
    });
    store().acceptSuggestion(s.id, { editedBody: 'עברו 6 ימים — ערוך' });
    const st = store();
    expect(st.deals.find((d) => d.id === deal.id)!.nextAction).toEqual({
      label: 'להתקשר ללקוח',
      owner: 'revital',
    });
    expect(storedSug(s.id)!.body).toBe('עברו 6 ימים — ערוך');
  });

  it('suggestionEditRate reads store-stamped markers: one edited + one as-is = 0.5', () => {
    const { sug: a } = seedDraft('טיוטה ראשונה');
    const { person } = store().addPerson({ name: 'דנה לוי' });
    const b = store().addSuggestion({
      agent: 'outreach_runner',
      kind: 'draft_message',
      personId: person.id,
      title: 'טיוטה לדנה',
      body: 'טיוטה שנייה',
    });
    store().acceptSuggestion(a.id, { editedBody: 'טיוטה ראשונה — ערוכה' });
    store().acceptSuggestion(b.id);
    const metrics = computeLeadingIndicators([], [], store().suggestions);
    expect(metrics.suggestionEditRate).toBe(0.5);
  });
});

// ==================================================================
// 2. Bench metadata — benchedAt / benchReason / silverMedalist
// ==================================================================

describe('bench metadata + silver medalist', () => {
  function benchOf(personId: string) {
    return (store().persons.find((p) => p.id === personId) as PersonWithBenchMeta)
      .bench;
  }

  it('rejecting from Submitted stamps full bench meta with silverMedalist true', () => {
    const { person, deal } = seedPersonAndDeal('Submitted');
    store().moveDeal(deal.id, 'Rejected', { reason: 'נבחר מועמד אחר' });
    const bench = benchOf(person.id)!;
    expect(bench.benchReason).toBe('נבחר מועמד אחר');
    expect(bench.reason).toBe('נבחר מועמד אחר'); // legacy field kept in lockstep
    expect(bench.benchedAt).toBe(bench.since);
    expect(bench.silverMedalist).toBe(true);
  });

  it('rejecting from an early stage is NOT a silver medalist', () => {
    const { person, deal } = seedPersonAndDeal('Screened', 'יעל ברק');
    store().moveDeal(deal.id, 'Rejected', { reason: 'לא רלוונטי' });
    expect(benchOf(person.id)!.silverMedalist).toBe(false);
  });

  it('rejecting after passing THROUGH Submitted counts (event history, not just from-stage)', () => {
    const { person, deal } = seedPersonAndDeal('Submitted', 'עדי שגב');
    // Client pulled the deal back to InConversation, then rejected it —
    // the Submitted chapter lives only in the event history.
    store().moveDeal(deal.id, 'InConversation');
    store().moveDeal(deal.id, 'Rejected', { reason: 'הקפאת תקן' });
    expect(benchOf(person.id)!.silverMedalist).toBe(true);
  });

  it('explicit Bench move: silver only via a prior rejection that went deep', () => {
    // No rejection history: deep deal parked on the Bench ⇒ NOT silver.
    const parked = seedPersonAndDeal('Submitted', 'אבי גל');
    store().moveDeal(parked.deal.id, 'Bench');
    expect(benchOf(parked.person.id)!.silverMedalist).toBe(false);

    // Prior deal rejected from Submitted, then a NEW deal parked ⇒ silver.
    const silver = seedPersonAndDeal('Submitted', 'תמר זיו');
    store().moveDeal(silver.deal.id, 'Rejected', { reason: 'נסגר פנימי' });
    const second = store().addDeal({
      personId: silver.person.id,
      jobId: 'job-2',
      jobTitle: 'Team Lead',
    });
    store().moveDeal(second.id, 'Bench');
    const bench = benchOf(silver.person.id)!;
    expect(bench.silverMedalist).toBe(true);
    expect(bench.benchReason).toBe('bench'); // reason-less Bench move default
  });

  it('re-benching refreshes the reason but never downgrades an earned medal', () => {
    const { person, deal } = seedPersonAndDeal('Submitted', 'גיא רון');
    store().moveDeal(deal.id, 'Rejected', { reason: 'הפסיד בגמר' });
    expect(benchOf(person.id)!.silverMedalist).toBe(true);
    const shallow = store().addDeal({
      personId: person.id,
      jobId: 'job-3',
      jobTitle: 'DevOps',
    });
    store().moveDeal(shallow.id, 'Rejected', { reason: 'לא עבר סינון' });
    const bench = benchOf(person.id)!;
    expect(bench.benchReason).toBe('לא עבר סינון');
    expect(bench.silverMedalist).toBe(true); // preserved
  });

  it('computeSilverMedalist ignores tombstoned stage events', () => {
    const { person, deal } = seedPersonAndDeal('Submitted', 'נטע בר');
    store().moveDeal(deal.id, 'InConversation');
    usePipelineStore.setState((s) => ({
      stageEvents: s.stageEvents.map((e) => ({ ...e, deleted: true as const })),
    }));
    expect(
      computeSilverMedalist({
        personId: person.id,
        deals: store().deals,
        stageEvents: store().stageEvents,
        movingDealId: deal.id,
        movingFrom: 'InConversation',
        movingTo: 'Rejected',
      }),
    ).toBe(false);
  });

  it('benchBySilver groups live benched persons, silver first-class, newest first', () => {
    const a = seedPersonAndDeal('Submitted', 'אלף אלף');
    store().moveDeal(a.deal.id, 'Rejected', { reason: 'r' });
    const b = seedPersonAndDeal('Screened', 'בית בית');
    store().moveDeal(b.deal.id, 'Rejected', { reason: 'r' });
    const c = seedPersonAndDeal('Sourced', 'גימל גימל');
    store().moveDeal(c.deal.id, 'Bench');

    const grouped = benchBySilver();
    expect(grouped.silver.map((p) => p.id)).toEqual([a.person.id]);
    expect(new Set(grouped.others.map((p) => p.id))).toEqual(
      new Set([b.person.id, c.person.id]),
    );
    // state-attached selector parity
    expect(store().benchBySilver()).toEqual(grouped);

    // tombstoned persons drop out
    store().deletePerson(a.person.id);
    expect(benchBySilver().silver).toHaveLength(0);
  });
});

// ==================================================================
// 3. Deletion cascade + completeness sweep + undo
// ==================================================================

/**
 * Rich fixture: person P (benched, contacts) with two deals and three
 * suggestion reference vectors (personId / dealId / evidence.sourceId,
 * the last riding on ANOTHER person's suggestion) + an unrelated person Q.
 */
function cascadeFixture() {
  const p = seedPersonAndDeal('Submitted', 'פלוני נמחק');
  const d2 = store().addDeal({
    personId: p.person.id,
    jobId: 'job-x2',
    jobTitle: 'Data Engineer',
  });
  store().moveDeal(p.deal.id, 'Rejected', { reason: 'נבחר אחר' }); // benched + silver
  store().logContact(p.person.id, 'whatsapp', 'hash-1');

  const q = seedPersonAndDeal('Sourced', 'אלמוני נשאר');

  // TODO(lead): wave3 contract names the Bench Sourcer output kind
  // 'bench_match', but SuggestionKind (types/pipeline.ts, lead-owned) has no
  // such member — 'rematch' is the closest existing kind and is used here.
  // Add 'bench_match' to SuggestionKind before agents-engine Batch B.
  const sugByPerson = store().addSuggestion({
    agent: 'bench_sourcer',
    kind: 'rematch',
    personId: p.person.id,
    title: 'התאמה מהספסל',
    body: 'מתאים למשרה חדשה',
  });
  const sugByDeal = store().addSuggestion({
    agent: 'pit_boss',
    kind: 'next_action',
    dealId: d2.id,
    title: 'לקדם',
    body: '...',
  });
  const sugByEvidence = store().addSuggestion({
    agent: 'screener',
    kind: 'merge_person',
    personId: q.person.id, // rides on Q…
    title: 'כפילות',
    body: '...',
    evidence: [
      { claim: 'שם דומה', sourceType: 'person', sourceId: p.person.id }, // …but cites P
    ],
  });
  const sugUnrelated = store().addSuggestion({
    agent: 'outreach_runner',
    kind: 'draft_message',
    personId: q.person.id,
    title: 'טיוטה',
    body: 'שלום',
  });

  return { p, d2, q, sugByPerson, sugByDeal, sugByEvidence, sugUnrelated };
}

describe('deletePersonCascade', () => {
  it('refuses without confirm:true — zero mutation', () => {
    const { p } = cascadeFixture();
    const before = {
      persons: store().persons,
      deals: store().deals,
      suggestions: store().suggestions,
      stageEvents: store().stageEvents,
      auditLen: store().auditLog.length,
    };
    expect(
      store().deletePersonCascade(p.person.id, { confirm: false }),
    ).toBeNull();
    expect(
      store().deletePersonCascade(p.person.id, {} as { confirm: boolean }),
    ).toBeNull();
    expect(store().persons).toBe(before.persons);
    expect(store().deals).toBe(before.deals);
    expect(store().suggestions).toBe(before.suggestions);
    expect(store().stageEvents).toBe(before.stageEvents);
    expect(store().auditLog.length).toBe(before.auditLen);
  });

  it('returns null for unknown or already-deleted persons', () => {
    expect(store().deletePersonCascade('ghost', { confirm: true })).toBeNull();
    const { person } = store().addPerson({ name: 'כבר מחוק' });
    store().deletePerson(person.id);
    expect(store().deletePersonCascade(person.id, { confirm: true })).toBeNull();
  });

  it('tombstones person+deals+suggestions+events, purges bench, audits once, persists', () => {
    const f = cascadeFixture();
    const res = store().deletePersonCascade(f.p.person.id, { confirm: true })!;

    expect(res.personId).toBe(f.p.person.id);
    expect(new Set(res.dealIds)).toEqual(new Set([f.p.deal.id, f.d2.id]));
    expect(new Set(res.suggestionIds)).toEqual(
      new Set([f.sugByPerson.id, f.sugByDeal.id, f.sugByEvidence.id]),
    );
    expect(res.stageEventIds.length).toBeGreaterThan(0);
    expect(res.benchPurged).toBe(true);

    const st = store();
    const person = st.persons.find((x) => x.id === f.p.person.id) as PersonWithBenchMeta;
    expect(person.deleted).toBe(true);
    expect(person.deletedAt).toBeTruthy();
    expect(person.bench).toBeUndefined(); // bench entry purged
    for (const id of res.dealIds) {
      expect(st.deals.find((d) => d.id === id)!.deleted).toBe(true);
    }
    for (const id of res.suggestionIds) {
      expect(st.suggestions.find((x) => x.id === id)!.deleted).toBe(true);
    }
    for (const id of res.stageEventIds) {
      expect(st.stageEvents.find((e) => e.id === id)!.deleted).toBe(true);
    }

    // tombstone-only: nothing physically removed
    expect(st.persons.some((x) => x.id === f.p.person.id)).toBe(true);
    expect(st.deals.filter((d) => d.personId === f.p.person.id)).toHaveLength(2);

    // unrelated records untouched and live
    expect(st.persons.find((x) => x.id === f.q.person.id)!.deleted).toBeUndefined();
    expect(st.deals.find((d) => d.id === f.q.deal.id)!.deleted).toBeUndefined();
    expect(st.suggestions.find((x) => x.id === f.sugUnrelated.id)!.deleted).toBeUndefined();

    // one summary audit entry with the id lists
    const entries = st.auditLog.filter((e) => e.action === 'person.cascade_delete');
    expect(entries).toHaveLength(1);
    const after = entries[0].after as {
      cascade: { dealIds: string[]; suggestionIds: string[]; benchPurged: boolean };
    };
    expect(new Set(after.cascade.dealIds)).toEqual(new Set(res.dealIds));
    expect(after.cascade.benchPurged).toBe(true);

    // persisted + dirty-marked (tombstones must sync)
    const persisted = JSON.parse(localStorage.getItem(V3_KEYS.persons)!);
    expect(persisted.find((x: Person) => x.id === f.p.person.id).deleted).toBe(true);
    expect(st.dirtyIds.persons).toContain(f.p.person.id);
    for (const id of res.dealIds) expect(st.dirtyIds.deals).toContain(id);
    for (const id of res.suggestionIds) expect(st.dirtyIds.suggestions).toContain(id);
    for (const id of res.stageEventIds) expect(st.dirtyIds.events).toContain(id);
  });

  it('COMPLETENESS SWEEP: after cascade, NO live record of any type references the person', () => {
    const f = cascadeFixture();
    const targetIds = [
      f.p.person.id,
      ...store()
        .deals.filter((d) => d.personId === f.p.person.id)
        .map((d) => d.id),
    ];
    store().deletePersonCascade(f.p.person.id, { confirm: true });

    const st = store();
    const liveRecords: unknown[] = [
      ...st.persons.filter((r) => !r.deleted),
      ...st.deals.filter((r) => !r.deleted),
      ...st.suggestions.filter((r) => !r.deleted),
      ...st.stageEvents.filter((r) => !r.deleted),
    ];
    expect(liveRecords.length).toBeGreaterThan(0); // Q's world survives
    // Generic containment sweep: serialize each live record and assert it
    // carries neither the person id nor any of the person's deal ids.
    for (const rec of liveRecords) {
      const json = JSON.stringify(rec);
      for (const id of targetIds) {
        expect(json.includes(id)).toBe(false);
      }
    }

    // Selector surfaces agree
    expect(personById(f.p.person.id)).toBeUndefined();
    expect(benchPersons().some((x) => x.id === f.p.person.id)).toBe(false);
    const grouped = benchBySilver();
    expect(
      [...grouped.silver, ...grouped.others].some((x) => x.id === f.p.person.id),
    ).toBe(false);
    const byStage = dealsByStage();
    const boardDealIds = Object.values(byStage)
      .flat()
      .map((d) => d.id);
    expect(boardDealIds).not.toContain(f.p.deal.id);
    expect(boardDealIds).not.toContain(f.d2.id);
    expect(boardDealIds).toContain(f.q.deal.id);
  });

  it('cascade is one-click undoable: person (with bench), deals, suggestions, events return live', () => {
    const f = cascadeFixture();
    const res = store().deletePersonCascade(f.p.person.id, { confirm: true })!;
    expect(store().undoLast()).toBe(true);

    const st = store();
    const person = st.persons.find((x) => x.id === f.p.person.id) as PersonWithBenchMeta;
    expect(person.deleted).toBeUndefined();
    expect(person.bench).toBeDefined(); // bench entry restored with the snapshot
    expect(person.bench!.silverMedalist).toBe(true);
    for (const id of res.dealIds) {
      expect(st.deals.find((d) => d.id === id)!.deleted).toBeUndefined();
    }
    for (const id of res.suggestionIds) {
      expect(st.suggestions.find((x) => x.id === id)!.deleted).toBeUndefined();
    }
    for (const id of res.stageEventIds) {
      expect(st.stageEvents.find((e) => e.id === id)!.deleted).toBeUndefined();
    }
    expect(st.auditLog.at(-1)!.action).toBe('undo');
  });
});

// ==================================================================
// 4. Retention setting + purgeExpired
// ==================================================================

describe('retention + purgeExpired', () => {
  const OLD = '2025-01-01T00:00:00.000Z'; // > 6 months before NOW
  const YOUNG = '2026-07-01T00:00:00.000Z'; // inside the window
  const NOW = '2026-07-31T00:00:00.000Z';

  /** Tombstone the fixture person's cascade and backdate every tombstone. */
  function backdatedCascade(deletedAt: string) {
    const f = cascadeFixture();
    store().deletePersonCascade(f.p.person.id, { confirm: true });
    usePipelineStore.setState((s) => ({
      persons: s.persons.map((r) => (r.deleted ? { ...r, deletedAt } : r)),
      deals: s.deals.map((r) => (r.deleted ? { ...r, deletedAt } : r)),
      suggestions: s.suggestions.map((r) => (r.deleted ? { ...r, deletedAt } : r)),
      stageEvents: s.stageEvents.map((r) => (r.deleted ? { ...r, deletedAt } : r)),
    }));
    return f;
  }

  it('defaults to off and setRetentionMonths persists, normalizes, audits', () => {
    expect(store().retentionMonths).toBeNull();

    store().setRetentionMonths(6);
    expect(store().retentionMonths).toBe(6);
    expect(JSON.parse(localStorage.getItem(V3_KEYS.retention)!)).toBe(6);
    const entry = store().auditLog.at(-1)!;
    expect(entry.action).toBe('settings.retention');
    expect(entry.after).toEqual({ retentionMonths: 6 });

    store().setRetentionMonths(5.5); // fractions round UP (purge less)
    expect(store().retentionMonths).toBe(6);

    store().setRetentionMonths(0); // 0 / negative / null ⇒ off
    expect(store().retentionMonths).toBeNull();
    expect(JSON.parse(localStorage.getItem(V3_KEYS.retention)!)).toBeNull();
    store().setRetentionMonths(-3);
    expect(store().retentionMonths).toBeNull();
  });

  it('purgeExpired is a strict no-op while retention is off', () => {
    backdatedCascade(OLD);
    const before = store().persons.length;
    const res = store().purgeExpired(NOW);
    expect(res).toEqual({
      cutoff: null,
      persons: 0,
      deals: 0,
      suggestions: 0,
      stageEvents: 0,
      auditEntries: 0,
    });
    expect(store().persons.length).toBe(before); // tombstones still there
  });

  it('purges expired tombstones physically, keeps young tombstones and live data', () => {
    const f = backdatedCascade(OLD);
    // A young, unrelated tombstone must survive the purge.
    const young = store().addPerson({ name: 'טרי מחוק' }).person;
    store().deletePerson(young.id);
    usePipelineStore.setState((s) => ({
      persons: s.persons.map((r) =>
        r.id === young.id ? { ...r, deletedAt: YOUNG } : r,
      ),
    }));

    store().setRetentionMonths(6);
    const res = store().purgeExpired(NOW);

    expect(res.cutoff).toBe('2026-01-31T00:00:00.000Z');
    expect(res.persons).toBe(1);
    expect(res.deals).toBe(2);
    expect(res.suggestions).toBe(3);
    expect(res.stageEvents).toBeGreaterThan(0);

    const st = store();
    // physically gone — state AND persistence
    expect(st.persons.some((x) => x.id === f.p.person.id)).toBe(false);
    expect(st.deals.some((d) => d.personId === f.p.person.id)).toBe(false);
    const persisted = JSON.parse(localStorage.getItem(V3_KEYS.persons)!);
    expect(persisted.some((x: Person) => x.id === f.p.person.id)).toBe(false);
    // young tombstone + live data retained
    expect(st.persons.find((x) => x.id === young.id)!.deleted).toBe(true);
    expect(st.persons.find((x) => x.id === f.q.person.id)!.deleted).toBeUndefined();
    expect(st.deals.find((d) => d.id === f.q.deal.id)).toBeDefined();

    // purge summary audited, counts only
    const last = st.auditLog.at(-1)!;
    expect(last.action).toBe('retention.purge');
    expect((last.after as { counts: { persons: number } }).counts.persons).toBe(1);
  });

  it('scrubs audit entries referencing purged records (PII leaves with the data)', () => {
    const f = backdatedCascade(OLD);
    store().setRetentionMonths(6);
    const purged = store().purgeExpired(NOW);
    expect(purged.auditEntries).toBeGreaterThan(0);

    const json = JSON.stringify(store().auditLog);
    expect(json.includes(f.p.person.id)).toBe(false);
    expect(json.includes(f.p.deal.id)).toBe(false);
    expect(json.includes('פלוני נמחק')).toBe(false); // the person's name is gone
    // unrelated history survives
    expect(store().auditLog.some((e) => e.entityId === f.q.person.id)).toBe(true);
  });

  it('a tombstone exactly at the window boundary is kept (strictly-older purge)', () => {
    const f = backdatedCascade('2026-01-31T00:00:00.000Z'); // == cutoff
    store().setRetentionMonths(6);
    const res = store().purgeExpired(NOW);
    expect(res.persons).toBe(0);
    expect(store().persons.some((x) => x.id === f.p.person.id)).toBe(true);
  });
});

// ==================================================================
// 5. agentAcceptStats — Bench Sourcer throttle input
// ==================================================================

describe('agentAcceptStats', () => {
  function seedSug(agent: Parameters<typeof agentAcceptStats>[0], n: number) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(
        store().addSuggestion({
          agent,
          kind: 'flag',
          title: `t${i}`,
          body: 'b',
        }),
      );
    }
    return out;
  }

  it('tallies per agent with acceptRate = accepted / resolved', () => {
    const bench = seedSug('bench_sourcer', 6);
    store().acceptSuggestion(bench[0].id);
    store().acceptSuggestion(bench[1].id);
    store().dismissSuggestion(bench[2].id);
    const pit = seedSug('pit_boss', 2);
    store().dismissSuggestion(pit[0].id);

    expect(agentAcceptStats('bench_sourcer')).toEqual({
      agent: 'bench_sourcer',
      accepted: 2,
      dismissed: 1,
      pending: 3,
      resolved: 3,
      acceptRate: 2 / 3,
    });
    expect(agentAcceptStats('pit_boss').acceptRate).toBe(0);
    expect(store().agentAcceptStats('bench_sourcer')).toEqual(
      agentAcceptStats('bench_sourcer'),
    );
  });

  it('acceptRate is null (not 0) with nothing resolved — no fake numbers', () => {
    seedSug('bench_sourcer', 3);
    const stats = agentAcceptStats('bench_sourcer');
    expect(stats.resolved).toBe(0);
    expect(stats.acceptRate).toBeNull();
  });

  it('tombstoned suggestions leave the tallies', () => {
    const [a, b] = seedSug('bench_sourcer', 2);
    store().acceptSuggestion(a.id);
    store().dismissSuggestion(b.id);
    usePipelineStore.setState((s) => ({
      suggestions: s.suggestions.map((x) =>
        x.id === a.id ? { ...x, deleted: true as const } : x,
      ),
    }));
    expect(agentAcceptStats('bench_sourcer')).toEqual({
      agent: 'bench_sourcer',
      accepted: 0,
      dismissed: 1,
      pending: 0,
      resolved: 1,
      acceptRate: 0,
    });
  });

  it('throttle seam sanity: exactly 1/5 is NOT below the 1/5 threshold', () => {
    const sugs = seedSug('bench_sourcer', 5);
    store().acceptSuggestion(sugs[0].id);
    for (const s of sugs.slice(1)) store().dismissSuggestion(s.id);
    const { acceptRate } = agentAcceptStats('bench_sourcer');
    expect(acceptRate).toBe(0.2);
    expect(acceptRate! < 1 / 5).toBe(false); // agents-engine halves only strictly below
  });
});
