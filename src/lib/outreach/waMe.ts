/**
 * wa.me / mailto composer — pure functions, zero side effects.
 *
 * G4 (real outreach) rail: this module ONLY composes hrefs and text.
 * It contains no navigation code of any kind — no window.open, no
 * location assignment, no fetch. Navigation happens exclusively on a
 * human click of an <a href> rendered by the UI.
 */

/**
 * BiDi control characters that can visually reorder or spoof text:
 * embeddings/overrides (U+202A–U+202E) and isolates (U+2066–U+2069).
 * These are stripped from outgoing message text so a composed message
 * can never carry direction-override injection. Plain direction marks
 * LRM/RLM (U+200E/U+200F) are harmless in message bodies and are
 * preserved there, but stripped from phone-number input where RTL UIs
 * commonly leak them.
 */
const BIDI_EMBED_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
const BIDI_ALL_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;

/** Separators legal inside a human-entered phone number. */
const PHONE_SEPARATORS = /[\s \-().]/g;

/** Remove direction-override/isolate controls from outgoing message text. */
export function sanitizeMessageText(text: string): string {
  return text.replace(BIDI_EMBED_CONTROLS, '');
}

/**
 * Normalize a phone number to E.164 digits (no leading `+`), Israel-first.
 *
 * Handles: `05X-XXXXXXX` mobiles and `0X-XXXXXXX` landlines (→ `972` +
 * national number without the leading 0), `+972…` / `972…` / `00972…`
 * already-international forms (including the common `9720…` stray-zero
 * mistake), bare 9-digit mobiles missing the leading 0 (`5XXXXXXXX`),
 * and non-IL international numbers entered with `+` or `00`.
 * Spaces, dashes, dots, parentheses and BiDi marks are stripped.
 *
 * Returns the digit string (e.g. `"972501234567"`) or `null` when the
 * input cannot be a valid number.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;

  let s = raw.replace(BIDI_ALL_MARKS, '').replace(PHONE_SEPARATORS, '');
  let explicitInternational = false;

  if (s.startsWith('+')) {
    explicitInternational = true;
    s = s.slice(1);
  } else if (s.startsWith('00')) {
    explicitInternational = true;
    s = s.slice(2);
  }

  // Anything left must be pure digits.
  if (!/^\d+$/.test(s)) return null;

  if (s.startsWith('972')) {
    let national = s.slice(3);
    // Common mistake: +972 0XX… — drop the stray national zero.
    if (national.startsWith('0')) national = national.slice(1);
    if (national.length < 8 || national.length > 9) return null;
    return `972${national}`;
  }

  if (explicitInternational) {
    // Non-IL international number: accept E.164 length bounds.
    if (s.length < 8 || s.length > 15) return null;
    return s;
  }

  if (s.startsWith('0')) {
    // Israeli national format: 05X-XXXXXXX (9 national digits) or
    // 0X-XXXXXXX landline (8 national digits).
    const national = s.slice(1);
    if (national.length < 8 || national.length > 9) return null;
    return `972${national}`;
  }

  // Bare 9-digit mobile missing its leading zero: 5XXXXXXXX.
  if (s.length === 9 && s.startsWith('5')) {
    return `972${s}`;
  }

  // 11–15 digits without prefix: assume already-international digits.
  if (s.length >= 11 && s.length <= 15) {
    return s;
  }

  return null;
}

/**
 * Compose a `https://wa.me/<E164-digits>?text=…` href.
 * Message text is BiDi-sanitized then percent-encoded (UTF-8), so
 * Hebrew round-trips exactly through `decodeURIComponent`.
 * Returns `null` if the phone number cannot be normalized.
 */
export function composeWaMeUrl(phone: string, message?: string): string | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  if (message === undefined || message === '') return base;
  return `${base}?text=${encodeURIComponent(sanitizeMessageText(message))}`;
}

export interface MailtoParts {
  to?: string;
  subject?: string;
  body?: string;
}

/**
 * Compose a `mailto:` href. Subject and body are BiDi-sanitized and
 * percent-encoded; the address keeps a readable `@`.
 */
export function composeMailto({ to, subject, body }: MailtoParts): string {
  const address =
    to === undefined
      ? ''
      : encodeURIComponent(to.replace(BIDI_ALL_MARKS, '').trim()).replace(/%40/g, '@');

  const query: string[] = [];
  if (subject !== undefined && subject !== '') {
    query.push(`subject=${encodeURIComponent(sanitizeMessageText(subject))}`);
  }
  if (body !== undefined && body !== '') {
    query.push(`body=${encodeURIComponent(sanitizeMessageText(body))}`);
  }

  return `mailto:${address}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}
