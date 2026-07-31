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
} as const;

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
