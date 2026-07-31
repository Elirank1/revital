// @vitest-environment jsdom
/**
 * Reporter evidence coverage over STORE-PRODUCED data (quality-gate,
 * Wave 2 batch C).
 *
 * integrations' own suite proves evidence discipline on hand-built
 * synthetic records. This suite closes the seam the owner could not:
 * the records are produced by the REAL pipeline store actions
 * (addPerson / addDeal / moveDeal / logContact) — ids, StageEvents and
 * contactEvents exactly as the live app writes them — and then EVERY
 * claim in the report must resolve to one of those records:
 *
 *  - every claim ref's sourceId exists in the store collection named by
 *    its sourceType (deal → deals of THIS mandate, event → stageEvents
 *    of this mandate's deals, person → persons, job → the mandate,
 *    analysis → the provided analyses) — no dangling and no
 *    cross-mandate evidence, ever;
 *  - every claim text appears verbatim in report.text; the flattened
 *    evidence array is exactly Σ(claim × refs);
 *  - frame (unreferenced) lines never smuggle data: no candidate name
 *    and no job title may appear in a frame;
 *  - a different mandate's deal/person stay entirely out of the report;
 *  - funnel counts match the store's live stage reality;
 *  - the feedback-pending nudge fires from the store's own
 *    stageEnteredAt and cites the deal, person and entry event;
 *  - no ₪ anywhere (calibration rule holds in client-facing output).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CandidateAnalysis, JobDescription } from '../types';
import { usePipelineStore } from '../store/pipelineStore';
import {
  resetMoneyStore,
  resetPipelineStore,
} from '../views/Pipeline/storeTestKit';
import { buildMandateReport, type MandateReport } from './mandateReport';

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB_ID = 'job-report';
const JOB_TITLE = 'מנהל/ת מוצר בכיר/ה';

function backdate(dealId: string, days: number): void {
  usePipelineStore.setState((s) => ({
    deals: s.deals.map((d) =>
      d.id === dealId
        ? { ...d, stageEnteredAt: new Date(Date.now() - days * DAY_MS).toISOString() }
        : d,
    ),
  }));
}

interface Fixture {
  report: MandateReport;
  mandate: JobDescription;
  analysis: CandidateAnalysis;
  submittedName: string;
  interviewName: string;
  outreachName: string;
  otherMandateDealId: string;
  otherMandateName: string;
}

/** Drive the real store through a plausible mandate history, then report. */
function buildFixture(): Fixture {
  resetPipelineStore();
  resetMoneyStore();
  const store = () => usePipelineStore.getState();

  // Candidate A: full journey Sourced → … → Submitted (real StageEvents),
  // then 8 days of client silence (feedback nudge territory).
  const a = store().addPerson({ name: 'נועה ברק', phone: '0521111111' });
  const dealA = store().addDeal({
    personId: a.person.id,
    jobId: JOB_ID,
    jobTitle: JOB_TITLE,
  });
  store().moveDeal(dealA.id, 'Screened');
  store().moveDeal(dealA.id, 'Outreach');
  store().moveDeal(dealA.id, 'InConversation');
  store().moveDeal(dealA.id, 'Submitted');
  backdate(dealA.id, 8);

  // Candidate B: entered directly at ClientInterview (skip StageEvent),
  // carries an analysis for the short-summary claim.
  const analysis = {
    id: 'an-b1',
    candidateId: 'c-b1',
    jobId: JOB_ID,
    candidateName: 'עמית שרון',
    jobTitle: JOB_TITLE,
    timestamp: new Date().toISOString(),
    profileSummary:
      'שמונה שנות ניהול מוצר בחברות SaaS, מהן שלוש כראש קבוצה; רקע טכני חזק ועבודה צמודה עם צוותי פיתוח ודאטה.',
    matchScore: 86,
    verdict: 'Strong Fit',
  } as CandidateAnalysis;
  const b = store().addPerson({ name: 'עמית שרון' });
  const dealB = store().addDeal({
    personId: b.person.id,
    jobId: JOB_ID,
    jobTitle: JOB_TITLE,
    stage: 'ClientInterview',
    analysisId: analysis.id,
  });

  // Candidate C: in Outreach, contacted 2 days ago (recent-outreach claim).
  const c = store().addPerson({ name: 'דנה אשכנזי', phone: '0523333333' });
  const dealC = store().addDeal({
    personId: c.person.id,
    jobId: JOB_ID,
    jobTitle: JOB_TITLE,
    stage: 'Outreach',
  });
  store().logContact(
    c.person.id,
    'whatsapp',
    'abcd1234',
    new Date(Date.now() - 2 * DAY_MS).toISOString(),
  );

  // Candidate D: examined and rejected (with reason — store contract).
  const d = store().addPerson({ name: 'יואב מלכה' });
  const dealD = store().addDeal({
    personId: d.person.id,
    jobId: JOB_ID,
    jobTitle: JOB_TITLE,
    stage: 'Screened',
  });
  store().moveDeal(dealD.id, 'Rejected', { reason: 'ניסיון לא רלוונטי' });

  // A SECOND mandate that must never surface in this mandate's report.
  const z = store().addPerson({ name: 'זר לחלוטין' });
  const dealZ = store().addDeal({
    personId: z.person.id,
    jobId: 'job-other',
    jobTitle: 'משרה אחרת לגמרי',
    stage: 'Submitted',
  });

  const mandate: JobDescription = {
    id: JOB_ID,
    title: JOB_TITLE,
    rawText: '',
    pillars: [],
    createdAt: new Date().toISOString(),
  };

  const { deals, stageEvents, persons } = store();
  const report = buildMandateReport(mandate, deals, stageEvents, persons, {
    clientName: 'אורי',
    analyses: [analysis],
  });

  return {
    report,
    mandate,
    analysis,
    submittedName: 'נועה ברק',
    interviewName: 'עמית שרון',
    outreachName: 'דנה אשכנזי',
    otherMandateDealId: dealZ.id,
    otherMandateName: 'זר לחלוטין',
  };
}

let fx: Fixture;

beforeEach(() => {
  fx = buildFixture();
});

describe('reporter evidence coverage against store-produced records', () => {
  it('every claim ref resolves to a real record of the right type — none dangling, none cross-mandate', () => {
    const { deals, stageEvents, persons } = usePipelineStore.getState();
    const mandateDealIds = new Set(
      deals.filter((d) => d.jobId === JOB_ID).map((d) => d.id),
    );
    const mandateEventIds = new Set(
      stageEvents.filter((e) => mandateDealIds.has(e.dealId)).map((e) => e.id),
    );
    const personIds = new Set(persons.map((p) => p.id));

    const claims = fx.report.lines.filter((l) => l.kind === 'claim');
    expect(claims.length).toBeGreaterThanOrEqual(8);

    for (const line of claims) {
      expect(line.refs.length).toBeGreaterThanOrEqual(1);
      for (const ref of line.refs) {
        switch (ref.sourceType) {
          case 'deal':
            expect(mandateDealIds.has(ref.sourceId)).toBe(true);
            break;
          case 'event':
            expect(mandateEventIds.has(ref.sourceId)).toBe(true);
            break;
          case 'person':
            expect(personIds.has(ref.sourceId)).toBe(true);
            break;
          case 'job':
            expect(ref.sourceId).toBe(JOB_ID);
            break;
          case 'analysis':
            expect(ref.sourceId).toBe(fx.analysis.id);
            break;
          default:
            throw new Error(`unknown evidence sourceType: ${ref.sourceType}`);
        }
      }
    }
  });

  it('claim texts appear verbatim in the text rendering; evidence is exactly Σ(claim × refs)', () => {
    const claims = fx.report.lines.filter((l) => l.kind === 'claim');
    for (const line of claims) {
      expect(fx.report.text).toContain(line.text);
    }
    const expectedPairs = claims.reduce((n, l) => n + l.refs.length, 0);
    expect(fx.report.evidence).toHaveLength(expectedPairs);
    // The suggestionInput hands the store the same evidence, claim-complete.
    expect(fx.report.suggestionInput.evidence).toHaveLength(expectedPairs);
    for (const e of fx.report.evidence) {
      expect(claims.some((l) => l.text === e.claim)).toBe(true);
    }
  });

  it('frames never smuggle data: no candidate name, no job title in unreferenced lines', () => {
    const frames = fx.report.lines.filter((l) => l.kind === 'frame');
    const names = [
      fx.submittedName,
      fx.interviewName,
      fx.outreachName,
      'יואב מלכה',
      fx.otherMandateName,
    ];
    for (const line of frames) {
      expect(line.text).not.toContain(JOB_TITLE);
      for (const name of names) {
        expect(line.text).not.toContain(name);
      }
    }
  });

  it('a different mandate stays entirely out of the report', () => {
    for (const e of fx.report.evidence) {
      expect(e.sourceId).not.toBe(fx.otherMandateDealId);
    }
    expect(fx.report.text).not.toContain(fx.otherMandateName);
    expect(fx.report.text).not.toContain('משרה אחרת לגמרי');
    expect(fx.report.html).not.toContain('משרה אחרת לגמרי');
  });

  it('funnel counts match the store reality; nudge fires from stageEnteredAt with full citations', () => {
    // Live stages: A=Submitted(8d), B=ClientInterview, C=Outreach, D=Rejected.
    expect(fx.report.text).toContain('הוגשו לבחינתכם: מועמד אחד');
    expect(fx.report.text).toContain('בתהליך ראיונות אצלכם: מועמד אחד');
    expect(fx.report.text).toContain('בשיחות פעילות: מועמד אחד');
    expect(fx.report.text).toContain('מועמד אחד נבחן ולא נמצא מתאים בשלב זה');
    // Recent outreach: exactly one contacted within 7d.
    expect(fx.report.text).toContain('בשבוע האחרון פנינו למועמד אחד עבור המשרה.');

    // The 8-day Submitted wait produces the feedback nudge, citing
    // deal + person + the entry event the store itself wrote.
    expect(fx.report.text).toContain('ממתינים למשוב');
    const nudge = fx.report.lines.find(
      (l) =>
        l.kind === 'claim' &&
        l.section === 'feedback' &&
        l.text.includes(fx.submittedName),
    );
    expect(nudge).toBeDefined();
    if (nudge?.kind === 'claim') {
      const types = nudge.refs.map((r) => r.sourceType).sort();
      expect(types).toEqual(['deal', 'event', 'person']);
    }

    // The analysis-backed short summary rides under candidate B.
    const summary = fx.report.lines.find(
      (l) =>
        l.kind === 'claim' &&
        l.refs.some((r) => r.sourceType === 'analysis' && r.sourceId === fx.analysis.id),
    );
    expect(summary).toBeDefined();
    expect(summary?.text).toContain('שמונה שנות ניהול מוצר');
  });

  it('no ₪ in any rendering of a client-facing report', () => {
    expect(fx.report.text).not.toContain('₪');
    expect(fx.report.html).not.toContain('₪');
    expect(fx.report.title).not.toContain('₪');
    expect(JSON.stringify(fx.report.evidence)).not.toContain('₪');
  });
});
