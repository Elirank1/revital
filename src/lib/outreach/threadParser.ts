/**
 * threadParser.ts — paste-a-WhatsApp-thread parser (Wave 3).
 *
 * Revital copies a WhatsApp conversation (chat export / select-copy) and
 * pastes it into a card. This module turns that paste into structured
 * history: who said what when, plus an APPLY PLAN of store-contract calls
 * (`logContact` / `setReplyState` inputs) that backfills the person's
 * outreach history and derives the latest reply state.
 *
 * Layering (BINDING, wave3 contract):
 * - Parsing is 100% PURE — string in, data out. No store import, no
 *   side effects, no clock reads.
 * - APPLICATION is the UI's job: kanban-ui walks `plan.calls` in order
 *   and invokes the pipeline-store contract actions. Nothing here writes.
 * - G4: nothing here composes URLs or navigates — this module only READS
 *   text she already sent by hand.
 *
 * Supported line formats (real WhatsApp exports):
 * - iOS:     `[31.7.2026, 21:45:12] רויטל קרן: הודעה`
 * - Android: `31.7.2026, 21:45 - רויטל קרן: הודעה`
 * plus: optional seconds, `/` or `.` date separators, 2-digit years,
 * `AM`/`PM` markers (with iOS's narrow no-break space), US month-first
 * dates (auto-detected via a day>12 swap), BiDi control marks sprinkled
 * through timestamps/names (stripped), Hebrew RTL names, multiline
 * messages, and media-omitted placeholders in both languages.
 *
 * Malformed input NEVER throws: every line that cannot be attributed to
 * a message lands in `skipped[]` with a reason.
 *
 * Timestamps: WhatsApp exports carry LOCAL wall-clock time with no
 * timezone. The parser encodes wall-clock parts as UTC ISO strings —
 * deterministic everywhere, ordering-faithful, and honest (inventing an
 * offset would be wrong twice a year). Day-based derivations tolerate
 * the fixed shift.
 *
 * BiDi policy: ALL direction marks (LRM/RLM/ALM + embed/override/
 * isolate controls) are stripped from parsed output — exports pepper
 * them through timestamps, names, and media markers, and they poison
 * name matching and message hashes. Direction is a rendering concern
 * handled by `dir="auto"` in the UI (D-017 policy: never ADD marks).
 */

import { hashMessage } from './contactLog';

// ------------------------------------------------------------
// Public shapes
// ------------------------------------------------------------

export type ThreadWho = 'her' | 'candidate';

/** Who counts as "her" — display name + aliases as they appear in exports. */
export interface HerIdentity {
  name: string;
  aliases?: readonly string[];
}

/**
 * Convenience default for the product's single daily user. The UI may
 * pass its own (e.g. after she edits her display name); the parser
 * itself takes identity explicitly and assumes nothing.
 */
export const DEFAULT_HER: HerIdentity = {
  name: 'רויטל קרן',
  aliases: ['רויטל', 'Revital Keren', 'Revital'],
};

export interface ThreadMessage {
  who: ThreadWho;
  /** Sender display name as parsed (BiDi-stripped, `~` prefix removed). */
  senderName: string;
  /** UTC ISO timestamp encoding the export's wall-clock time. */
  ts: string;
  /** Message text; internal newlines preserved, BiDi marks stripped. */
  text: string;
  /** True for media placeholders (`<המדיה לא נכללה>`, `image omitted`, …). */
  media: boolean;
  /** 1-based line number of the message header in the paste. */
  line: number;
}

export type SkipReason =
  /** Timestamp header with no `name: ` part — WhatsApp system line
   *  (encryption notice, group events, missed-call notices, …). */
  | 'system'
  /** Looked like a header but carries an impossible date/time. */
  | 'bad_timestamp'
  /** Non-blank text before any message header — nothing to attach it to. */
  | 'orphan';

export interface SkippedLine {
  line: number;
  raw: string;
  reason: SkipReason;
}

export interface ParsedThread {
  messages: ThreadMessage[];
  skipped: SkippedLine[];
  /** Distinct candidate-side sender names, in order of first appearance. */
  senders: string[];
  /** True when at least one message matched her identity. */
  herMatched: boolean;
  format: 'ios' | 'android' | 'mixed' | 'none';
}

// ---- apply plan --------------------------------------------------------

/**
 * Input for `usePipelineStore.getState().logContact(personId, channel,
 * messageHash, ts)` — one per outbound (her) message.
 */
export interface ContactLogCall {
  action: 'logContact';
  personId: string;
  channel: 'whatsapp';
  messageHash: string;
  ts: string;
  /**
   * `${ts}|${messageHash}` — the UI should skip a call when the person
   * already has a 'contacted' event with this ts+hash (paste-twice
   * idempotency lives at application time; parsing stays pure).
   */
  dedupeKey: string;
}

/**
 * Input for `usePipelineStore.getState().setReplyState(personId, state,
 * ts)` — one per run of consecutive candidate messages, stamped at the
 * run's LAST message. Applying calls in order makes the store's latest
 * contact event agree with `latest` below (latest state wins).
 */
export interface ReplyStateCall {
  action: 'setReplyState';
  personId: string;
  state: 'replied';
  ts: string;
}

export type ThreadApplyCall = ContactLogCall | ReplyStateCall;

export interface ThreadApplyPlan {
  personId: string;
  /** Chronological — the UI applies these in order via contract actions. */
  calls: ThreadApplyCall[];
  /**
   * Derived current state of the conversation:
   * - 'replied'         — the candidate spoke last (ts = that message);
   * - 'awaiting_reply'  — her message is last (ts = that message). No
   *   'no_reply' store call is planned: silence-aging is the SLA agent's
   *   judgment, not a paste-time fact;
   * - 'none'            — the paste contained no attributable messages.
   */
  latest: { state: 'replied' | 'awaiting_reply' | 'none'; ts: string | null };
  counts: { her: number; candidate: number };
}

// ------------------------------------------------------------
// Line grammar
// ------------------------------------------------------------

/** Every BiDi mark/control that exports sprinkle around (incl. ALM). */
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;
/** iOS puts U+202F (narrow no-break space) before AM/PM; normalize. */
const EXOTIC_SPACES = /[\u00A0\u202F]/g;

const DATE = String.raw`(\d{1,2})[./](\d{1,2})[./](\d{2,4})`;
const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?`;

/** `[31.7.2026, 21:45:12] rest` */
const IOS_HEADER = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s?(.*)$`, 'i');
/** `31.7.2026, 21:45 - rest` */
const ANDROID_HEADER = new RegExp(String.raw`^${DATE},?\s+${TIME}\s+-\s?(.*)$`, 'i');

/**
 * Media placeholders, lowercased. iOS spells the medium (`image
 * omitted`); Android collapses to one marker; Hebrew locales translate.
 */
const MEDIA_MARKERS = new Set([
  '<media omitted>',
  '<המדיה לא נכללה>',
  'image omitted',
  'video omitted',
  'audio omitted',
  'voice message omitted',
  'sticker omitted',
  'gif omitted',
  'document omitted',
  'contact card omitted',
  'תמונה הושמטה',
  'סרטון הושמט',
  'אודיו הושמט',
  'הודעה קולית הושמטה',
  'סטיקר הושמט',
  'קובץ gif הושמט',
  'מסמך הושמט',
  'כרטיס איש קשר הושמט',
]);

// ------------------------------------------------------------
// Small pure helpers
// ------------------------------------------------------------

function stripMarks(s: string): string {
  return s.replace(BIDI_MARKS, '').replace(EXOTIC_SPACES, ' ');
}

/** Normalize a sender name for identity matching. */
function normalizeName(name: string): string {
  return stripMarks(name)
    .replace(/^~\s*/, '') // group push-name prefix
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Clean a sender name for display (keeps case, drops marks + `~`). */
function displayName(name: string): string {
  return stripMarks(name)
    .replace(/^~\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface HeaderParts {
  ts: string | null; // null ⇒ impossible date/time
  rest: string;
  format: 'ios' | 'android';
}

/**
 * Build a UTC ISO string from wall-clock parts; null when impossible.
 * `Date.UTC` rollover (e.g. 31.2) is rejected by round-trip comparison.
 */
function toIso(
  day: number,
  month: number,
  yearRaw: number,
  hourRaw: number,
  minute: number,
  second: number,
  meridiem: string | undefined
): string | null {
  let d = day;
  let m = month;
  // IL exports are day-first; a month>12 with a plausible day means a
  // US month-first export — swap once, deterministically.
  if (m > 12 && d <= 12) [d, m] = [m, d];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;

  let hour = hourRaw;
  const mer = meridiem?.toUpperCase();
  if (mer === 'PM' && hour < 12) hour += 12;
  if (mer === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const ms = Date.UTC(year, m - 1, d, hour, minute, second);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null; // rolled over — the date never existed
  }
  return check.toISOString();
}

function matchHeader(line: string): HeaderParts | null {
  for (const [re, format] of [
    [IOS_HEADER, 'ios'],
    [ANDROID_HEADER, 'android'],
  ] as const) {
    const m = re.exec(line);
    if (m === null) continue;
    const [, dd, mm, yy, hh, min, ss, mer, rest] = m;
    return {
      ts: toIso(
        Number(dd),
        Number(mm),
        Number(yy),
        Number(hh),
        Number(min),
        ss !== undefined ? Number(ss) : 0,
        mer
      ),
      rest,
      format,
    };
  }
  return null;
}

// ------------------------------------------------------------
// parseWhatsAppThread
// ------------------------------------------------------------

export function parseWhatsAppThread(raw: string, her: HerIdentity): ParsedThread {
  const herSet = new Set(
    [her.name, ...(her.aliases ?? [])].map(normalizeName).filter((n) => n !== '')
  );

  const messages: ThreadMessage[] = [];
  const skipped: SkippedLine[] = [];
  const senders: string[] = [];
  const seenSenders = new Set<string>();
  let sawIos = false;
  let sawAndroid = false;

  // Split on \n; tolerate \r\n pastes.
  const lines = raw.split('\n').map((l) => l.replace(/\r$/, ''));

  let current: { msg: ThreadMessage; parts: string[] } | null = null;

  const finalize = () => {
    if (current === null) return;
    const text = current.parts.join('\n').replace(/\s+$/, '');
    current.msg.text = text;
    current.msg.media = MEDIA_MARKERS.has(text.trim().toLowerCase());
    messages.push(current.msg);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const cleaned = stripMarks(lines[i]);
    const header = matchHeader(cleaned);

    if (header === null) {
      // Continuation of a multiline message — or noise before the first one.
      if (current !== null) {
        current.parts.push(cleaned);
      } else if (cleaned.trim() !== '') {
        skipped.push({ line: lineNo, raw: lines[i], reason: 'orphan' });
      }
      continue;
    }

    finalize();

    if (header.ts === null) {
      skipped.push({ line: lineNo, raw: lines[i], reason: 'bad_timestamp' });
      continue;
    }

    // `rest` is `name: message` — split on the FIRST ': '. No separator
    // means a WhatsApp system line (encryption notice, group event, …).
    const sep = header.rest.indexOf(': ');
    if (sep === -1) {
      skipped.push({ line: lineNo, raw: lines[i], reason: 'system' });
      continue;
    }

    const sender = displayName(header.rest.slice(0, sep));
    if (sender === '') {
      skipped.push({ line: lineNo, raw: lines[i], reason: 'system' });
      continue;
    }
    const firstChunk = header.rest.slice(sep + 2);
    const who: ThreadWho = herSet.has(normalizeName(sender)) ? 'her' : 'candidate';

    if (header.format === 'ios') sawIos = true;
    else sawAndroid = true;

    if (who === 'candidate' && !seenSenders.has(sender)) {
      seenSenders.add(sender);
      senders.push(sender);
    }

    current = {
      msg: { who, senderName: sender, ts: header.ts, text: '', media: false, line: lineNo },
      parts: [firstChunk],
    };
  }
  finalize();

  return {
    messages,
    skipped,
    senders,
    herMatched: messages.some((m) => m.who === 'her'),
    format: sawIos && sawAndroid ? 'mixed' : sawIos ? 'ios' : sawAndroid ? 'android' : 'none',
  };
}

// ------------------------------------------------------------
// buildThreadApplyPlan
// ------------------------------------------------------------

export function buildThreadApplyPlan(thread: ParsedThread, personId: string): ThreadApplyPlan {
  // Chronological, stable on ties (mixed pastes may interleave sources).
  const ordered = thread.messages
    .map((msg, idx) => ({ msg, idx }))
    .sort((a, b) => {
      const dt = Date.parse(a.msg.ts) - Date.parse(b.msg.ts);
      return dt !== 0 ? dt : a.idx - b.idx;
    })
    .map((x) => x.msg);

  const calls: ThreadApplyCall[] = [];
  let herCount = 0;
  let candidateCount = 0;

  for (let i = 0; i < ordered.length; i++) {
    const msg = ordered[i];
    if (msg.who === 'her') {
      herCount += 1;
      const messageHash = hashMessage(msg.text);
      calls.push({
        action: 'logContact',
        personId,
        channel: 'whatsapp',
        messageHash,
        ts: msg.ts,
        dedupeKey: `${msg.ts}|${messageHash}`,
      });
    } else {
      candidateCount += 1;
      // One 'replied' per candidate RUN, stamped at the run's last
      // message — full fidelity without one event per bubble.
      const next = ordered[i + 1];
      if (next === undefined || next.who !== 'candidate') {
        calls.push({ action: 'setReplyState', personId, state: 'replied', ts: msg.ts });
      }
    }
  }

  const last = ordered[ordered.length - 1];
  const latest: ThreadApplyPlan['latest'] =
    last === undefined
      ? { state: 'none', ts: null }
      : last.who === 'candidate'
        ? { state: 'replied', ts: last.ts }
        : { state: 'awaiting_reply', ts: last.ts };

  return { personId, calls, latest, counts: { her: herCount, candidate: candidateCount } };
}

/** Parse + plan in one call — the card-back paste box uses this. */
export function parseThreadToPlan(
  raw: string,
  her: HerIdentity,
  personId: string
): { thread: ParsedThread; plan: ThreadApplyPlan } {
  const thread = parseWhatsAppThread(raw, her);
  return { thread, plan: buildThreadApplyPlan(thread, personId) };
}
