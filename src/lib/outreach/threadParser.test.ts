/**
 * threadParser tests — real-shaped WhatsApp export fixtures.
 *
 * G4 discipline: all names/numbers are synthetic; nothing here navigates
 * or composes a send path — the parser is pure data → data.
 */
import { describe, expect, it } from 'vitest';
import { hashMessage } from './contactLog';
import {
  DEFAULT_HER,
  buildThreadApplyPlan,
  parseThreadToPlan,
  parseWhatsAppThread,
  type HerIdentity,
  type ThreadApplyCall,
} from './threadParser';

const HER: HerIdentity = { name: 'רויטל קרן', aliases: ['רויטל'] };

const RLM = '\u200F';
const LRM = '\u200E';
const RLO = '\u202E';
const NNBSP = '\u202F';
const BIDI_ANY = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/;

// ------------------------------------------------------------
// Format coverage
// ------------------------------------------------------------

describe('parseWhatsAppThread — iOS export format', () => {
  const paste = [
    `[31.7.2026, 21:45:12] רויטל קרן: היי דנה, ראית את המשרה ששלחתי?`,
    `[31.7.2026, 21:47:03] דנה כהן: היי רויטל!`,
    `[31.7.2026, 21:47:30] דנה כהן: כן, נשמע מעניין`,
  ].join('\n');

  it('parses messages with who/ts/text and reports format ios', () => {
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.format).toBe('ios');
    expect(thread.skipped).toEqual([]);
    expect(thread.messages).toHaveLength(3);
    expect(thread.messages[0]).toMatchObject({
      who: 'her',
      senderName: 'רויטל קרן',
      ts: '2026-07-31T21:45:12.000Z',
      text: 'היי דנה, ראית את המשרה ששלחתי?',
      media: false,
      line: 1,
    });
    expect(thread.messages[1].who).toBe('candidate');
    expect(thread.messages[2].ts).toBe('2026-07-31T21:47:30.000Z');
    expect(thread.herMatched).toBe(true);
    expect(thread.senders).toEqual(['דנה כהן']);
  });
});

describe('parseWhatsAppThread — Android export format', () => {
  const paste = [
    `31.7.2026, 21:45 - רויטל קרן: היי אבי, זו רויטל`,
    `31.7.2026, 21:50 - אבי לוי: אהלן`,
  ].join('\n');

  it('parses the dash-separated header without seconds', () => {
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.format).toBe('android');
    expect(thread.skipped).toEqual([]);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].ts).toBe('2026-07-31T21:45:00.000Z');
    expect(thread.messages[1]).toMatchObject({ who: 'candidate', senderName: 'אבי לוי' });
  });

  it('flags mixed when both formats appear in one paste', () => {
    const mixed = `[30.7.2026, 10:00:00] רויטל קרן: בוקר טוב\n31.7.2026, 11:00 - דנה כהן: בוקר אור`;
    expect(parseWhatsAppThread(mixed, HER).format).toBe('mixed');
  });

  it('reports none for an empty or headerless paste', () => {
    expect(parseWhatsAppThread('', HER).format).toBe('none');
    expect(parseWhatsAppThread('סתם טקסט בלי כלום', HER).format).toBe('none');
  });
});

describe('parseWhatsAppThread — timestamp variants', () => {
  it('accepts slash dates, 2-digit years and AM/PM with narrow space', () => {
    const paste = `[7/31/26, 9:45:12${NNBSP}PM] Dana Cohen: hi there`;
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.skipped).toEqual([]);
    // US month-first auto-detected (month 31 impossible) + PM → 21:45.
    expect(thread.messages[0].ts).toBe('2026-07-31T21:45:12.000Z');
  });

  it('parses 12 AM as midnight', () => {
    const thread = parseWhatsAppThread(`[1.1.2026, 12:05 AM] דנה כהן: לילה`, HER);
    expect(thread.messages[0].ts).toBe('2026-01-01T00:05:00.000Z');
  });

  it('keeps day-first reading when both parts are plausible', () => {
    const thread = parseWhatsAppThread(`3.7.2026, 08:00 - דנה כהן: בוקר`, HER);
    expect(thread.messages[0].ts).toBe('2026-07-03T08:00:00.000Z');
  });

  it('strips BiDi marks inside and around timestamps', () => {
    const paste = `${RLM}[${LRM}31.7.2026${RLM}, 21:45:12] ${RLM}רויטל קרן: הודעה`;
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.skipped).toEqual([]);
    expect(thread.messages[0]).toMatchObject({
      who: 'her',
      ts: '2026-07-31T21:45:12.000Z',
      text: 'הודעה',
    });
  });

  it('skips impossible dates/times as bad_timestamp, never throws', () => {
    const paste = [
      `[31.13.2026, 10:00:00] דנה כהן: חודש 13`,
      `[30.2.2026, 10:00:00] דנה כהן: פברואר קצר`,
      `[15.7.2026, 25:00:00] דנה כהן: שעה 25`,
      `[15.7.2026, 10:99:00] דנה כהן: דקה 99`,
      `[15.7.2026, 10:30:00] דנה כהן: תקין`,
    ].join('\n');
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].text).toBe('תקין');
    expect(thread.skipped).toHaveLength(4);
    expect(thread.skipped.every((s) => s.reason === 'bad_timestamp')).toBe(true);
    expect(thread.skipped.map((s) => s.line)).toEqual([1, 2, 3, 4]);
  });
});

// ------------------------------------------------------------
// Content: multiline, emoji, BiDi, media, colons
// ------------------------------------------------------------

describe('parseWhatsAppThread — message content', () => {
  it('round-trips multiline + emoji, strips BiDi controls from text', () => {
    const paste = [
      `[31.7.2026, 21:45:12] דנה כהן: שלום רויטל 🙂🎉`,
      `שורה שנייה עם English בפנים`,
      ``,
      `ושורה רביעית אחרי שורה ריקה ${RLO}מסוכנת`,
      `[31.7.2026, 21:50:00] רויטל קרן: קיבלתי 👍`,
    ].join('\n');

    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.skipped).toEqual([]);
    expect(thread.messages).toHaveLength(2);

    const [candidate, her] = thread.messages;
    expect(candidate.text).toBe(
      'שלום רויטל 🙂🎉\nשורה שנייה עם English בפנים\n\nושורה רביעית אחרי שורה ריקה מסוכנת'
    );
    expect(candidate.text).not.toMatch(BIDI_ANY);
    expect(her.text).toBe('קיבלתי 👍');
  });

  it('splits sender on the FIRST colon-space; later colons stay in the text', () => {
    const thread = parseWhatsAppThread(
      `31.7.2026, 21:47 - דנה כהן: הערה: השעה 18:30 מתאימה לי`,
      HER
    );
    expect(thread.messages[0].senderName).toBe('דנה כהן');
    expect(thread.messages[0].text).toBe('הערה: השעה 18:30 מתאימה לי');
  });

  it('marks media-omitted placeholders in both locales', () => {
    const paste = [
      `31.7.2026, 21:45 - דנה כהן: <המדיה לא נכללה>`,
      `[31.7.2026, 21:46:00] דנה כהן: ${LRM}image omitted`,
      `31.7.2026, 21:47 - דנה כהן: סתם הודעה עם טקסט`,
    ].join('\n');
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.messages.map((m) => m.media)).toEqual([true, true, false]);
  });

  it('handles \\r\\n pastes and trailing whitespace', () => {
    const thread = parseWhatsAppThread(
      `[31.7.2026, 21:45:12] דנה כהן: שלום  \r\n[31.7.2026, 21:46:00] רויטל קרן: היי\r\n`,
      HER
    );
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].text).toBe('שלום');
    expect(thread.messages[1].text).toBe('היי');
  });
});

// ------------------------------------------------------------
// System / malformed lines
// ------------------------------------------------------------

describe('parseWhatsAppThread — skipped report', () => {
  it('skips WhatsApp system lines (no sender) with reason system', () => {
    const paste = [
      `31.7.2026, 21:40 - ההודעות והשיחות מוצפנות מקצה לקצה.`,
      `[31.7.2026, 21:41:00] הקבוצה נוצרה`,
      `31.7.2026, 21:45 - רויטל קרן: היי דנה`,
    ].join('\n');
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.messages).toHaveLength(1);
    expect(thread.skipped).toEqual([
      { line: 1, raw: paste.split('\n')[0], reason: 'system' },
      { line: 2, raw: paste.split('\n')[1], reason: 'system' },
    ]);
  });

  it('reports non-blank text before the first header as orphan', () => {
    const paste = `שורה תלושה\n\n[31.7.2026, 21:45:12] דנה כהן: שלום`;
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.messages).toHaveLength(1);
    expect(thread.skipped).toEqual([{ line: 1, raw: 'שורה תלושה', reason: 'orphan' }]);
  });

  it('never throws on garbage and is deterministic', () => {
    const garbage = `]][[31.7:: - :\n${RLO}${RLO}\n[99.99.99, 99:99] :\n- - -`;
    const a = parseWhatsAppThread(garbage, HER);
    const b = parseWhatsAppThread(garbage, HER);
    expect(a).toEqual(b);
    expect(a.messages).toEqual([]);
  });
});

// ------------------------------------------------------------
// Her identity matching
// ------------------------------------------------------------

describe('parseWhatsAppThread — her-alias matching', () => {
  it('matches name and aliases exactly after normalization', () => {
    const paste = [
      `31.7.2026, 21:45 - רויטל: הודעה מהכינוי`,
      `31.7.2026, 21:46 - רויטל קרן: הודעה מהשם המלא`,
      `31.7.2026, 21:47 - רויטל לוי: אני מועמדת אחרת`,
    ].join('\n');
    const thread = parseWhatsAppThread(paste, HER);
    expect(thread.messages.map((m) => m.who)).toEqual(['her', 'her', 'candidate']);
    expect(thread.senders).toEqual(['רויטל לוי']);
  });

  it('normalizes ~ prefix, BiDi marks, case and extra spaces in sender names', () => {
    const her: HerIdentity = { name: 'Revital Keren' };
    const paste = [
      `31.7.2026, 21:45 - ~ revital${NNBSP} keren: from a group push-name`,
      `31.7.2026, 21:46 - ${RLM}REVITAL  KEREN${LRM}: shouty display name`,
      `31.7.2026, 21:47 - Dana Cohen: candidate here`,
    ].join('\n');
    const thread = parseWhatsAppThread(paste, her);
    expect(thread.messages.map((m) => m.who)).toEqual(['her', 'her', 'candidate']);
  });

  it('classifies everyone as candidate when her identity never appears', () => {
    const thread = parseWhatsAppThread(`31.7.2026, 21:45 - דנה כהן: שלום`, HER);
    expect(thread.herMatched).toBe(false);
    expect(thread.messages[0].who).toBe('candidate');
  });

  it('DEFAULT_HER matches the product user and common aliases', () => {
    const paste = `31.7.2026, 21:45 - רויטל: היי\n31.7.2026, 21:46 - Revital: hey`;
    const thread = parseWhatsAppThread(paste, DEFAULT_HER);
    expect(thread.messages.map((m) => m.who)).toEqual(['her', 'her']);
  });
});

// ------------------------------------------------------------
// Apply plan
// ------------------------------------------------------------

/** Minimal store double: applies calls in order, tracks the event log. */
function applyCalls(calls: ThreadApplyCall[]) {
  const events: Array<{ kind: string; ts: string; messageHash?: string }> = [];
  for (const call of calls) {
    if (call.action === 'logContact') {
      events.push({ kind: 'contacted', ts: call.ts, messageHash: call.messageHash });
    } else {
      events.push({ kind: call.state, ts: call.ts });
    }
  }
  return events;
}

describe('buildThreadApplyPlan', () => {
  const paste = [
    `[30.7.2026, 10:00:00] רויטל קרן: היי דנה, יש לי משרה בשבילך`,
    `[30.7.2026, 10:01:00] רויטל קרן: מצרפת פרטים`,
    `[30.7.2026, 15:00:00] דנה כהן: נשמע מעניין`,
    `[30.7.2026, 15:01:00] דנה כהן: מתי נוח לדבר?`,
    `[31.7.2026, 09:00:00] רויטל קרן: מחר ב-10?`,
    `[31.7.2026, 09:30:00] דנה כהן: סגור`,
  ].join('\n');

  it('emits one logContact per her message, hash-faithful to the parsed text', () => {
    const { thread, plan } = parseThreadToPlan(paste, HER, 'p-1');
    const contacts = plan.calls.filter((c) => c.action === 'logContact');
    const herMessages = thread.messages.filter((m) => m.who === 'her');
    expect(contacts).toHaveLength(3);
    contacts.forEach((c, i) => {
      expect(c).toMatchObject({
        personId: 'p-1',
        channel: 'whatsapp',
        ts: herMessages[i].ts,
        messageHash: hashMessage(herMessages[i].text),
        dedupeKey: `${herMessages[i].ts}|${hashMessage(herMessages[i].text)}`,
      });
    });
    expect(plan.counts).toEqual({ her: 3, candidate: 3 });
  });

  it('collapses candidate runs to one replied call at the run tail', () => {
    const { plan } = parseThreadToPlan(paste, HER, 'p-1');
    const replies = plan.calls.filter((c) => c.action === 'setReplyState');
    expect(replies).toEqual([
      { action: 'setReplyState', personId: 'p-1', state: 'replied', ts: '2026-07-30T15:01:00.000Z' },
      { action: 'setReplyState', personId: 'p-1', state: 'replied', ts: '2026-07-31T09:30:00.000Z' },
    ]);
  });

  it('latest state wins: candidate-last thread ends replied', () => {
    const { plan } = parseThreadToPlan(paste, HER, 'p-1');
    expect(plan.latest).toEqual({ state: 'replied', ts: '2026-07-31T09:30:00.000Z' });
    const events = applyCalls(plan.calls);
    expect(events[events.length - 1].kind).toBe('replied');
    expect(events[events.length - 1].ts).toBe(plan.latest.ts);
  });

  it('latest state wins: her-last thread ends awaiting_reply with no reply call after it', () => {
    const herLast = `${paste}\n[31.7.2026, 10:00:00] רויטל קרן: מעולה, נדבר`;
    const { plan } = parseThreadToPlan(herLast, HER, 'p-1');
    expect(plan.latest).toEqual({ state: 'awaiting_reply', ts: '2026-07-31T10:00:00.000Z' });
    const events = applyCalls(plan.calls);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.kind).toBe('contacted');
    expect(lastEvent.ts).toBe('2026-07-31T10:00:00.000Z');
    // No 'no_reply' is ever planned — silence-aging is the SLA agent's call.
    expect(plan.calls.some((c) => c.action === 'setReplyState' && c.state !== 'replied')).toBe(
      false
    );
  });

  it('orders calls chronologically even when the paste is out of order', () => {
    const shuffled = [
      `[31.7.2026, 09:30:00] דנה כהן: סגור`,
      `[30.7.2026, 10:00:00] רויטל קרן: היי דנה`,
      `[30.7.2026, 15:00:00] דנה כהן: נשמע מעניין`,
    ].join('\n');
    const { plan } = parseThreadToPlan(shuffled, HER, 'p-1');
    const ts = plan.calls.map((c) => c.ts);
    expect(ts).toEqual([...ts].sort());
    expect(plan.latest.state).toBe('replied');
    expect(plan.latest.ts).toBe('2026-07-31T09:30:00.000Z');
  });

  it('handles empty and her-only threads', () => {
    expect(buildThreadApplyPlan(parseWhatsAppThread('', HER), 'p-1')).toEqual({
      personId: 'p-1',
      calls: [],
      latest: { state: 'none', ts: null },
      counts: { her: 0, candidate: 0 },
    });

    const herOnly = parseThreadToPlan(`31.7.2026, 21:45 - רויטל קרן: היי`, HER, 'p-9');
    expect(herOnly.plan.latest.state).toBe('awaiting_reply');
    expect(herOnly.plan.calls).toHaveLength(1);
    expect(herOnly.plan.calls[0].action).toBe('logContact');
  });

  it('a candidate media message still counts as a reply', () => {
    const paste2 = [
      `31.7.2026, 21:45 - רויטל קרן: אפשר קורות חיים?`,
      `31.7.2026, 21:50 - דנה כהן: <המדיה לא נכללה>`,
    ].join('\n');
    const { thread, plan } = parseThreadToPlan(paste2, HER, 'p-1');
    expect(thread.messages[1].media).toBe(true);
    expect(plan.latest).toEqual({ state: 'replied', ts: '2026-07-31T21:50:00.000Z' });
  });

  it('parsing is pure: same input twice yields deep-equal thread and plan', () => {
    const a = parseThreadToPlan(paste, HER, 'p-1');
    const b = parseThreadToPlan(paste, HER, 'p-1');
    expect(a).toEqual(b);
  });
});
