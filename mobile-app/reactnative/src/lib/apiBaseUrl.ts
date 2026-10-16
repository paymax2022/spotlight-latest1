/**
 * Single resolution point for EXPO_PUBLIC_API_BASE_URL (AUD-FE-001).
 *
 * The eas.json `production` profile carried no API base URL for a long time,
 * so release builds silently baked `http://localhost:3000` — the user's own
 * device — and every backend call failed. Connect hit the same bug class with
 * `localhost:8091` (see connect.constants.ts). This helper keeps the
 * per-module fallback for dev convenience but makes a missing variable loud
 * in non-dev builds instead of silently shipping a dead client.
 *
 * A Local server override (see serverProfile.ts, non-production builds only)
 * wins over everything here; with none stored behaviour is unchanged.
 *
 * Kept free of react-native/expo imports so `node --test` specs can load it
 * (serverProfileStore loads its native modules lazily).
 */
import { getActiveServerOverride } from '@/lib/serverProfileStore';

export function resolveApiBaseUrl(fallback = 'http://localhost:3000'): string {
  const override = getActiveServerOverride();
  if (override) return override.apiBase;

  const configured = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (configured) return configured;

  const isDev =
    typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (!isDev) {
    console.error(
      `[api] EXPO_PUBLIC_API_BASE_URL is unset in this build — API calls will target ` +
        `${fallback} (the device's own loopback) and fail. Set it in eas.json or the ` +
        `EAS project environment.`
    );
  }
  return fallback;
}

/**
 * Host of the Go backend that Connect talks to directly. A Local override beats
 * EXPO_PUBLIC_CONNECT_API_HOST so the two backends never end up on different
 * servers; otherwise: explicit env, then the main API base (see
 * connect.constants.ts for the history).
 */
export function resolveConnectHost(fallback?: string): string {
  const override = getActiveServerOverride();
  if (override) return override.connectHost;
  return process.env.EXPO_PUBLIC_CONNECT_API_HOST ?? resolveApiBaseUrl(fallback);
}
