import { describe, expect, it } from 'vitest';
import type { Deal, Person } from '../../types/pipeline';
import type { CandidateAnalysis } from '../../types';
import { followUpDraft, openerDraft } from './drafts';

const RLO = '\u202E';
const LRI = '\u2066';
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/;

const TS = '2026-07-30T10:00:00.000Z';

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'p-1',
    v: 0,
    updatedAt: TS,
    name: 'דנה כהן',
    normalizedName: 'דנה כהן',
    phone: '050-123-4567',
    analysisIds: ['a-1'],
    contactEvents: [],
    ...overrides,
  };
}

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 'd-1',
    v: 0,
    updatedAt: TS,
    personId: 'p-1',
    jobId: 'j-1',
    jobTitle: 'Backend Engineer',
    stage: 'Screened',
    stageEnteredAt: TS,
    createdAt: TS,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<CandidateAnalysis> = {}): CandidateAnalysis {
  return {
    id: 'a-1',
    candidateId: 'c-1',
    jobId: 'j-1',
    candidateName: 'דנה כהן',
    jobTitle: 'Backend Engineer',
    timestamp: TS,
    profileSummary: 'מפתחת בכירה עם ניסיון בצד שרת',
    matchScore: 82,
    verdict: 'Strong Fit',
    pillarScores: [],
    greenFlags: ['ניסיון עמוק ב-Node.js'],
    redFlags: [],
    autoRedFlags: [],
    truthTestQuestions: [],
    recruiterQuestions: [],
    recruiterNotes: { outreachAngle: '', salaryEstimate: '', additionalNotes: '' },
    recruiterComment: '',
    rawResponse: '',
  };
}

describe('openerDraft — message content', () => {
  it('greets by first name only and names the actual job title', () => {
    const { text } = openerDraft(makePerson(), makeDeal());
    expect(text.startsWith('היי דנה,')).toBe(true);
    expect(text).not.toContain('היי דנה כהן');
    expect(text).toContain('Backend Engineer');
  });

  it('with an analysis, says the profile was reviewed — but NEVER the score', () => {
    const { text } = openerDraft(makePerson(), makeDeal(), makeAnalysis());
    expect(text).toContain('עברתי על הפרופיל');
    expect(text).not.toContain('82');
    expect(text).not.toContain('Strong Fit');
  });

  it('without an analysis, claims no review happened', () => {
    const { text } = openerDraft(makePerson(), makeDeal());
    expect(text).not.toContain('עברתי');
    expect(text).toContain('חשבתי שזה עשוי לעניין אותך');
  });

  it('interpolates no undefined/null artifacts', () => {
    for (const draft of [
      openerDraft(makePerson(), makeDeal()),
      openerDraft(makePerson(), makeDeal(), makeAnalysis()),
      followUpDraft(makePerson(), makeDeal(), 5),
    ]) {
      expect(draft.text).not.toMatch(/undefined|null|\[object/);
      expect(draft.suggestionInput.title).not.toMatch(/undefined|null|\[object/);
    }
  });
});

describe('openerDraft — suggestionInput', () => {
  it('is a store-ready draft_message from outreach_runner with body === text', () => {
    const draft = openerDraft(makePerson(), makeDeal(), makeAnalysis());
    const s = draft.suggestionInput;
    expect(s.agent).toBe('outreach_runner');
    expect(s.kind).toBe('draft_message');
    expect(s.dealId).toBe('d-1');
    expect(s.personId).toBe('p-1');
    expect(s.body).toBe(draft.text);
    expect(s.title).toContain('דנה כהן');
    expect(s.title).toContain('Backend Engineer');
  });

  it('cites the deal, and the analysis when present', () => {
    const withAnalysis = openerDraft(makePerson(), makeDeal(), makeAnalysis()).suggestionInput;
    expect(withAnalysis.evidence).toHaveLength(2);
    expect(withAnalysis.evidence[0]).toMatchObject({ sourceType: 'deal', sourceId: 'd-1' });
    expect(withAnalysis.evidence[1]).toMatchObject({ sourceType: 'analysis', sourceId: 'a-1' });
    // the score belongs in evidence (internal), not in the outgoing message
    expect(withAnalysis.evidence[1].claim).toContain('82');

    const without = openerDraft(makePerson(), makeDeal()).suggestionInput;
    expect(without.evidence).toHaveLength(1);
    expect(without.evidence[0].sourceType).toBe('deal');
  });
});

describe('BiDi safety — direction controls neither survive nor get added', () => {
  it('strips override/isolate controls smuggled in via name or job title', () => {
    const person = makePerson({ name: `${RLO}דנה כהן` });
    const deal = makeDeal({ jobTitle: `Backend${LRI} Engineer` });
    const draft = openerDraft(person, deal, makeAnalysis());
    expect(draft.text).not.toMatch(BIDI_CONTROLS);
    expect(draft.suggestionInput.title).not.toMatch(BIDI_CONTROLS);
    expect(draft.suggestionInput.body).not.toMatch(BIDI_CONTROLS);
    // content survives sanitization
    expect(draft.text).toContain('דנה');
    expect(draft.text).toContain('Backend Engineer');
  });

  it('adds no direction controls to clean mixed Hebrew/English text', () => {
    const opener = openerDraft(makePerson(), makeDeal());
    const followUp = followUpDraft(makePerson(), makeDeal(), 3);
    expect(opener.text).not.toMatch(BIDI_CONTROLS);
    expect(followUp.text).not.toMatch(BIDI_CONTROLS);
  });
});

describe('followUpDraft — time reference grammar', () => {
  it.each([
    [1, 'שלחתי לך הודעה אתמול'],
    [2, 'שלחתי לך הודעה לפני יומיים'],
    [5, 'שלחתי לך הודעה לפני 5 ימים'],
    [10, 'שלחתי לך הודעה לפני 10 ימים'],
    [14, 'שלחתי לך הודעה לפני 14 יום'],
  ])('daysSilent=%i → "%s"', (days, expected) => {
    expect(followUpDraft(makePerson(), makeDeal(), days).text).toContain(expected);
  });

  it('floors fractional days', () => {
    expect(followUpDraft(makePerson(), makeDeal(), 2.9).text).toContain('לפני יומיים');
  });

  it.each([[0], [-3], [Number.NaN]])(
    'daysSilent=%p invents no time reference',
    (days) => {
      const { text } = followUpDraft(makePerson(), makeDeal(), days as number);
      expect(text).not.toContain('לפני');
      expect(text).not.toContain('אתמול');
      expect(text).toContain('שלחתי לך הודעה לגבי תפקיד Backend Engineer');
    }
  );
});

describe('followUpDraft — content and suggestionInput', () => {
  it('greets by first name, offers a polite opt-out, names the job', () => {
    const { text } = followUpDraft(makePerson(), makeDeal(), 4);
    expect(text.startsWith('היי דנה, זו שוב רויטל')).toBe(true);
    expect(text).toContain('Backend Engineer');
    expect(text).toContain('לגמרי בסדר');
  });

  it('files as draft_message with silence evidence on the person', () => {
    const draft = followUpDraft(makePerson(), makeDeal(), 7);
    const s = draft.suggestionInput;
    expect(s.agent).toBe('outreach_runner');
    expect(s.kind).toBe('draft_message');
    expect(s.body).toBe(draft.text);
    expect(s.title).toContain('פולו-אפ');
    expect(s.title).toContain('7 ימים ללא מענה');
    expect(s.evidence[0]).toMatchObject({ sourceType: 'person', sourceId: 'p-1' });
    expect(s.evidence[0].claim).toContain('7 ימים ללא מענה');
    expect(s.evidence[1]).toMatchObject({ sourceType: 'deal', sourceId: 'd-1' });
  });

  it('zero silence drops the day count from title and evidence', () => {
    const s = followUpDraft(makePerson(), makeDeal(), 0).suggestionInput;
    expect(s.title).not.toContain('ללא מענה');
    expect(s.evidence[0].claim).toBe('טרם התקבל מענה לפנייה האחרונה');
  });
});
