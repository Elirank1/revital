/**
 * he.ts — the shared Hebrew lexicon (Wave 3, integrations).
 *
 * Single source for every agent-facing output string: suggestion titles,
 * draft-message phrasing, SLA / Pit Boss suggestion text, the client
 * report frames, the morning-digest strings, and a catalogue of common
 * UI chrome terms.
 *
 * Design rules:
 * - Natural recruiter Hebrew — the voice of one specific person writing
 *   to candidates and clients, not an app emitting notifications. No
 *   "בוצעה פעולה", no over-formal machine tone.
 * - Values that agent modules already emit are BYTE-IDENTICAL to the
 *   strings currently hard-coded there, so adopting a key is a no-risk
 *   mechanical swap (and existing pinned tests keep passing).
 * - Grammar-sensitive phrases (Hebrew pluralization) are NOT templates —
 *   naive `{n} ימים` templates produce wrong Hebrew. They live here as
 *   helper functions (`durationHe`, `candidatesHe`, `daysAgoHe`, …).
 * - `sla.*` / `pitboss.*` keys are READY-TO-ADOPT for agents-engine
 *   (their files are not ours to edit — a CONFIG line in BOARD-STATUS
 *   offers the swap). `chrome.*` keys are CATALOGUED ONLY: full UI i18n
 *   is on the cut list, so no view is rewired to consume them.
 *
 * BiDi safety: interpolated params are stripped of direction-override /
 * embed / isolate controls (same policy as `sanitizeMessageText`); the
 * templates themselves never contain direction marks — mixed-direction
 * rendering is the UI's job via `dir="auto"`.
 */

import { sanitizeMessageText } from '../lib/outreach/waMe';

// ------------------------------------------------------------
// The lexicon
// ------------------------------------------------------------

export const he = {
  // ---- agent display names (digest/inbox group headers) ----------------
  'agent.screener': 'סינון אוטומטי',
  'agent.bench_sourcer': 'איתור מהספסל',
  'agent.outreach_runner': 'טיוטות פנייה',
  'agent.client_reporter': 'דו"חות ללקוח',
  'agent.pit_boss': 'Pit Boss',

  // ---- outreach drafts (owned here; drafts.ts consumes) ----------------
  'draft.opener.greeting': 'היי {firstName},',
  'draft.opener.intro': 'זו רויטל קרן, מגייסת עצמאית.',
  'draft.opener.reviewed':
    'עברתי על הפרופיל שלך והניסיון נראה רלוונטי מאוד לתפקיד {jobTitle} שאני מגייסת אליו.',
  'draft.opener.cold': 'אני מגייסת כרגע לתפקיד {jobTitle} וחשבתי שזה עשוי לעניין אותך.',
  'draft.opener.cta': 'יש לך כמה דקות השבוע לשיחה קצרה? מבטיחה להיות עניינית.',
  'draft.opener.title': 'טיוטת פנייה ראשונה: {name} — {jobTitle}',

  'draft.followUp.greeting': 'היי {firstName}, זו שוב רויטל 🙂',
  'draft.followUp.sent': 'שלחתי לך הודעה {timeRef} לגבי תפקיד {jobTitle} — רציתי לוודא שלא התפספסה.',
  'draft.followUp.sentNoTime': 'שלחתי לך הודעה לגבי תפקיד {jobTitle} — רציתי לוודא שלא התפספסה.',
  'draft.followUp.cta':
    'אם זה רלוונטי, אשמח לכמה דקות לשיחה. ואם התזמון לא מתאים — לגמרי בסדר, אשמח לדעת ולא אציק.',
  'draft.followUp.title': 'טיוטת פולו-אפ: {name} — {jobTitle}',
  'draft.followUp.titleSilent': 'טיוטת פולו-אפ: {name} — {jobTitle} ({daysPhrase} ללא מענה)',

  // ---- shared evidence claims (drafts) ---------------------------------
  'evidence.activeDeal': 'מועמדות פעילה לתפקיד {jobTitle} (שלב: {stage})',
  'evidence.analysisScore': 'ניתוח התאמה קיים — ציון {score} ({verdict})',
  'evidence.daysNoReply': '{daysPhrase} ללא מענה מאז הפנייה האחרונה',
  'evidence.noReplyYet': 'טרם התקבל מענה לפנייה האחרונה',

  // ---- SLA agent (READY-TO-ADOPT — agents-engine owns sla.ts) ----------
  // Values are byte-identical to the strings sla.ts emits today.
  'sla.evidence.lastContact':
    'פנייה אחרונה: {ts} — {days} ימים ללא מענה (סף: {threshold} ימים)',

  // ---- Pit Boss agent (READY-TO-ADOPT — agents-engine owns pitboss.ts) -
  // Values are byte-identical to the strings pitboss.ts emits today.
  'pitboss.title': 'לטיפול: {jobTitle} ({stage})',
  'pitboss.reason.agingPastMedian': '{days} ימים בשלב {stage} — מעל חציון השלב ({median} ימים)',
  'pitboss.reason.feedbackOverdue':
    '{days} ימים ללא משוב לקוח מאז הכניסה ל-{stage} (סף: {threshold} ימים)',
  'pitboss.reason.followupDue':
    '{days} ימים ללא מענה מאז הפנייה האחרונה (סף: {threshold} ימים)',
  'pitboss.reason.offerDecay': 'הצעה פתוחה {days} ימים — מעבר לחלון של {grace} ימים',
  'pitboss.evidence.ev':
    'EV ₪{ev} = עמלת המנדט × הסתברות שלב {stage}; בסיכון: ₪{evAtRisk}',
  'pitboss.body.header': 'ה-Pit Boss סימן את העסקה "{jobTitle}" (שלב: {stage}) כדורשת טיפול:',
  'pitboss.body.ev': 'שווי צפוי (EV): ₪{ev} — מזה בסיכון: ₪{evAtRisk}.',
  'pitboss.body.nextAction': 'פעולה מומלצת: {action}.',
  'pitboss.body.footer': 'ההצעה אינה משנה את מצב הכרטיס — ההחלטה אצלך.',
  'pitboss.action.followupDue': 'לשלוח פולו-אפ למועמד/ת',
  'pitboss.action.feedbackOverdue': 'לבקש עדכון מהלקוח על המועמדות',
  'pitboss.action.offerDecay': 'לקדם החלטה על ההצעה לפני שהיא מתקררת',
  'pitboss.action.agingPastMedian': 'לבדוק את הכרטיס ולהחליט על הצעד הבא',

  // ---- client report (owned here; mandateReport.ts consumes) -----------
  'report.title': 'דו"ח סטטוס ללקוח: {jobTitle}',
  'report.header': 'עדכון סטטוס גיוס — {jobTitle}',
  'report.asOf': 'נכון ל-{date}',
  'report.greeting': 'שלום {name},',
  'report.greetingGeneric': 'שלום רב,',
  'report.section.funnel': 'תמונת מצב',
  'report.section.submitted': 'המועמדים שהוגשו',
  'report.section.feedback': 'ממתינים למשוב',
  'report.section.next': 'המשך התהליך',
  'report.next.fallback': 'נמשיך לעדכן בכל התפתחות.',
  'report.closing.help': 'נשמח לעמוד לרשותכם בכל שאלה.',
  'report.closing.regards': 'בברכה,',
  'report.closing.signature': 'רויטל קרן',
  'report.funnel.sourcing': 'באיתור ובסינון ראשוני',
  'report.funnel.conversations': 'בשיחות פעילות',
  'report.funnel.submitted': 'הוגשו לבחינתכם',
  'report.funnel.clientInterview': 'בתהליך ראיונות אצלכם',
  'report.funnel.offer': 'בשלב הצעה',
  'report.funnel.placed': 'השמה הושלמה',

  // ---- bench sourcer (READY-TO-ADOPT — Wave-3B agents-engine) ----------
  'bench.match.title': 'התאמה מהספסל: {name} — {jobTitle}',
  'bench.match.header': 'נמצאה התאמה אפשרית מהספסל למשרת {jobTitle}:',
  'bench.silverMedalist': 'מדליית כסף — הגיע/ה לשלב מתקדם בתהליך קודם',

  // ---- morning digest (Wave-3 contract; kanban-ui consumes) ------------
  'digest.title': 'מה מחכה לך הבוקר',
  'digest.section.pending': 'הצעות שממתינות לאישור',
  'digest.section.top3': 'שלוש העסקאות לטיפול ראשון',
  'digest.section.overdueFeedback': 'משוב לקוח באיחור',
  'digest.empty': 'הבוקר נקי — אין פריטים שממתינים לך.',
  'digest.cta': 'לתיבת האישורים',

  // ---- common UI chrome (CATALOGUED ONLY — cut list: no UI rewiring) ---
  // Values mirror strings currently hard-coded in views; adopting a key
  // is a later lead decision, not a Wave-3 change.
  'chrome.nav.board': 'לוח',
  'chrome.nav.today': 'היום',
  'chrome.nav.suggestions': 'הצעות',
  'chrome.nav.money': 'כסף',
  'chrome.nav.approvals': 'אישורים',
  'chrome.nav.tools': 'כלים',
  'chrome.action.approve': 'אישור',
  'chrome.action.dismiss': 'דחייה',
  'chrome.action.undo': 'ביטול',
  'chrome.action.editDraft': 'עריכת טיוטה',
  'chrome.action.cancelEdit': 'ביטול עריכה',
  'chrome.action.sendWhatsApp': 'שליחה בוואטסאפ',
  'chrome.status.pendingDraft': 'טיוטה ממתינה',
  'chrome.status.uncalibrated': 'ללא כיול',
  'chrome.status.noPhone': 'אין מספר טלפון',
  'chrome.empty.suggestions': 'אין הצעות ממתינות.',
  'chrome.section.pendingSuggestions': 'הצעות ממתינות',
  'chrome.section.dealsAtRisk': 'עסקאות בסיכון',
  'chrome.section.moveTheMoney': 'להזיז את הכסף עכשיו',
  'chrome.section.stuckLongest': 'תקועות הכי הרבה זמן',
  'chrome.bench.rail': 'ספסל',
  'chrome.bench.restore': 'החזרה ללוח',
} as const;

export type HeKey = keyof typeof he;
export type TParams = Record<string, string | number>;

// ------------------------------------------------------------
// t() — typed lookup + interpolation
// ------------------------------------------------------------

const TOKEN = /\{(\w+)\}/g;

/**
 * Look up `key` and interpolate `{param}` tokens.
 *
 * - String params are BiDi-sanitized (direction-override/embed/isolate
 *   controls stripped) before insertion — one policy with the composer.
 * - A token with NO matching param is left verbatim (`{name}`) — a
 *   missing binding should be visible in review, never silently blank.
 */
export function t(key: HeKey, params?: TParams): string {
  const template = he[key];
  if (params === undefined) return template;
  return template.replace(TOKEN, (token, name: string) => {
    const value = params[name];
    if (value === undefined) return token;
    return typeof value === 'number' ? String(value) : sanitizeMessageText(value);
  });
}

// ------------------------------------------------------------
// Hebrew grammar helpers — pluralization is code, not templates
// ------------------------------------------------------------

/**
 * Natural-Hebrew time reference for "N days ago".
 * Hebrew numeral grammar: יומיים for 2, X ימים for 3–10, X יום for 11+.
 * Returns null for zero/negative/non-finite input (caller drops the ref).
 */
export function daysAgoHe(days: number): string | null {
  const n = Math.floor(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 1) return 'אתמול';
  if (n === 2) return 'לפני יומיים';
  if (n <= 10) return `לפני ${n} ימים`;
  return `לפני ${n} יום`;
}

/** Duration wording: יום אחד / יומיים / N ימים (3–10) / N יום (11+). */
export function durationHe(days: number): string {
  const n = Math.max(1, Math.floor(days));
  if (n === 1) return 'יום אחד';
  if (n === 2) return 'יומיים';
  if (n <= 10) return `${n} ימים`;
  return `${n} יום`;
}

/** Bare day-count phrase: יום אחד / יומיים / "3 ימים" (3–10) / "12 יום" (11+). */
export function daysCountHe(days: number): string {
  const n = Math.max(1, Math.floor(days));
  if (n === 1) return 'יום אחד';
  if (n === 2) return 'יומיים';
  if (n <= 10) return `${n} ימים`;
  return `${n} יום`;
}

/** Count wording: מועמד אחד / שני מועמדים / N מועמדים. */
export function candidatesHe(n: number): string {
  if (n === 1) return 'מועמד אחד';
  if (n === 2) return 'שני מועמדים';
  return `${n} מועמדים`;
}

/** "to N candidates" wording: למועמד אחד / לשני מועמדים / ל-N מועמדים. */
export function toCandidatesHe(n: number): string {
  if (n === 1) return 'למועמד אחד';
  if (n === 2) return 'לשני מועמדים';
  return `ל-${n} מועמדים`;
}
