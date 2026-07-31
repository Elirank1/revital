import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  normalizePhone,
  normalizeEmail,
  findDuplicatePerson,
} from './dedupe';
import type { Person } from '../../types/pipeline';

const person = (
  id: string,
  name: string,
  extra: Partial<Person> = {},
): Person => ({
  id,
  v: 1,
  updatedAt: '2026-07-31T00:00:00.000Z',
  name,
  normalizedName: normalizeName(name),
  analysisIds: [],
  contactEvents: [],
  ...extra,
});

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('  Ron   Cohen. ')).toBe('ron cohen');
    expect(normalizeName('RON-COHEN')).toBe('ron cohen');
  });

  it('strips Hebrew niqqud and keeps Hebrew letters', () => {
    expect(normalizeName('רוֹן כֹּהֵן')).toBe(normalizeName('רון כהן'));
    expect(normalizeName('רון כהן')).toBe('רון כהן');
  });
});

describe('normalizePhone', () => {
  it('unifies Israeli formats to a canonical digit string', () => {
    expect(normalizePhone('+972-52-1234567')).toBe('521234567');
    expect(normalizePhone('052 1234567')).toBe('521234567');
    expect(normalizePhone('972521234567')).toBe('521234567');
    expect(normalizePhone('0521234567')).toBe('521234567');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail(' Ron@Example.COM ')).toBe('ron@example.com');
  });
});

describe('findDuplicatePerson (cross-mandate dedupe)', () => {
  const pool = [
    person('p1', 'רון כהן', { phone: '052-1234567', email: 'ron@ex.com' }),
    person('p2', 'Dana Levi', { email: 'dana@ex.com' }),
    person('p3', 'רון כהן'), // same name as p1, no contact info
  ];

  it('matches on normalized name + phone', () => {
    const m = findDuplicatePerson(pool, { name: 'רוֹן כהן', phone: '+972521234567' });
    expect(m).toEqual({ kind: 'exact', person: pool[0], matchedOn: 'name+contact' });
  });

  it('matches on phone alone (globally unique identifier)', () => {
    const m = findDuplicatePerson(pool, { name: 'Different Name', phone: '0521234567' });
    expect(m?.kind).toBe('exact');
    expect(m?.person.id).toBe('p1');
  });

  it('matches on email alone', () => {
    const m = findDuplicatePerson(pool, { name: 'Someone Else', email: 'DANA@ex.com' });
    expect(m?.kind).toBe('exact');
    expect(m?.person.id).toBe('p2');
  });

  it('name-only collision is flagged, never auto-merged', () => {
    const m = findDuplicatePerson(pool, { name: 'רון כהן', phone: '054-9999999' });
    expect(m?.kind).toBe('name_only');
  });

  it('returns null for a genuinely new person', () => {
    expect(findDuplicatePerson(pool, { name: 'Noa Bar', phone: '053-1111111' })).toBeNull();
  });

  it('ignores tombstoned persons', () => {
    const deadPool = [{ ...pool[0], deleted: true as const }];
    expect(
      findDuplicatePerson(deadPool, { name: 'רון כהן', phone: '0521234567' }),
    ).toBeNull();
  });
});
