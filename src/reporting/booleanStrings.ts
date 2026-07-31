/**
 * Boolean search-string generator — deterministic, pure (Wave 2).
 *
 * `booleanStrings(jd)` derives ready-to-paste sourcing queries from a
 * JobDescription's pillars/keywords. No LLM, no randomness, no clock:
 * the same JD always yields byte-identical queries.
 *
 * Shape of the output set, per language (Hebrew / English, emitted only
 * when the JD actually has keywords in that script):
 *   - core     — "<title>" AND (pillar-1 OR-group) AND (pillar-2 …)
 *                CRITICAL+HIGH pillars only, one AND'd OR-group each.
 *   - linkedin — the core query behind `site:linkedin.com/in` (X-Ray).
 *   - broad    — "<title>" AND one wide OR-group over CRITICAL+HIGH+
 *                MEDIUM keywords (recall variant).
 * LOW-weight keywords are noise by definition and never included.
 *
 * G4 note: these are STRINGS for Revital to paste into a search box —
 * nothing here fetches, navigates, or calls any API.
 */

import type { EvaluationPillar, JobDescription } from '../types';
import { sanitizeMessageText } from '../lib/outreach';

// ------------------------------------------------------------
// Public shapes
// ------------------------------------------------------------

export type QueryLang = 'he' | 'en';

export interface BooleanQuery {
  /** Stable id, e.g. 'core-he', 'linkedin-en', 'broad-en'. */
  id: string;
  kind: 'core' | 'linkedin' | 'broad';
  lang: QueryLang;
  /** Hebrew UI label. */
  label: string;
  /** The paste-ready boolean string. */
  query: string;
}

// ------------------------------------------------------------
// Tuning (deterministic caps)
// ------------------------------------------------------------

/** Max keywords inside one pillar OR-group. */
const MAX_GROUP_TOKENS = 8;
/** Max AND'd pillar groups in a core query (beyond the title). */
const MAX_CORE_GROUPS = 4;
/** Max keywords in the broad OR-group. */
const MAX_BROAD_TOKENS = 12;

const WEIGHT_RANK: Record<EvaluationPillar['weight'], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const LANG_LABEL: Record<QueryLang, string> = { he: 'עברית', en: 'אנגלית' };

// ------------------------------------------------------------
// Token helpers
// ------------------------------------------------------------

const HEBREW_RE = /[\u0590-\u05FF]/;

function hasHebrew(s: string): boolean {
  return HEBREW_RE.test(s);
}

/** Sanitize a keyword: BiDi controls out, embedded quotes out, spaces collapsed. */
function cleanToken(raw: string): string {
  return sanitizeMessageText(raw)
    .replace(/["“”„']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quote when the token has whitespace or any non-letter/digit char (Node.js, C++…). */
function quoteToken(token: string): string {
  return /\s/.test(token) || /[^\p{L}\p{N}]/u.test(token) ? `"${token}"` : token;
}

function orGroup(tokens: string[]): string {
  const quoted = tokens.map(quoteToken);
  return quoted.length === 1 ? quoted[0] : `(${quoted.join(' OR ')})`;
}

function tokenLang(token: string): QueryLang {
  return hasHebrew(token) ? 'he' : 'en';
}

/**
 * Pillar keywords for one language: cleaned, script-filtered,
 * deduped (case-insensitive) against `seen`, insertion-ordered.
 */
function pillarTokens(
  pillar: EvaluationPillar,
  lang: QueryLang,
  seen: Set<string>,
  cap: number
): string[] {
  const out: string[] = [];
  for (const raw of pillar.keywords) {
    if (out.length >= cap) break;
    const token = cleanToken(raw);
    if (token === '') continue;
    if (tokenLang(token) !== lang) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

// ------------------------------------------------------------
// booleanStrings
// ------------------------------------------------------------

export function booleanStrings(jd: JobDescription): BooleanQuery[] {
  const title = cleanToken(jd.title);
  const titlePart = title !== '' ? `"${title}"` : '';

  // Stable pillar order: weight rank, then original position (sort is stable).
  const pillars = [...jd.pillars].sort((a, b) => WEIGHT_RANK[a.weight] - WEIGHT_RANK[b.weight]);
  const corePillars = pillars.filter((p) => WEIGHT_RANK[p.weight] <= WEIGHT_RANK.HIGH);
  const broadPillars = pillars.filter((p) => WEIGHT_RANK[p.weight] <= WEIGHT_RANK.MEDIUM);

  const out: BooleanQuery[] = [];

  const push = (kind: BooleanQuery['kind'], lang: QueryLang, query: string): void => {
    const labelByKind: Record<BooleanQuery['kind'], string> = {
      core: `חיפוש ממוקד — ${LANG_LABEL[lang]}`,
      linkedin: `LinkedIn X-Ray — ${LANG_LABEL[lang]}`,
      broad: `חיפוש מורחב — ${LANG_LABEL[lang]}`,
    };
    out.push({ id: `${kind}-${lang}`, kind, lang, label: labelByKind[kind], query });
  };

  for (const lang of ['he', 'en'] as const) {
    // core: one AND'd OR-group per CRITICAL/HIGH pillar.
    const coreSeen = new Set<string>();
    const groups: string[] = [];
    for (const pillar of corePillars) {
      if (groups.length >= MAX_CORE_GROUPS) break;
      const tokens = pillarTokens(pillar, lang, coreSeen, MAX_GROUP_TOKENS);
      if (tokens.length > 0) groups.push(orGroup(tokens));
    }

    // broad: one wide OR-group over CRITICAL+HIGH+MEDIUM.
    const broadSeen = new Set<string>();
    const broadTokens: string[] = [];
    for (const pillar of broadPillars) {
      if (broadTokens.length >= MAX_BROAD_TOKENS) break;
      broadTokens.push(
        ...pillarTokens(pillar, lang, broadSeen, MAX_BROAD_TOKENS - broadTokens.length)
      );
    }

    const coreQuery =
      groups.length > 0 ? [titlePart, ...groups].filter((p) => p !== '').join(' AND ') : null;
    const broadQuery =
      broadTokens.length > 0
        ? [titlePart, orGroup(broadTokens)].filter((p) => p !== '').join(' AND ')
        : null;

    if (coreQuery !== null) {
      push('core', lang, coreQuery);
      push('linkedin', lang, `site:linkedin.com/in ${coreQuery}`);
      if (broadQuery !== null && broadQuery !== coreQuery) push('broad', lang, broadQuery);
    } else if (broadQuery !== null) {
      // Only MEDIUM keywords exist in this language — the broad form IS
      // the focused query for it.
      push('broad', lang, broadQuery);
      push('linkedin', lang, `site:linkedin.com/in ${broadQuery}`);
    }
  }

  // No usable keywords at all → title-only fallback in the title's script.
  if (out.length === 0 && titlePart !== '') {
    const lang: QueryLang = hasHebrew(title) ? 'he' : 'en';
    push('core', lang, titlePart);
    push('linkedin', lang, `site:linkedin.com/in ${titlePart}`);
  }

  return out;
}
