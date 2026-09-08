// Where mock data is permitted at all.
//
// Rule: staging and production NEVER serve mock data, whatever a per-module flag
// says. Fake data that appears silently is worse than an empty screen or an
// error — nobody goes looking for a bug they cannot see, and a voter shown
// invented vote packages can be walked into a checkout for a price that does
// not exist.
//
// Local development keeps its existing per-module defaults, because several
// modules genuinely have no live endpoint yet and mocking them is deliberate.
// This only removes the possibility of that leaking into a deployed environment.

const MOCKLESS_ENVIRONMENTS = new Set(['staging', 'production', 'prod']);

/** True when this build is a deployed environment that must show only real data. */
export function isMocklessEnvironment(): boolean {
  const env = String(process.env.EXPO_PUBLIC_APP_ENV ?? 'development').trim().toLowerCase();
  return MOCKLESS_ENVIRONMENTS.has(env);
}

/**
 * Resolve a module's mock switch under that rule.
 *
 * @param flagValue    the raw EXPO_PUBLIC_*_USE_MOCK value for the module
 * @param defaultWhenUnset  what the module does locally when nobody set the flag.
 *        Pass `false` for modules whose live endpoints exist — then a forgotten
 *        flag fails visibly against the real backend instead of inventing data.
 */
export function mockAllowed(flagValue: string | undefined, defaultWhenUnset: boolean): boolean {
  if (isMocklessEnvironment()) return false;
  const raw = flagValue?.trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return defaultWhenUnset;
}
