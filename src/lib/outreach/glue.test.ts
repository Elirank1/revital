import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Deal, Person, Suggestion } from '../../types/pipeline';
import { openerDraft, type SuggestionInput } from './drafts';
import { composeAndLog, hashMessage, type ContactLogger } from './contactLog';
import {
  draftToSuggestion,
  suggestionMessageHash,
  suggestionToComposeArgs,
  suggestionToWaHref,
} from './glue';

const TS = '2026-07-30T10:00:00.000Z';

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'p-1',
    v: 0,
    updatedAt: TS,
    name: 'דנה כהן',
    normalizedName: 'דנה כהן',
    phone: '050-123-4567',
    analysisIds: [],
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
    stage: 'Outreach',
    stageEnteredAt: TS,
    createdAt: TS,
    ...overrides,
  };
}

/** Simulate what the store does on addSuggestion + accept (envelope only). */
function asAcceptedSuggestion(input: SuggestionInput): Suggestion {
  return {
    ...input,
    id: 's-1',
    v: 0,
    updatedAt: TS,
    status: 'accepted',
    createdAt: TS,
  };
}

function makeRecordingLogger() {
  const calls: Array<{ personId: string; channel: string; messageHash: string; ts: number }> = [];
  const logger: ContactLogger = {
    logContact: (personId, channel, messageHash, ts) => {
      calls.push({ personId, channel, messageHash, ts });
    },
  };
  return { logger, calls };
}

describe('draftToSuggestion', () => {
  it('returns the store-ready input with body pinned to the draft text', () => {
    const draft = openerDraft(makePerson(), makeDeal());
    const input = draftToSuggestion(draft);
    expect(input).toEqual(draft.suggestionInput);
    expect(input.body).toBe(draft.text);
  });

  it('returns a defensive copy — mutating it never leaks back into the draft', () => {
    const draft = openerDraft(makePerson(), makeDeal());
    const input = draftToSuggestion(draft);
    expect(input).not.toBe(draft.suggestionInput);
    expect(input.evidence).not.toBe(draft.suggestionInput.evidence);

    input.title = 'tampered';
    input.evidence.push({ claim: 'x', sourceType: 'x', sourceId: 'x' });
    input.evidence[0].claim = 'tampered';

    expect(draft.suggestionInput.title).not.toBe('tampered');
    expect(draft.suggestionInput.evidence).toHaveLength(1);
    expect(draft.suggestionInput.evidence[0].claim).not.toBe('tampered');
  });
});

describe('hash stability through the glue', () => {
  it('draft → suggestion → click-time composeAndLog all agree on href and hash', () => {
    const person = makePerson();
    const deal = makeDeal();
    const draft = openerDraft(person, deal);
    const suggestion = asAcceptedSuggestion(draftToSuggestion(draft));

    // render path: the <a href> kanban-ui shows for the accepted draft
    const renderedHref = suggestionToWaHref(suggestion, person);
    expect(renderedHref).not.toBeNull();

    // click path: composeAndLog with args built by the glue
    const args = suggestionToComposeArgs(suggestion, person);
    expect(args).not.toBeNull();
    const { logger, calls } = makeRecordingLogger();
    const composed = composeAndLog(args as NonNullable<typeof args>, logger, () => 1234);
    expect(composed).not.toBeNull();

    // one message, one hash, one href — no drift anywhere in the chain
    expect(composed?.href).toBe(renderedHref);
    expect(composed?.messageHash).toBe(suggestionMessageHash(suggestion));
    expect(composed?.messageHash).toBe(hashMessage(draft.text));
    expect(calls).toEqual([
      { personId: 'p-1', channel: 'whatsapp', messageHash: hashMessage(draft.text), ts: 1234 },
    ]);
  });

  it('href carries the normalized E.164 number and round-trips the Hebrew body', () => {
    const person = makePerson();
    const suggestion = asAcceptedSuggestion(draftToSuggestion(openerDraft(person, makeDeal())));
    const href = suggestionToWaHref(suggestion, person) as string;
    expect(href.startsWith('https://wa.me/972501234567?text=')).toBe(true);
    expect(decodeURIComponent(href.split('?text=')[1])).toBe(suggestion.body);
  });
});

describe('suggestionToWaHref — null on anything unsendable', () => {
  const person = makePerson();
  const base = asAcceptedSuggestion(draftToSuggestion(openerDraft(person, makeDeal())));

  it('non-draft suggestion kinds', () => {
    expect(suggestionToWaHref({ ...base, kind: 'flag' }, person)).toBeNull();
    expect(suggestionToWaHref({ ...base, kind: 'report' }, person)).toBeNull();
  });

  it('empty body', () => {
    expect(suggestionToWaHref({ ...base, body: '' }, person)).toBeNull();
  });

  it('missing or unusable phone', () => {
    expect(suggestionToWaHref(base, makePerson({ phone: undefined }))).toBeNull();
    expect(suggestionToWaHref(base, makePerson({ phone: '' }))).toBeNull();
    expect(suggestionToWaHref(base, makePerson({ phone: 'not-a-phone' }))).toBeNull();
  });

  it('suggestionToComposeArgs mirrors every null case', () => {
    expect(suggestionToComposeArgs({ ...base, kind: 'flag' }, person)).toBeNull();
    expect(suggestionToComposeArgs({ ...base, body: '' }, person)).toBeNull();
    expect(suggestionToComposeArgs(base, makePerson({ phone: undefined }))).toBeNull();
    expect(suggestionToComposeArgs(base, makePerson({ phone: '05' }))).toBeNull();
  });
});

describe('suggestionToComposeArgs — person attribution', () => {
  it('prefers the suggestion personId, falls back to the person record', () => {
    const person = makePerson({ id: 'p-render' });
    const base = asAcceptedSuggestion(draftToSuggestion(openerDraft(makePerson(), makeDeal())));

    expect(suggestionToComposeArgs(base, person)?.personId).toBe('p-1');
    expect(
      suggestionToComposeArgs({ ...base, personId: undefined }, person)?.personId
    ).toBe('p-render');
  });
});

describe('G4 — outreach source contains no send or navigation path', () => {
  it('greps its own module files clean', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
    );
    expect(sources.length).toBeGreaterThanOrEqual(4); // waMe, contactLog, drafts, glue, index

    // Doc comments legitimately SAY "no window.open" — strip comments,
    // then require the CODE to be free of any navigation/send token.
    const stripComments = (code: string): string =>
      code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

    const forbidden =
      /window\.open\s*\(|location\.(assign|replace)\s*\(|location\.href\s*=|[^.\w]location\s*=|\bfetch\s*\(|XMLHttpRequest|sendBeacon|document\.createElement\s*\(\s*['"`]a/;
    for (const file of sources) {
      const code = stripComments(readFileSync(join(dir, file), 'utf-8'));
      expect(code, `${file} must stay navigation-free (G4)`).not.toMatch(forbidden);
    }
  });

  it('asserts hrefs as inert strings in bare node — no window exists here', () => {
    expect(typeof globalThis.window).toBe('undefined');
  });
});
