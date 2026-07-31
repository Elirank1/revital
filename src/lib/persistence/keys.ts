// Revital V3 — localStorage keys + feature flag.
// All keys are NEW (revital_v3_*): zero collision with legacy revital_* keys.

export const V3_KEYS = {
  flag: 'revital_v3_flag',
  persons: 'revital_v3_persons',
  deals: 'revital_v3_deals',
  events: 'revital_v3_events',
  suggestions: 'revital_v3_suggestions',
  audit: 'revital_v3_audit',
  meta: 'revital_v3_meta',
  /** Data-retention window in months (JSON number). Absent/invalid = off. */
  retention: 'revital_v3_retention',
} as const;

/**
 * Normalize a retention value: any finite number > 0 is a valid window in
 * whole months (fractions round UP — a longer window purges less, the safe
 * direction for a deletion feature); everything else (0, negatives, NaN,
 * non-numbers) means OFF (null). Retention is opt-in — default off per the
 * Wave-3 contract.
 */
export function normalizeRetentionMonths(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null;
}

/** Load the persisted retention window (months), default off (null). */
export function loadRetentionMonths(): number | null {
  return normalizeRetentionMonths(loadV3<unknown>(V3_KEYS.retention, null));
}

/** Client-side rotation caps (blob-growth guard, plan §5). */
export const AUDIT_MAX_EVENTS = 500;
export const STAGE_EVENTS_MAX = 500;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Feature flag — default OFF. Rollback = flag off, nothing else. */
export function isV3Enabled(): boolean {
  return storage()?.getItem(V3_KEYS.flag) === 'on';
}

export function setV3Enabled(on: boolean): void {
  const s = storage();
  if (!s) return;
  if (on) s.setItem(V3_KEYS.flag, 'on');
  else s.removeItem(V3_KEYS.flag);
}

export function loadV3<T>(key: string, fallback: T): T {
  try {
    const s = storage();
    if (!s) return fallback;
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveV3(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage full or unavailable — never throw into UI paths
  }
}
