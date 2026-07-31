/**
 * Lexicon tests — key coverage, t() semantics, byte-parity of the
 * ready-to-adopt agent keys, and Hebrew grammar helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  candidatesHe,
  daysAgoHe,
  daysCountHe,
  durationHe,
  he,
  t,
  toCandidatesHe,
  type HeKey,
} from './he';

const RLO = '\u202E';
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/;
const KEYS = Object.keys(he) as HeKey[];

// ------------------------------------------------------------
// Lexicon hygiene — every key, no exceptions
// ------------------------------------------------------------

describe('lexicon coverage', () => {
  it('every key has a non-empty, trimmed value', () => {
    for (const key of KEYS) {
      expect(he[key], key).not.toBe('');
      expect(he[key], key).toBe(he[key].trim());
    }
  });

  it('no template contains BiDi control characters or double spaces', () => {
    for (const key of KEYS) {
      expect(he[key], key).not.toMatch(BIDI_CONTROLS);
      expect(he[key], key).not.toMatch(/ {2}/);
    }
  });

  it('placeholder tokens are well-formed {word} — no stray braces', () => {
    for (const key of KEYS) {
      const stripped = he[key].replace(/\{\w+\}/g, '');
      expect(stripped, key).not.toMatch(/[{}]/);
    }
  });

  it('no AI-flavored stiffness in any value', () => {
    // Words a human recruiter never writes to candidates/clients.
    const banned = ['אנא ', 'משתמש יקר', 'לחץ כאן', 'בכבוד רב', 'לידיעתך'];
    for (const key of KEYS) {
      for (const phrase of banned) {
        expect(he[key], `${key} contains "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it('covers every expected namespace', () => {
    const namespaces = new Set(KEYS.map((k) => k.split('.')[0]));
    for (const ns of ['agent', 'draft', 'evidence', 'sla', 'pitboss', 'report', 'bench', 'digest', 'chrome']) {
      expect([...namespaces], `missing namespace ${ns}`).toContain(ns);
    }
  });

  it('carries the Wave-3 morning-digest contract strings', () => {
    expect(t('digest.title')).toBe('מה מחכה לך הבוקר');
    expect(he['digest.cta']).not.toBe('');
    expect(he['digest.section.overdueFeedback']).not.toBe('');
  });
});

// ------------------------------------------------------------
// t() semantics
// ------------------------------------------------------------

describe('t()', () => {
  it('returns the template verbatim without params', () => {
    expect(t('report.section.funnel')).toBe('תמונת מצב');
  });

  it('interpolates string and number params', () => {
    expect(t('draft.opener.title', { name: 'דנה כהן', jobTitle: 'Backend Engineer' })).toBe(
      'טיוטת פנייה ראשונה: דנה כהן — Backend Engineer'
    );
    expect(t('evidence.analysisScore', { score: 82, verdict: 'Strong Fit' })).toBe(
      'ניתוח התאמה קיים — ציון 82 (Strong Fit)'
    );
  });

  it('leaves an unbound token verbatim — fail-visible, never silently blank', () => {
    expect(t('draft.opener.title', { name: 'דנה' })).toBe('טיוטת פנייה ראשונה: דנה — {jobTitle}');
  });

  it('strips BiDi controls from string params', () => {
    const out = t('draft.opener.greeting', { firstName: `דנה${RLO}` });
    expect(out).toBe('היי דנה,');
    expect(out).not.toMatch(BIDI_CONTROLS);
  });

  it('does not recurse: a param containing a token pattern stays literal', () => {
    expect(t('draft.opener.greeting', { firstName: '{jobTitle}' })).toBe('היי {jobTitle},');
  });
});

// ------------------------------------------------------------
// Ready-to-adopt keys — byte parity with what agent modules emit TODAY
// ------------------------------------------------------------

describe('agents-engine adoption parity', () => {
  it('sla.evidence.lastContact renders the exact sla.ts string', () => {
    expect(
      t('sla.evidence.lastContact', { ts: '2026-07-28T10:00:00.000Z', days: '3.5', threshold: 3 })
    ).toBe('פנייה אחרונה: 2026-07-28T10:00:00.000Z — 3.5 ימים ללא מענה (סף: 3 ימים)');
  });

  it('pitboss title/body/reasons render the exact pitboss.ts strings', () => {
    expect(t('pitboss.title', { jobTitle: 'Backend Engineer', stage: 'Outreach' })).toBe(
      'לטיפול: Backend Engineer (Outreach)'
    );
    expect(
      t('pitboss.body.header', { jobTitle: 'Backend Engineer', stage: 'Outreach' })
    ).toBe('ה-Pit Boss סימן את העסקה "Backend Engineer" (שלב: Outreach) כדורשת טיפול:');
    expect(t('pitboss.body.footer')).toBe('ההצעה אינה משנה את מצב הכרטיס — ההחלטה אצלך.');
    expect(
      t('pitboss.reason.agingPastMedian', { days: '12.0', stage: 'Submitted', median: '6.0' })
    ).toBe('12.0 ימים בשלב Submitted — מעל חציון השלב (6.0 ימים)');
    expect(t('pitboss.body.nextAction', { action: t('pitboss.action.followupDue') })).toBe(
      'פעולה מומלצת: לשלוח פולו-אפ למועמד/ת.'
    );
  });
});

// ------------------------------------------------------------
// Hebrew grammar helpers
// ------------------------------------------------------------

describe('grammar helpers', () => {
  it('daysAgoHe follows Hebrew numeral grammar', () => {
    expect(daysAgoHe(0)).toBeNull();
    expect(daysAgoHe(-3)).toBeNull();
    expect(daysAgoHe(Number.NaN)).toBeNull();
    expect(daysAgoHe(1)).toBe('אתמול');
    expect(daysAgoHe(2)).toBe('לפני יומיים');
    expect(daysAgoHe(7)).toBe('לפני 7 ימים');
    expect(daysAgoHe(14)).toBe('לפני 14 יום');
  });

  it('durationHe: יום אחד / יומיים / N ימים / N יום', () => {
    expect(durationHe(1)).toBe('יום אחד');
    expect(durationHe(2)).toBe('יומיים');
    expect(durationHe(9)).toBe('9 ימים');
    expect(durationHe(30)).toBe('30 יום');
    expect(durationHe(0)).toBe('יום אחד'); // clamped floor
  });

  it('daysCountHe: bare count phrase with the 11+ switch', () => {
    expect(daysCountHe(1)).toBe('יום אחד');
    expect(daysCountHe(2)).toBe('יומיים');
    expect(daysCountHe(5)).toBe('5 ימים');
    expect(daysCountHe(12)).toBe('12 יום');
  });

  it('candidatesHe / toCandidatesHe: singular, dual, plural', () => {
    expect(candidatesHe(1)).toBe('מועמד אחד');
    expect(candidatesHe(2)).toBe('שני מועמדים');
    expect(candidatesHe(5)).toBe('5 מועמדים');
    expect(toCandidatesHe(1)).toBe('למועמד אחד');
    expect(toCandidatesHe(2)).toBe('לשני מועמדים');
    expect(toCandidatesHe(5)).toBe('ל-5 מועמדים');
  });
});
