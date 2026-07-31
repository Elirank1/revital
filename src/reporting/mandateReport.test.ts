import { describe, expect, it } from 'vitest';
import type { CandidateAnalysis, JobDescription } from '../types';
import type { Deal, Person, StageEvent } from '../types/pipeline';
import { buildMandateReport } from './mandateReport';
import type { MandateReport, ReportLine } from './mandateReport';

// ------------------------------------------------------------
// Fixture factories (synthetic data only — G4)
// ------------------------------------------------------------

const NOW = new Date('2026-07-31T12:00:00.000Z');
const RLO = '\u202E';
const PDF_ = '\u202C';

function mandate(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    id: 'job-1',
    title: 'Senior Backend Engineer',
    rawText: '',
    pillars: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function person(id: string, name: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    v: 1,
    updatedAt: '2026-07-30T00:00:00.000Z',
    name,
    normalizedName: name.toLowerCase(),
    analysisIds: [],
    contactEvents: [],
    ...overrides,
  };
}

function deal(
  id: string,
  personId: string,
  stage: Deal['stage'],
  stageEnteredAt: string,
  overrides: Partial<Deal> = {}
): Deal {
  return {
    id,
    v: 1,
    updatedAt: stageEnteredAt,
    personId,
    jobId: 'job-1',
    jobTitle: 'Senior Backend Engineer',
    stage,
    stageEnteredAt,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function stageEvent(
  id: string,
  dealId: string,
  to: StageEvent['to'],
  ts: string,
  overrides: Partial<StageEvent> = {}
): StageEvent {
  return {
    id,
    v: 1,
    updatedAt: ts,
    dealId,
    from: null,
    to,
    ts,
    actor: 'human',
    skippedStages: [],
    ...overrides,
  };
}

function analysis(id: string, overrides: Partial<CandidateAnalysis> = {}): CandidateAnalysis {
  return {
    id,
    candidateId: 'cand-1',
    jobId: 'job-1',
    candidateName: 'יוסי כהן',
    jobTitle: 'Senior Backend Engineer',
    timestamp: '2026-07-20T00:00:00.000Z',
    profileSummary: 'מהנדס backend מנוסה.',
    matchScore: 88,
    verdict: 'Strong Fit',
    pillarScores: [],
    greenFlags: [],
    redFlags: [],
    autoRedFlags: [],
    truthTestQuestions: [],
    recruiterQuestions: [],
    recruiterNotes: { outreachAngle: '', salaryEstimate: '', additionalNotes: '' },
    recruiterComment: '',
    rawResponse: '',
    ...overrides,
  };
}

/** The full synthetic mandate: 8 in-scope deals + 2 out-of-scope. */
function fixture() {
  const persons = [
    person('p1', 'דנה לוי'),
    person('p2', 'יוסי כהן'),
    person('p3', 'Amit Peretz'),
    person('p4', 'נועה בר'),
    person(
      'p5',
      `רון ${RLO}evil${PDF_} שדה`,
      {
        contactEvents: [
          { kind: 'contacted', ts: '2026-07-28T09:00:00.000Z', channel: 'whatsapp', dealId: 'd5' },
        ],
      }
    ),
    person('p6', 'טל ברק'),
    person('p7', 'אורי מזרחי'),
    person('p8', 'עדן טל'),
    person('p-x', 'זר מנדט'),
    person('p-del', 'נמחק נמחקוב'),
  ];

  const deals = [
    deal('d1', 'p1', 'Submitted', '2026-07-29T08:00:00.000Z'),
    deal('d2', 'p2', 'Submitted', '2026-07-23T10:00:00.000Z', { analysisId: 'an-1' }),
    deal('d3', 'p3', 'ClientInterview', '2026-07-22T09:00:00.000Z'),
    deal('d4', 'p4', 'Offer', '2026-07-25T09:00:00.000Z'),
    deal('d5', 'p5', 'InConversation', '2026-07-20T09:00:00.000Z'),
    deal('d6', 'p6', 'Sourced', '2026-07-30T09:00:00.000Z'),
    deal('d7', 'p7', 'Rejected', '2026-07-15T09:00:00.000Z', {
      rejection: { reason: 'ניסיון לא מתאים', ts: '2026-07-15T09:00:00.000Z' },
    }),
    deal('d8', 'p8', 'Placed', '2026-07-10T09:00:00.000Z'),
    // Out of scope: another mandate + a tombstoned deal.
    deal('d-x', 'p-x', 'Submitted', '2026-07-20T09:00:00.000Z', { jobId: 'job-2' }),
    deal('d-del', 'p-del', 'Submitted', '2026-07-20T09:00:00.000Z', { deleted: true }),
  ];

  const events = [
    stageEvent('ev1', 'd1', 'Submitted', '2026-07-29T08:00:00.000Z', { from: 'InConversation' }),
    stageEvent('ev2', 'd2', 'Submitted', '2026-07-23T10:00:00.000Z', { from: 'InConversation' }),
    stageEvent('ev3s', 'd3', 'Submitted', '2026-07-18T09:00:00.000Z', { from: 'InConversation' }),
    stageEvent('ev3', 'd3', 'ClientInterview', '2026-07-22T09:00:00.000Z', { from: 'Submitted' }),
    stageEvent('ev4', 'd4', 'Offer', '2026-07-25T09:00:00.000Z', { from: 'ClientInterview' }),
    // d8 deliberately has NO event — date must fall back to stageEnteredAt.
  ];

  const analyses = [
    analysis('an-1', {
      profileSummary:
        'מהנדס תוכנה עם עשר שנות ניסיון בפיתוח מערכות backend בעומסים גבוהים, ' +
        'כולל הובלה טכנולוגית של צוותים, עבודה עם Node.js ו-Kubernetes בסביבות ענן, ' +
        'ורקורד מוכח של עמידה ביעדים עסקיים לאורך זמן.',
    }),
  ];

  return { persons, deals, events, analyses };
}

function build(opts: Parameters<typeof buildMandateReport>[4] = {}): MandateReport {
  const { persons, deals, events, analyses } = fixture();
  return buildMandateReport(mandate(), deals, events, persons, {
    now: NOW,
    analyses,
    ...opts,
  });
}

const claimLines = (r: MandateReport) =>
  r.lines.filter((l): l is Extract<ReportLine, { kind: 'claim' }> => l.kind === 'claim');

// ------------------------------------------------------------
// Evidence coverage — the binding contract
// ------------------------------------------------------------

describe('buildMandateReport — evidence coverage (every claim carries a ref)', () => {
  it('every claim line has at least one non-empty evidence ref', () => {
    const report = build();
    const claims = claimLines(report);
    expect(claims.length).toBeGreaterThan(10);
    for (const line of claims) {
      expect(line.refs.length).toBeGreaterThan(0);
      for (const ref of line.refs) {
        expect(ref.sourceType).not.toBe('');
        expect(ref.sourceId).not.toBe('');
      }
    }
  });

  it('evidence array is exactly the flattening of claim lines × refs', () => {
    const report = build();
    const expected = claimLines(report).flatMap((l) =>
      l.refs.map((ref) => ({ claim: l.text, sourceType: ref.sourceType, sourceId: ref.sourceId }))
    );
    expect(report.evidence).toEqual(expected);
  });

  it('the ENTIRE plain text is reconstructable from lines — no untracked content', () => {
    const report = build();
    const lineTexts = new Set(report.lines.map((l) => l.text));
    const bodyLines = report.text
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => l.replace(/^• /, '').replace(/^ {2}/, ''));
    for (const bodyLine of bodyLines) {
      expect(lineTexts.has(bodyLine)).toBe(true);
    }
    // ...and nothing structured is silently dropped from the text.
    for (const line of report.lines) {
      expect(report.text).toContain(line.text);
    }
  });

  it('frame lines are static connective tissue only — data flows exclusively through claims', () => {
    const report = build({ clientName: 'חברת אקמי' });
    const STATIC_FRAMES = new Set([
      'תמונת מצב',
      'המועמדים שהוגשו',
      'ממתינים למשוב',
      'המשך התהליך',
      'נמשיך לעדכן בכל התפתחות.',
      'נשמח לעמוד לרשותכם בכל שאלה.',
      'בברכה,',
      'רויטל קרן',
    ]);
    for (const line of report.lines) {
      if (line.kind !== 'frame') continue;
      const allowed =
        STATIC_FRAMES.has(line.text) ||
        /^שלום .{1,60},$/.test(line.text) || // greeting (opts-supplied display name)
        /^נכון ל-\d{1,2}\.\d{1,2}\.\d{4}$/.test(line.text); // report date (injected clock)
      expect(allowed, `unexpected frame line: ${line.text}`).toBe(true);
    }
  });

  it('every Submitted+ deal is cited in evidence; submit claims cite the submit event', () => {
    const report = build();
    const cited = new Set(report.evidence.map((e) => e.sourceId));
    for (const dealId of ['d1', 'd2', 'd3', 'd4', 'd8']) {
      expect(cited.has(dealId), `deal ${dealId} not cited`).toBe(true);
    }
    // Submitted status lines cite their StageEvent ids.
    expect(cited.has('ev1')).toBe(true);
    expect(cited.has('ev2')).toBe(true);
    // ClientInterview cites its stage-entry event.
    expect(cited.has('ev3')).toBe(true);
  });
});

// ------------------------------------------------------------
// Content — funnel, submitted summaries, nudges, next steps
// ------------------------------------------------------------

describe('buildMandateReport — content', () => {
  it('funnel counts are correct per client-facing bucket', () => {
    const { text } = build();
    expect(text).toContain('באיתור ובסינון ראשוני: מועמד אחד');
    expect(text).toContain('בשיחות פעילות: מועמד אחד');
    expect(text).toContain('הוגשו לבחינתכם: שני מועמדים');
    expect(text).toContain('בתהליך ראיונות אצלכם: מועמד אחד');
    expect(text).toContain('בשלב הצעה: מועמד אחד');
    expect(text).toContain('השמה הושלמה: מועמד אחד');
  });

  it('Paid is never surfaced to the client — it reads as a completed placement', () => {
    const { persons } = fixture();
    const report = buildMandateReport(
      mandate(),
      [deal('d8', 'p8', 'Paid', '2026-07-10T09:00:00.000Z')],
      [],
      persons,
      { now: NOW }
    );
    expect(report.text).toContain('השמה הושלמה');
    expect(report.text).not.toContain('Paid');
    expect(report.text).not.toContain('תשלום');
    expect(report.text).not.toContain('חשבונית');
  });

  it('opening states the active count and cites job + every active deal', () => {
    const report = build();
    expect(report.text).toContain(
      'נכון להיום, 6 מועמדים נמצאים בתהליך פעיל עבור משרת Senior Backend Engineer.'
    );
    const opening = claimLines(report).find((l) => l.section === 'opening');
    // Placed (d8) is not "in active process" — cited by funnel/submitted, not the opening.
    expect(opening?.refs.map((r) => r.sourceId).sort()).toEqual(
      ['job-1', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'].sort()
    );
  });

  it('submitted candidates get dated status lines in pipeline order', () => {
    const { text } = build();
    expect(text).toContain('יוסי כהן — המועמדות הוגשה לבחינתכם ב-23.7.2026 (לפני 8 ימים).');
    expect(text).toContain('דנה לוי — המועמדות הוגשה לבחינתכם ב-29.7.2026 (לפני יומיים).');
    expect(text).toContain('Amit Peretz — בתהליך ראיונות אצלכם מאז 22.7.2026.');
    expect(text).toContain('נועה בר — בשלב הצעה מאז 25.7.2026.');
    // d8 has no event — falls back to stageEnteredAt.
    expect(text).toContain('עדן טל — ההשמה הושלמה ב-10.7.2026.');
    // Within Submitted: earlier submission listed first.
    expect(text.indexOf('יוסי כהן — המועמדות')).toBeLessThan(text.indexOf('דנה לוי — המועמדות'));
  });

  it('a candidate with an analysis gets a short summary claim citing the analysis', () => {
    const report = build();
    const summary = claimLines(report).find((l) =>
      l.refs.some((r) => r.sourceType === 'analysis' && r.sourceId === 'an-1')
    );
    expect(summary).toBeDefined();
    expect(summary?.section).toBe('submitted');
    expect(summary?.text.length).toBeLessThanOrEqual(161); // 160 + ellipsis
    expect(summary?.text.endsWith('…')).toBe(true);
    expect(summary?.refs.map((r) => r.sourceId)).toContain('d2');
    // Candidates without an analysis get no summary line.
    const d1Summary = claimLines(report).filter(
      (l) => l.indent === true && l.refs.some((r) => r.sourceId === 'd1')
    );
    expect(d1Summary).toHaveLength(0);
  });

  it('feedback-pending nudges: overdue deals only, most overdue first', () => {
    const { text } = build();
    expect(text).toContain('ממתינים למשוב');
    // d3: 9 days in ClientInterview; d2: 8 days since submission.
    expect(text).toContain('Amit Peretz — בתהליך הראיונות מזה 9 ימים ללא עדכון; נשמח לסטטוס.');
    expect(text).toContain(
      'יוסי כהן — המועמדות הוגשה לפני 8 ימים וטרם התקבל משוב; נשמח לעדכון כדי שנוכל להתקדם.'
    );
    expect(text.indexOf('Amit Peretz — בתהליך הראיונות מזה')).toBeLessThan(
      text.indexOf('יוסי כהן — המועמדות הוגשה לפני 8 ימים')
    );
    // d1 was submitted 2 days ago — under the 6-day default, no nudge.
    expect(text).not.toContain('דנה לוי — המועמדות הוגשה לפני יומיים וטרם');
  });

  it('feedbackPendingDays is configurable', () => {
    const { text } = build({ feedbackPendingDays: 1 });
    expect(text).toContain('דנה לוי — המועמדות הוגשה לפני יומיים וטרם התקבל משוב');
  });

  it('recent outreach activity line cites the contacted persons', () => {
    const report = build();
    expect(report.text).toContain('בשבוע האחרון פנינו למועמד אחד עבור המשרה.');
    const activity = claimLines(report).find((l) => l.text.includes('בשבוע האחרון'));
    expect(activity?.refs).toEqual([{ sourceType: 'person', sourceId: 'p5' }]);
  });

  it('rejected candidates appear as an aggregate count citing their deals', () => {
    const report = build();
    expect(report.text).toContain('בנוסף, מועמד אחד נבחן ולא נמצא מתאים בשלב זה.');
    const rejected = claimLines(report).find((l) => l.text.includes('לא נמצא מתאים'));
    expect(rejected?.refs).toEqual([{ sourceType: 'deal', sourceId: 'd7' }]);
  });

  it('next steps are derived from live stages and cite their deals', () => {
    const report = build();
    expect(report.text).toContain('קבלת משוב על שני המועמדים הממתינים');
    expect(report.text).toContain('ממשיכים במקביל את השיחות עם מועמד אחד');
    expect(report.text).toContain('האיתור נמשך — מועמד אחד נוסף נמצא בסינון ראשוני.');
    expect(report.text).toContain('מלווים באופן צמוד את שלב ההצעה');
    const offerStep = claimLines(report).find((l) => l.text.includes('שלב ההצעה'));
    expect(offerStep?.refs).toEqual([{ sourceType: 'deal', sourceId: 'd4' }]);
  });

  it('greeting honors clientName; defaults to שלום רב', () => {
    expect(build().text).toContain('שלום רב,');
    expect(build({ clientName: 'חברת אקמי' }).text).toContain('שלום חברת אקמי,');
  });
});

// ------------------------------------------------------------
// Scoping, safety, determinism
// ------------------------------------------------------------

describe('buildMandateReport — scoping and safety', () => {
  it('other mandates and tombstoned records never leak in', () => {
    const { text, html, evidence } = build();
    expect(text).not.toContain('זר מנדט');
    expect(text).not.toContain('נמחק נמחקוב');
    expect(html).not.toContain('זר מנדט');
    const cited = new Set(evidence.map((e) => e.sourceId));
    expect(cited.has('d-x')).toBe(false);
    expect(cited.has('d-del')).toBe(false);
  });

  it('BiDi override controls injected via a person name are stripped everywhere', () => {
    const persons = [person('p9', `רון ${RLO}evil${PDF_} שדה`)];
    const deals = [deal('d9', 'p9', 'Submitted', '2026-07-29T08:00:00.000Z')];
    const { text, html } = buildMandateReport(mandate(), deals, [], persons, { now: NOW });
    expect(text).toContain('רון evil שדה'); // name renders, minus the controls
    const bidiControls = /[\u202A-\u202E\u2066-\u2069]/;
    for (const output of [text, html]) {
      expect(output.includes(RLO)).toBe(false);
      expect(output.includes(PDF_)).toBe(false);
      expect(bidiControls.test(output)).toBe(false);
    }
    // The full fixture (BiDi name at InConversation) stays control-free too.
    const full = build();
    expect(bidiControls.test(full.text)).toBe(false);
    expect(bidiControls.test(full.html)).toBe(false);
  });

  it('HTML-escapes hostile content in interpolated fields', () => {
    const persons = [person('p1', 'Eve <b>&"bold"</b>')];
    const deals = [deal('d1', 'p1', 'Submitted', '2026-07-29T08:00:00.000Z')];
    const report = buildMandateReport(mandate(), deals, [], persons, { now: NOW });
    expect(report.html).not.toContain('<b>');
    expect(report.html).toContain('Eve &lt;b&gt;&amp;&quot;bold&quot;&lt;/b&gt;');
    // Plain text keeps the raw (sanitized) characters — it is not HTML.
    expect(report.text).toContain('Eve <b>&"bold"</b>');
  });

  it('deterministic: same inputs yield byte-identical output', () => {
    const a = build();
    const b = build();
    expect(b.text).toBe(a.text);
    expect(b.html).toBe(a.html);
    expect(b).toEqual(a);
  });

  it('empty pipeline: honest empty-state report citing the mandate', () => {
    const report = buildMandateReport(mandate(), [], [], [], { now: NOW });
    expect(report.text).toContain(
      'בשלב זה אין מועמדים בתהליך פעיל עבור משרת Senior Backend Engineer'
    );
    expect(report.text).not.toContain('תמונת מצב');
    expect(report.text).not.toContain('המועמדים שהוגשו');
    expect(report.text).toContain('נמשיך לעדכן בכל התפתחות.');
    expect(report.text).toContain('רויטל קרן');
    // Header + opening claims both cite the mandate — nothing else exists to cite.
    expect(report.evidence).toHaveLength(2);
    for (const e of report.evidence) {
      expect(e.sourceType).toBe('job');
      expect(e.sourceId).toBe('job-1');
    }
  });

  it('works without opts (real clock path)', () => {
    const { persons, deals, events } = fixture();
    const report = buildMandateReport(mandate(), deals, events, persons);
    expect(report.text.length).toBeGreaterThan(0);
    expect(report.html).toContain('dir="rtl"');
  });
});

// ------------------------------------------------------------
// HTML shape (RTL correctness) + suggestion handoff
// ------------------------------------------------------------

describe('buildMandateReport — HTML and suggestion', () => {
  it('renders an RTL fragment with dir attributes and logical CSS', () => {
    const { html } = build();
    expect(html.startsWith('<div dir="rtl"')).toBe(true);
    expect(html).toContain('direction: rtl');
    expect(html).toContain('text-align: start');
    expect(html).toContain('padding-inline-start');
    expect(html).toContain('dir="auto"');
    expect(html.endsWith('</div>')).toBe(true);
    // Section headers present.
    for (const h of ['תמונת מצב', 'המועמדים שהוגשו', 'ממתינים למשוב', 'המשך התהליך']) {
      expect(html).toContain(`>${h}</h3>`);
    }
  });

  it('every claim appears in the HTML (escaped), so both renderings carry identical facts', () => {
    const report = build();
    const escape = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    for (const line of claimLines(report)) {
      expect(report.html).toContain(escape(line.text));
    }
  });

  it('suggestionInput is a client_reporter report whose body and evidence match', () => {
    const report = build();
    expect(report.suggestionInput.agent).toBe('client_reporter');
    expect(report.suggestionInput.kind).toBe('report');
    expect(report.suggestionInput.title).toContain('Senior Backend Engineer');
    expect(report.suggestionInput.body).toBe(report.text);
    expect(report.suggestionInput.evidence).toEqual(report.evidence);
    // Defensive copy — not the same array reference.
    expect(report.suggestionInput.evidence).not.toBe(report.evidence);
  });
});
