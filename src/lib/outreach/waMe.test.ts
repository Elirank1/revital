import { describe, expect, it } from 'vitest';
import {
  composeMailto,
  composeWaMeUrl,
  normalizePhone,
  sanitizeMessageText,
} from './waMe';

const LRM = '\u200E';
const RLM = '\u200F';
const RLO = '\u202E';
const LRE = '\u202A';
const PDF_ = '\u202C';
const LRI = '\u2066';
const PDI = '\u2069';

describe('normalizePhone — Israeli national formats', () => {
  it.each([
    ['0501234567', '972501234567'],
    ['050-123-4567', '972501234567'],
    ['050 123 4567', '972501234567'],
    ['052.123.4567', '972521234567'],
    ['(054) 123-4567', '972541234567'],
    ['058-1234567', '972581234567'],
    // landlines
    ['03-1234567', '97231234567'],
    ['02 6543210', '97226543210'],
    ['09-7654321', '97297654321'],
    // VoIP range
    ['077-1234567', '972771234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('accepts a bare 9-digit mobile missing its leading zero', () => {
    expect(normalizePhone('501234567')).toBe('972501234567');
  });
});

describe('normalizePhone — already-international formats', () => {
  it.each([
    ['+972501234567', '972501234567'],
    ['+972-50-123-4567', '972501234567'],
    ['+972 50 123 4567', '972501234567'],
    ['972501234567', '972501234567'],
    ['00972501234567', '972501234567'],
    // common stray national zero after country code
    ['+9720501234567', '972501234567'],
    ['9720501234567', '972501234567'],
    ['009720501234567', '972501234567'],
    // IL landline in international form
    ['+97231234567', '97231234567'],
    // non-IL international numbers pass through as digits
    ['+14155552671', '14155552671'],
    ['0014155552671', '14155552671'],
    ['+44 20 7946 0958', '442079460958'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe('normalizePhone — BiDi and separator noise', () => {
  it('strips LRM/RLM marks leaked by RTL UIs', () => {
    expect(normalizePhone(`${RLM}050-123-4567${LRM}`)).toBe('972501234567');
  });

  it('strips embedding and isolate controls', () => {
    expect(normalizePhone(`${LRE}+972 50 123 4567${PDF_}`)).toBe('972501234567');
    expect(normalizePhone(`${LRI}0501234567${PDI}`)).toBe('972501234567');
  });
});

describe('normalizePhone — malformed input', () => {
  it.each([
    [''],
    ['   '],
    ['abc'],
    ['phone'],
    ['05x-123-4567'],
    ['050-12345'], // too short national
    ['05012345678'], // too long national (10 after the 0)
    ['+972501'], // too short after country code
    ['+97250123456789'], // too long after country code
    ['12345'], // short, no recognizable shape
    ['1234567890123456'], // beyond E.164 length
    ['+'],
    ['00'],
    ['050-123-4567 ext 2'], // trailing letters
  ])('%j → null', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('sanitizeMessageText', () => {
  it('strips direction override/embedding/isolate controls', () => {
    expect(sanitizeMessageText(`שלום ${RLO}evil${PDF_} עולם`)).toBe('שלום evil עולם');
    expect(sanitizeMessageText(`${LRI}abc${PDI}`)).toBe('abc');
  });

  it('preserves plain LRM/RLM marks in message text', () => {
    expect(sanitizeMessageText(`מספר${LRM}42`)).toBe(`מספר${LRM}42`);
  });

  it('leaves plain Hebrew/English text untouched', () => {
    const text = 'היי דנה, ראיתי את הקו"ח שלך למשרת Frontend — נשמע מעולה!';
    expect(sanitizeMessageText(text)).toBe(text);
  });
});

describe('composeWaMeUrl', () => {
  it('composes the canonical wa.me href with encoded Hebrew text', () => {
    const message = 'שלום דנה, מדברת רויטל לגבי משרת React';
    expect(composeWaMeUrl('050-123-4567', message)).toBe(
      `https://wa.me/972501234567?text=${encodeURIComponent(message)}`
    );
  });

  it('omits ?text when there is no message', () => {
    expect(composeWaMeUrl('0501234567')).toBe('https://wa.me/972501234567');
    expect(composeWaMeUrl('0501234567', '')).toBe('https://wa.me/972501234567');
  });

  it('returns null for an unusable phone number', () => {
    expect(composeWaMeUrl('not-a-phone', 'שלום')).toBeNull();
    expect(composeWaMeUrl('', 'שלום')).toBeNull();
  });

  it('round-trips Hebrew + English + punctuation through decodeURIComponent', () => {
    const message = 'היי! משרת Full-Stack בת"א — שכר 40-45K ₪. מתאים? 😊\nנדבר מחר';
    const url = composeWaMeUrl('+972501234567', message)!;
    const encoded = url.split('?text=')[1];
    expect(decodeURIComponent(encoded)).toBe(message);
  });

  it('percent-encodes URL-breaking characters in the message', () => {
    const url = composeWaMeUrl('0501234567', 'a&b=c?d#e')!;
    const encoded = url.split('?text=')[1];
    expect(encoded).not.toMatch(/[&=?#]/);
    expect(decodeURIComponent(encoded)).toBe('a&b=c?d#e');
  });

  it('never emits direction-override controls into the href', () => {
    const url = composeWaMeUrl('0501234567', `שלום${RLO}gro.live${PDF_}`)!;
    expect(url).not.toMatch(/%E2%80%A[A-E]/i); // U+202A–U+202E encodings
    expect(decodeURIComponent(url.split('?text=')[1])).toBe('שלוםgro.live');
  });

  it('is a pure composer: href only, no scheme other than https://wa.me', () => {
    const url = composeWaMeUrl('0501234567', 'שלום')!;
    expect(url.startsWith('https://wa.me/')).toBe(true);
  });
});

describe('composeMailto', () => {
  it('composes subject and body, Hebrew-encoded and round-trippable', () => {
    const subject = 'מועמדת מצוינת למשרת DevOps';
    const body = 'שלום יעל,\nמצרפת קו"ח של מועמדת חזקה.\nרויטל';
    const href = composeMailto({ to: 'client@example.com', subject, body });
    expect(href).toBe(
      `mailto:client@example.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    );
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('subject')).toBe(subject);
    expect(params.get('body')).toBe(body);
  });

  it('keeps a readable @ in the address', () => {
    expect(composeMailto({ to: 'a@b.co.il' })).toBe('mailto:a@b.co.il');
  });

  it('supports addressless mailto:?subject&body per the charter', () => {
    const href = composeMailto({ subject: 'hi', body: 'there' });
    expect(href).toBe('mailto:?subject=hi&body=there');
  });

  it('handles body-only and empty input', () => {
    expect(composeMailto({ body: 'רק גוף' })).toBe(
      `mailto:?body=${encodeURIComponent('רק גוף')}`
    );
    expect(composeMailto({})).toBe('mailto:');
  });

  it('strips BiDi controls from subject and body', () => {
    const href = composeMailto({ subject: `re${RLO}fdp.exe` });
    expect(decodeURIComponent(href.replace('mailto:?subject=', ''))).toBe('refdp.exe');
  });
});

describe('G4 — no send path in composed output', () => {
  it('only ever returns strings; composing never navigates or fetches', () => {
    // These calls run in a bare node environment: if any composer touched
    // window/location/fetch-to-wa.me it would throw here.
    const wa = composeWaMeUrl('0501234567', 'שלום');
    const mail = composeMailto({ to: 'x@y.z', subject: 's', body: 'b' });
    expect(typeof wa).toBe('string');
    expect(typeof mail).toBe('string');
  });
});
