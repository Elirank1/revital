import { describe, expect, it } from 'vitest';
import type { EvaluationPillar, JobDescription } from '../types';
import { booleanStrings } from './booleanStrings';

const RLO = '\u202E';
const PDF_ = '\u202C';

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

function pillar(
  name: string,
  weight: EvaluationPillar['weight'],
  keywords: string[]
): EvaluationPillar {
  return { name, description: '', weight, keywords };
}

function jd(overrides: Partial<JobDescription> = {}): JobDescription {
  return {
    id: 'job-1',
    title: 'Senior Backend Engineer',
    rawText: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    pillars: [
      pillar('Backend', 'CRITICAL', ['Node.js', 'TypeScript', 'Python']),
      pillar('Cloud', 'HIGH', ['AWS', 'Google Cloud', 'kubernetes', 'aws']),
      pillar('Nice to have', 'MEDIUM', ['GraphQL', 'gRPC']),
      pillar('Fluff', 'LOW', ['team player']),
      pillar('ניהול', 'CRITICAL', ['פייתון', 'ניהול צוות']),
    ],
    ...overrides,
  };
}

const byId = (queries: ReturnType<typeof booleanStrings>) =>
  Object.fromEntries(queries.map((q) => [q.id, q.query]));

// ------------------------------------------------------------
// Query composition
// ------------------------------------------------------------

describe('booleanStrings — composition', () => {
  it('emits Hebrew and English variants with stable ids and order', () => {
    const queries = booleanStrings(jd());
    expect(queries.map((q) => q.id)).toEqual([
      'core-he',
      'linkedin-he',
      'core-en',
      'linkedin-en',
      'broad-en',
    ]);
  });

  it('core query: quoted title AND one OR-group per CRITICAL/HIGH pillar', () => {
    const q = byId(booleanStrings(jd()));
    expect(q['core-en']).toBe(
      '"Senior Backend Engineer" AND ("Node.js" OR TypeScript OR Python) AND (AWS OR "Google Cloud" OR kubernetes)'
    );
    expect(q['core-he']).toBe('"Senior Backend Engineer" AND (פייתון OR "ניהול צוות")');
  });

  it('linkedin variant is the core query behind site:linkedin.com/in', () => {
    const q = byId(booleanStrings(jd()));
    expect(q['linkedin-en']).toBe(`site:linkedin.com/in ${q['core-en']}`);
    expect(q['linkedin-he']).toBe(`site:linkedin.com/in ${q['core-he']}`);
  });

  it('broad query widens to one OR-group over CRITICAL+HIGH+MEDIUM keywords', () => {
    const q = byId(booleanStrings(jd()));
    expect(q['broad-en']).toBe(
      '"Senior Backend Engineer" AND ("Node.js" OR TypeScript OR Python OR AWS OR "Google Cloud" OR kubernetes OR GraphQL OR gRPC)'
    );
  });

  it('a broad query identical to core is not emitted twice (Hebrew here)', () => {
    const ids = booleanStrings(jd()).map((q) => q.id);
    expect(ids).not.toContain('broad-he');
  });

  it('LOW-weight keywords never appear anywhere', () => {
    for (const { query } of booleanStrings(jd())) {
      expect(query).not.toContain('team player');
    }
  });

  it('deduplicates keywords case-insensitively (aws listed once)', () => {
    const q = byId(booleanStrings(jd()));
    expect(q['core-en'].match(/aws/gi)).toHaveLength(1);
    expect(q['broad-en'].match(/aws/gi)).toHaveLength(1);
  });

  it('quotes multi-word phrases and tokens with non-alphanumeric chars only', () => {
    const q = byId(booleanStrings(jd()));
    expect(q['core-en']).toContain('"Node.js"'); // dot
    expect(q['core-en']).toContain('"Google Cloud"'); // space
    expect(q['core-en']).toContain(' TypeScript '); // plain word, unquoted
    expect(q['core-he']).toContain('"ניהול צוות"'); // Hebrew phrase
    expect(q['core-he']).toContain('(פייתון OR'); // plain Hebrew word, unquoted
  });

  it('is deterministic — same JD yields deep-equal output', () => {
    const a = booleanStrings(jd());
    const b = booleanStrings(jd());
    expect(b).toEqual(a);
  });

  it('labels are Hebrew and language-tagged', () => {
    const queries = booleanStrings(jd());
    const core = queries.find((q) => q.id === 'core-he');
    const linkedin = queries.find((q) => q.id === 'linkedin-en');
    expect(core?.label).toBe('חיפוש ממוקד — עברית');
    expect(core?.lang).toBe('he');
    expect(linkedin?.label).toBe('LinkedIn X-Ray — אנגלית');
    expect(linkedin?.lang).toBe('en');
  });
});

// ------------------------------------------------------------
// Edge cases and hygiene
// ------------------------------------------------------------

describe('booleanStrings — edges', () => {
  it('no pillars → title-only core + linkedin in the title script', () => {
    const q = booleanStrings(jd({ pillars: [] }));
    expect(q.map((x) => x.id)).toEqual(['core-en', 'linkedin-en']);
    expect(q[0].query).toBe('"Senior Backend Engineer"');
    expect(q[1].query).toBe('site:linkedin.com/in "Senior Backend Engineer"');
  });

  it('Hebrew title → title-only fallback tags as Hebrew', () => {
    const q = booleanStrings(jd({ title: 'מנהל/ת מוצר', pillars: [] }));
    expect(q.map((x) => x.id)).toEqual(['core-he', 'linkedin-he']);
    expect(q[0].query).toBe('"מנהל/ת מוצר"');
  });

  it('MEDIUM-only language still gets a usable broad + linkedin pair', () => {
    const queries = booleanStrings(
      jd({ pillars: [pillar('בדיקות', 'MEDIUM', ['בדיקות אוטומציה'])] })
    );
    expect(queries.map((q) => q.id)).toEqual(['broad-he', 'linkedin-he']);
    expect(queries[0].query).toBe('"Senior Backend Engineer" AND "בדיקות אוטומציה"');
    expect(queries[1].query).toBe(`site:linkedin.com/in ${queries[0].query}`);
  });

  it('strips embedded quotes and BiDi controls from keywords', () => {
    const queries = booleanStrings(
      jd({
        pillars: [pillar('Hostile', 'CRITICAL', ['"React"', `${RLO}evil${PDF_} keyword`])],
      })
    );
    for (const { query } of queries) {
      expect(query).not.toContain('""');
      expect(query.includes(RLO)).toBe(false);
      expect(query.includes(PDF_)).toBe(false);
    }
    const core = queries.find((q) => q.id === 'core-en');
    expect(core?.query).toContain('React');
    expect(core?.query).toContain('"evil keyword"');
  });

  it('caps an OR-group at 8 keywords, in pillar order', () => {
    const keywords = Array.from({ length: 10 }, (_, i) => `Skill${i + 1}`);
    const q = byId(booleanStrings(jd({ pillars: [pillar('Big', 'CRITICAL', keywords)] })));
    expect(q['core-en']).toContain('Skill8');
    expect(q['core-en']).not.toContain('Skill9');
  });

  it('caps the broad OR-group at 12 keywords across pillars', () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
    const q = byId(
      booleanStrings(
        jd({
          pillars: [
            pillar('A', 'CRITICAL', many('Alpha', 8)),
            pillar('B', 'HIGH', many('Beta', 8)),
          ],
        })
      )
    );
    expect(q['broad-en']).toContain('Beta4');
    expect(q['broad-en']).not.toContain('Beta5');
  });

  it('empty/whitespace keywords are dropped; a fully empty JD yields nothing usable', () => {
    const queries = booleanStrings(
      jd({ title: '  ', pillars: [pillar('Empty', 'CRITICAL', ['  ', ''])] })
    );
    expect(queries).toEqual([]);
  });
});
