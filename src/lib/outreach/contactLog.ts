/**
 * Auto-log-contact interface stub (plan §2 — zero-keystroke capture).
 *
 * Clicking any wa.me / mailto action must auto-log `contacted @ts` plus
 * a message hash on the Person — with zero added keystrokes. This module
 * defines the logging CONTRACT only; the concrete store-backed logger is
 * wired later by platform-data. Depend on the `ContactLogger` interface,
 * never on the store.
 *
 * G4 rail: nothing here navigates or sends. `composeAndLog` returns an
 * href string for the UI to render as an <a>; the click is human.
 */

import { composeMailto, composeWaMeUrl, sanitizeMessageText } from './waMe';

export type ContactChannel = 'whatsapp' | 'email';

/** Implemented later by platform-data on top of the Person store. */
export interface ContactLogger {
  logContact(
    personId: string,
    channel: ContactChannel,
    messageHash: string,
    ts: number
  ): void;
}

/**
 * Stable short hash of a message (FNV-1a 32-bit over UTF-8 bytes,
 * 8 hex chars). Hashes the BiDi-sanitized text so the hash always
 * matches the message actually placed in the href.
 */
export function hashMessage(text: string): string {
  const bytes = new TextEncoder().encode(sanitizeMessageText(text));
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    // FNV prime 16777619, via shifts to stay in 32-bit integer math.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface ComposeWhatsAppArgs {
  channel: 'whatsapp';
  personId: string;
  phone: string;
  message: string;
}

export interface ComposeEmailArgs {
  channel: 'email';
  personId: string;
  to?: string;
  subject?: string;
  body?: string;
}

export type ComposeContactArgs = ComposeWhatsAppArgs | ComposeEmailArgs;

export interface ComposedContact {
  /** Href for the UI to render as an <a>. Never navigated here. */
  href: string;
  messageHash: string;
  ts: number;
}

/**
 * Compose the outreach href AND log the contact through the injected
 * logger, in one call — the UI calls this from its click handler so
 * capture costs zero keystrokes.
 *
 * Returns `null` (and logs nothing) when composition fails, e.g. an
 * unusable phone number. `now` is injectable for deterministic tests.
 */
export function composeAndLog(
  args: ComposeContactArgs,
  logger: ContactLogger,
  now: () => number = Date.now
): ComposedContact | null {
  let href: string | null;
  let messageHash: string;

  if (args.channel === 'whatsapp') {
    href = composeWaMeUrl(args.phone, args.message);
    messageHash = hashMessage(args.message);
  } else {
    href = composeMailto({ to: args.to, subject: args.subject, body: args.body });
    messageHash = hashMessage(
      [args.subject, args.body].filter((part): part is string => part !== undefined).join('\n')
    );
  }

  if (href === null) return null;

  const ts = now();
  logger.logContact(args.personId, args.channel, messageHash, ts);
  return { href, messageHash, ts };
}
