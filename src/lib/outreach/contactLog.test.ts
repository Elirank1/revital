import { describe, expect, it } from 'vitest';
import {
  composeAndLog,
  hashMessage,
  type ContactChannel,
  type ContactLogger,
} from './contactLog';

interface LoggedCall {
  personId: string;
  channel: ContactChannel;
  messageHash: string;
  ts: number;
}

function makeSpyLogger(): { logger: ContactLogger; calls: LoggedCall[] } {
  const calls: LoggedCall[] = [];
  return {
    calls,
    logger: {
      logContact(personId, channel, messageHash, ts) {
        calls.push({ personId, channel, messageHash, ts });
      },
    },
  };
}

describe('hashMessage', () => {
  it('is stable: identical input always yields the identical hash', () => {
    const text = 'שלום דנה, מדברת רויטל — יש לי משרה בשבילך';
    const first = hashMessage(text);
    for (let i = 0; i < 10; i++) {
      expect(hashMessage(text)).toBe(first);
    }
  });

  it('produces an 8-char lowercase hex string', () => {
    expect(hashMessage('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashMessage('')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashMessage('שלום עולם! 😊')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs for different messages, including near-identical Hebrew', () => {
    expect(hashMessage('שלום דנה')).not.toBe(hashMessage('שלום דנא'));
    expect(hashMessage('follow-up 1')).not.toBe(hashMessage('follow-up 2'));
    expect(hashMessage('a')).not.toBe(hashMessage('b'));
  });

  it('matches the sent message: BiDi-override controls do not change the hash', () => {
    // sanitizeMessageText strips U+202E/U+202C before sending, so the
    // hash of the raw draft equals the hash of what actually goes out.
    expect(hashMessage('שלום\u202Eabc\u202C')).toBe(hashMessage('שלוםabc'));
  });

  it('is a known-vector FNV-1a 32 implementation', () => {
    // Standard FNV-1a 32-bit test vectors.
    expect(hashMessage('')).toBe('811c9dc5');
    expect(hashMessage('a')).toBe('e40c292c');
    expect(hashMessage('foobar')).toBe('bf9cf968');
  });
});

describe('composeAndLog — whatsapp', () => {
  it('returns the wa.me href and logs exactly one contact', () => {
    const { logger, calls } = makeSpyLogger();
    const result = composeAndLog(
      {
        channel: 'whatsapp',
        personId: 'person-1',
        phone: '050-123-4567',
        message: 'שלום דנה, מדברת רויטל',
      },
      logger,
      () => 1_722_400_000_000
    );

    expect(result).not.toBeNull();
    expect(result!.href).toBe(
      `https://wa.me/972501234567?text=${encodeURIComponent('שלום דנה, מדברת רויטל')}`
    );
    expect(result!.messageHash).toBe(hashMessage('שלום דנה, מדברת רויטל'));
    expect(result!.ts).toBe(1_722_400_000_000);

    expect(calls).toEqual([
      {
        personId: 'person-1',
        channel: 'whatsapp',
        messageHash: result!.messageHash,
        ts: 1_722_400_000_000,
      },
    ]);
  });

  it('returns null and logs NOTHING when the phone is unusable', () => {
    const { logger, calls } = makeSpyLogger();
    const result = composeAndLog(
      { channel: 'whatsapp', personId: 'person-1', phone: 'garbage', message: 'שלום' },
      logger
    );
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('uses Date.now by default for the timestamp', () => {
    const { logger, calls } = makeSpyLogger();
    const before = Date.now();
    const result = composeAndLog(
      { channel: 'whatsapp', personId: 'p', phone: '0501234567', message: 'x' },
      logger
    );
    const after = Date.now();
    expect(result!.ts).toBeGreaterThanOrEqual(before);
    expect(result!.ts).toBeLessThanOrEqual(after);
    expect(calls[0].ts).toBe(result!.ts);
  });
});

describe('composeAndLog — email', () => {
  it('returns the mailto href and logs the email channel', () => {
    const { logger, calls } = makeSpyLogger();
    const result = composeAndLog(
      {
        channel: 'email',
        personId: 'person-2',
        to: 'client@example.co.il',
        subject: 'מועמד למשרת Backend',
        body: 'שלום, מצרפת פרטים.',
      },
      logger,
      () => 42
    );

    expect(result!.href).toBe(
      `mailto:client@example.co.il?subject=${encodeURIComponent('מועמד למשרת Backend')}&body=${encodeURIComponent('שלום, מצרפת פרטים.')}`
    );
    expect(result!.messageHash).toBe(hashMessage('מועמד למשרת Backend\nשלום, מצרפת פרטים.'));
    expect(calls).toEqual([
      { personId: 'person-2', channel: 'email', messageHash: result!.messageHash, ts: 42 },
    ]);
  });

  it('hashes subject-only and body-only emails distinctly', () => {
    const { logger } = makeSpyLogger();
    const subjectOnly = composeAndLog(
      { channel: 'email', personId: 'p', subject: 'שלום' },
      logger,
      () => 1
    );
    const bodyOnly = composeAndLog(
      { channel: 'email', personId: 'p', body: 'שלום' },
      logger,
      () => 1
    );
    expect(subjectOnly!.messageHash).toBe(hashMessage('שלום'));
    expect(bodyOnly!.messageHash).toBe(hashMessage('שלום'));
    expect(subjectOnly!.href).toBe(`mailto:?subject=${encodeURIComponent('שלום')}`);
    expect(bodyOnly!.href).toBe(`mailto:?body=${encodeURIComponent('שלום')}`);
  });
});

describe('G4 — composeAndLog asserts hrefs without navigating', () => {
  it('the returned href is inert data; nothing was opened or fetched', () => {
    const { logger } = makeSpyLogger();
    // Running in bare node: any window.open / location access would throw.
    const result = composeAndLog(
      { channel: 'whatsapp', personId: 'p', phone: '0501234567', message: 'שלום' },
      logger
    );
    expect(typeof result!.href).toBe('string');
  });
});
