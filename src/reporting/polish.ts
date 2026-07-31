/**
 * polishWithClaude — OPTIONAL LLM wording pass over a mandate report.
 *
 * DEFAULT OFF (Wave-2 contract): unless `opts.enabled === true`, this
 * function returns the report unchanged and touches nothing — no fetch
 * is ever resolved, let alone called. Two more explicit switches guard
 * the call even when enabled:
 *   - `fetchImpl` must be INJECTED (there is deliberately no fallback
 *    to global fetch — the stub is incapable of network unless handed
 *    a transport; tests pass a mock, the UI passes `fetch`).
 *   - `accessCode` must be present (the /api/analyze proxy enforces
 *    per-code daily spend caps server-side; no code → no call).
 *
 * What gets polished: the plain-text wording ONLY. The deterministic
 * core stays the source of truth — `html`, `lines` and `evidence` are
 * returned untouched, so every claim keeps its evidence refs and the
 * HTML remains byte-deterministic. On ANY failure the original report
 * is returned unchanged (`polished: false`) — a status update must
 * always be deliverable.
 *
 * Proxy shape (existing /api/analyze contract, spend-capped):
 *   POST {baseUrl}/api/analyze
 *   headers: Content-Type: application/json, X-Access-Code: <code>
 *   body: { model, max_tokens, messages: [{ role: 'user', content }] }
 *   response: { content: [{ text }] }
 */

import type { MandateReport } from './mandateReport';
import { sanitizeMessageText } from '../lib/outreach';

export interface PolishWithClaudeOptions {
  /** Must be EXPLICITLY true. Anything else → no-op, no network. */
  enabled?: boolean;
  /** Access code for the proxy's spend-cap accounting. Required to call. */
  accessCode?: string;
  /** Injected transport. Required to call — no global-fetch fallback. */
  fetchImpl?: typeof fetch;
  /** Origin prefix; default '' (same-origin '/api/analyze'). */
  baseUrl?: string;
  /** Default matches the proxy's default model. */
  model?: string;
  maxTokens?: number;
}

export interface PolishResult {
  report: MandateReport;
  /** true only when the text was actually replaced by a polished version. */
  polished: boolean;
  /** Present when polishing was requested but fell back to the original. */
  error?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 2048;

function buildPrompt(reportText: string): string {
  return [
    'לפניך עדכון סטטוס גיוס בעברית שנכתב עבור לקוח. שפר קלות את הניסוח בלבד:',
    'טון מקצועי, טבעי ורהוט.',
    'חוקים מחייבים:',
    '1. אל תשנה שום עובדה: שמות, מספרים, תאריכים ושלבים נשארים בדיוק כפי שהם.',
    '2. אל תוסיף מידע חדש ואל תמחק שורות תוכן.',
    '3. שמור על מבנה השורות והכותרות.',
    '4. החזר את הטקסט המלוטש בלבד, ללא הקדמות והסברים.',
    '',
    '--- הדוח ---',
    reportText,
  ].join('\n');
}

/**
 * Polish the report's plain-text wording via the existing Claude proxy.
 * Never called unless explicitly enabled; see module doc for the rails.
 */
export async function polishWithClaude(
  report: MandateReport,
  opts: PolishWithClaudeOptions = {}
): Promise<PolishResult> {
  // Rail 1: default OFF — the strict `!== true` means undefined, false,
  // or anything truthy-but-not-true all short-circuit before any I/O.
  if (opts.enabled !== true) {
    return { report, polished: false };
  }
  // Rail 2: transport must be injected.
  if (opts.fetchImpl === undefined) {
    return { report, polished: false, error: 'polishWithClaude: fetchImpl not provided' };
  }
  // Rail 3: spend-cap accounting requires an access code.
  if (opts.accessCode === undefined || opts.accessCode === '') {
    return { report, polished: false, error: 'polishWithClaude: accessCode required' };
  }

  try {
    const response = await opts.fetchImpl(`${opts.baseUrl ?? ''}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': opts.accessCode,
      },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: buildPrompt(report.text) }],
      }),
    });

    if (!response.ok) {
      return { report, polished: false, error: `polishWithClaude: API ${response.status}` };
    }

    const data = (await response.json()) as { content?: { text?: string }[] };
    const polishedRaw = data.content?.[0]?.text;
    const polished =
      polishedRaw === undefined ? '' : sanitizeMessageText(polishedRaw).trim();
    if (polished === '') {
      return { report, polished: false, error: 'polishWithClaude: empty response' };
    }

    return {
      report: {
        ...report,
        text: polished,
        suggestionInput: { ...report.suggestionInput, body: polished },
      },
      polished: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { report, polished: false, error: `polishWithClaude: ${message}` };
  }
}
