/**
 * V3 feature flag — Wave 0 scaffold (kanban-ui).
 *
 * Default OFF: the flag is only on when localStorage['revital_v3_flag'] === 'on'.
 * Dependency-free by design; platform-data's store may supersede this helper
 * in a later wave (charter, Wave 0 task 1).
 *
 * Safe in non-browser contexts (tests, SSR): if localStorage is unavailable
 * the flag reads as OFF and writes are no-ops.
 */

export const V3_FLAG_KEY = 'revital_v3_flag';

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Accessing localStorage can throw (privacy mode, sandboxed iframes).
  }
  return null;
}

/** True only when the V3 flag has been explicitly switched on. */
export function isV3Enabled(): boolean {
  return safeStorage()?.getItem(V3_FLAG_KEY) === 'on';
}

/**
 * Switch the V3 flag. `off` removes the key entirely so the stored state is
 * byte-identical to a browser that never touched V3 (flag-off = untouched).
 */
export function setV3Flag(on: boolean): void {
  const storage = safeStorage();
  if (!storage) return;
  if (on) {
    storage.setItem(V3_FLAG_KEY, 'on');
  } else {
    storage.removeItem(V3_FLAG_KEY);
  }
}
