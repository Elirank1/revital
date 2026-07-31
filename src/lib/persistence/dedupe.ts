// Revital V3 — Person dedupe (cross-mandate, plan §2).
// Match rule: normalizedName + (phone|email), OR exact phone/email alone.
// Name-only collisions are flagged (merge Suggestion), never auto-merged.

import type { Person } from '../../types/pipeline';

/**
 * Normalize a person name for dedupe:
 * NFKC → lowercase → strip Hebrew niqqud → strip punctuation → collapse spaces.
 * Handles Hebrew + Latin names ("רון כהן", "Ron Cohen", "ron  cohen.").
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    // Hebrew niqqud + cantillation marks
    .replace(/[֑-ׇ]/g, '')
    // punctuation/symbols → space (keep letters/digits of any script)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize a phone number: digits only, Israeli formats unified —
 * "+972-52-1234567", "052 1234567", "972521234567" → "521234567".
 */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('972')) digits = digits.slice(3);
  digits = digits.replace(/^0+/, '');
  return digits;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type DedupeMatch =
  | { kind: 'exact'; person: Person; matchedOn: 'phone' | 'email' | 'name+contact' }
  | { kind: 'name_only'; person: Person };

/**
 * Find whether a candidate matches an existing Person.
 * - 'exact'      → safe to attach to the existing Person.
 * - 'name_only'  → ambiguous; caller must emit a merge_person Suggestion,
 *                  never auto-merge.
 * - null         → new Person.
 * Tombstoned persons are ignored.
 */
export function findDuplicatePerson(
  persons: Person[],
  candidate: { name: string; phone?: string; email?: string },
): DedupeMatch | null {
  const cName = normalizeName(candidate.name);
  const cPhone = candidate.phone ? normalizePhone(candidate.phone) : '';
  const cEmail = candidate.email ? normalizeEmail(candidate.email) : '';

  let nameOnly: Person | null = null;

  for (const p of persons) {
    if (p.deleted) continue;
    const pPhone = p.phone ? normalizePhone(p.phone) : '';
    const pEmail = p.email ? normalizeEmail(p.email) : '';
    const phoneHit = !!cPhone && cPhone === pPhone;
    const emailHit = !!cEmail && cEmail === pEmail;
    const nameHit = !!cName && cName === p.normalizedName;

    if (nameHit && (phoneHit || emailHit)) {
      return { kind: 'exact', person: p, matchedOn: 'name+contact' };
    }
    if (phoneHit) return { kind: 'exact', person: p, matchedOn: 'phone' };
    if (emailHit) return { kind: 'exact', person: p, matchedOn: 'email' };
    if (nameHit && !nameOnly) nameOnly = p;
  }

  return nameOnly ? { kind: 'name_only', person: nameOnly } : null;
}
