/**
 * Module visibility for the web app (server-side).
 *
 * The Go registry decides which modules this environment may show. This reads it
 * once per interval and combines it with the existing FEATURE_* flags, so both
 * gates apply and neither is bypassed:
 *
 *   visible = featureFlags[key]()   (ops kill switch, per deployment)
 *         AND registry says visible (admin publication, per environment)
 *
 * Fetched server-side so the module list is never shipped to the browser — a
 * public list of unpublished modules would advertise unreleased work.
 */

import { featureFlags, type FeatureName } from '@/src/lib/feature-flags';

const GO_BACKEND = process.env.GO_BACKEND_URL || 'http://localhost:8080';
const TTL_MS = 60_000;

let cache: { at: number; keys: Set<string> | null } = { at: 0, keys: null };

/**
 * Published module keys for this environment, or null when the registry could
 * not be read. Null means "unknown", never "none" — see isModuleVisible.
 */
export async function publishedModules(): Promise<Set<string> | null> {
  const now = Date.now();
  if (cache.keys && now - cache.at < TTL_MS) return cache.keys;

  try {
    const res = await fetch(`${GO_BACKEND}/api/v1/modules/visibility`, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return cache.keys;
    const body = (await res.json()) as { data?: { modules?: unknown } };
    const list = body?.data?.modules;
    if (!Array.isArray(list)) return cache.keys;
    cache = { at: now, keys: new Set(list.map(String)) };
    return cache.keys;
  } catch {
    // Serve the last good answer if we have one; otherwise "unknown".
    return cache.keys;
  }
}

/**
 * Whether a module should be rendered.
 *
 * The ops flag is authoritative and checked first: if it is off, no admin
 * publication can bring the module back. That ordering is what keeps the
 * registry additive rather than an override of ops decisions.
 *
 * An unreachable registry falls back to the ops flag alone. Blanking the site
 * because a lookup failed would be a worse outcome than briefly showing a module
 * whose publication we could not confirm — and anything genuinely sensitive is
 * gated by the API, not by whether a link renders.
 */
export async function isModuleVisible(key: FeatureName): Promise<boolean> {
  const flag = featureFlags[key];
  if (typeof flag === 'function' && !flag()) return false;

  const published = await publishedModules();
  if (published === null) return true;
  return published.has(key);
}

/** Test seam: drop the cached list so the next call refetches. */
export function __resetModuleVisibilityCache(): void {
  cache = { at: 0, keys: null };
}
