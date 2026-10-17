/**
 * React Native side of the runtime Server switch (see serverProfile.ts).
 *
 * The stored choice is read SYNCHRONOUSLY at first use because most API
 * modules compute their base URL when they load; a hot swap would leave the
 * axios clients, the Supabase client and open sockets on the old server. So a
 * change is persisted and the app reloads to apply it.
 *
 * Native modules are required lazily so this file (and apiBaseUrl.ts, which
 * imports it) still loads under `node --test`, where they do not exist. A read
 * that fails for any reason means Remote; nothing here throws at import time.
 */
import { Platform } from 'react-native';
import {
  buildLocalProfile,
  defaultLocalHost,
  isSwitchAvailable,
  resolveActiveProfile,
  runApplySteps,
  serializeLocalChoice,
  settleWithin,
  supabaseAuthStorageKey,
  validateLocalHost,
  type ApplyResult,
  type LocalEnv,
  type LocalProfile,
} from '@/lib/serverProfile';

const STORAGE_KEY = 'paymax_server_profile';

// Metro only inlines literal `process.env.EXPO_PUBLIC_X` reads, never a whole
// `process.env` object, so each template is read by name.
function localEnv(): LocalEnv {
  return {
    EXPO_PUBLIC_LOCAL_API_BASE_URL: process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL,
    EXPO_PUBLIC_LOCAL_CONNECT_API_HOST: process.env.EXPO_PUBLIC_LOCAL_CONNECT_API_HOST,
    EXPO_PUBLIC_LOCAL_SUPABASE_URL: process.env.EXPO_PUBLIC_LOCAL_SUPABASE_URL,
    EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY,
  };
}

function appEnv(): string | undefined {
  return process.env.EXPO_PUBLIC_APP_ENV;
}

/** True when this build exposes the switch (any non-production build). */
export function isServerSwitchAvailable(): boolean {
  return isSwitchAvailable(appEnv());
}

function readStoredRaw(): string | null {
  try {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    return SecureStore.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export type ServerOverride = LocalProfile;

let cached: { value: ServerOverride | null } | null = null;

/**
 * The active Local override, or null for Remote. Memoised at first read: the
 * value cannot change without a reload, which is how a change is applied.
 */
export function getActiveServerOverride(): ServerOverride | null {
  if (cached) return cached.value;
  let value: ServerOverride | null = null;
  try {
    const active = resolveActiveProfile({ appEnv: appEnv(), stored: readStoredRaw(), env: localEnv() });
    value = active.mode === 'local' ? active.profile : null;
  } catch {
    value = null;
  }
  cached = { value };
  return value;
}

/** Test seam: forget the memoised read. */
export function resetServerOverrideCache(): void {
  cached = null;
}

/** What the UI needs: the saved host (if any), the pre-fill, and whether Local can be chosen. */
export function getServerSwitchState(): {
  available: boolean;
  active: 'remote' | 'local';
  activeHost: string | null;
  defaultHost: string;
  localUnavailableReason: string | null;
} {
  const env = localEnv();
  const defaultHost = defaultLocalHost(Platform.OS, env);
  const probe = buildLocalProfile(env, defaultHost);
  const override = getActiveServerOverride();
  return {
    available: isServerSwitchAvailable(),
    active: override ? 'local' : 'remote',
    activeHost: override?.host ?? null,
    defaultHost,
    localUnavailableReason: probe.available ? null : probe.reason,
  };
}

/** The build-time Remote API base, shown/tested by the switch. Never user-typeable. */
export function getRemoteApiBase(): string {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
}

/** Builds the profile a host would produce, for Test connection before Apply. */
export function previewLocalProfile(host: string) {
  return buildLocalProfile(localEnv(), host);
}

async function persistRaw(raw: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (raw === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, raw);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  if (raw === null) await SecureStore.deleteItemAsync(STORAGE_KEY);
  else await SecureStore.setItemAsync(STORAGE_KEY, raw);
}

const SIGN_OUT_TIMEOUT_MS = 5000;

/**
 * Drops the CURRENT server's session (its tokens are worthless on the other
 * server and must not be sent there). The network sign-out is best effort and
 * bounded (an unreachable server must not trap the user), but removing the
 * persisted tokens is what matters: a failure there PROPAGATES so Apply stops
 * before saving the choice.
 */
async function clearCurrentSession(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createSupabaseClient, getSupabaseConfigStatus } = require('./supabase') as typeof import('./supabase');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deleteSecureItem } = require('./secureStorage') as typeof import('./secureStorage');
  const status = getSupabaseConfigStatus();

  if (status.hasConfig) {
    try {
      await settleWithin(createSupabaseClient().auth.signOut({ scope: 'local' }), SIGN_OUT_TIMEOUT_MS, null);
    } catch {
      // Network/server failure: the stored tokens are removed below regardless.
    }
  }

  const keys = ['access_token', 'refresh_token']; // legacy keys restoreSessionFromStoredTokens still adopts
  if (status.url) {
    const authKey = supabaseAuthStorageKey(status.url);
    if (!authKey) throw new Error('could not work out where the session is stored');
    keys.push(authKey);
  }
  for (const key of keys) await deleteSecureItem(key);

  // Carts, drafts and recents of the old server must not leak into the new one.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resetUserScopedState } = require('./resetUserScopedState') as typeof import('./resetUserScopedState');
  await resetUserScopedState();
}

/** Reloads the JS bundle. Throws if the platform cannot, so the UI can say so. */
async function reloadApp(): Promise<void> {
  if (Platform.OS === 'web') {
    window.location.reload();
    return;
  }
  if (__DEV__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DevSettings } = require('react-native') as typeof import('react-native');
    DevSettings.reload();
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Updates = require('expo-updates') as typeof import('expo-updates');
  await Updates.reloadAsync();
}

/**
 * validate -> clear the current session -> persist -> reload. Resolves with an
 * error (never throws, never swallows) so the caller can show it. Choosing
 * Remote clears the stored value.
 */
export async function applyServerProfile(
  choice: { mode: 'remote' } | { mode: 'local'; host: string },
): Promise<ApplyResult> {
  if (!isServerSwitchAvailable()) return { ok: false, error: 'The server switch is not available in this build.' };

  let raw: string | null = null;
  if (choice.mode === 'local') {
    const check = validateLocalHost(choice.host);
    if (!check.ok) return { ok: false, error: check.reason };
    const profile = buildLocalProfile(localEnv(), check.host);
    if (!profile.available) return { ok: false, error: profile.reason };
    raw = serializeLocalChoice(check.host);
  }

  return runApplySteps({
    clear: clearCurrentSession,
    persist: () => persistRaw(raw),
    reload: reloadApp,
  });
}

export type ReachResult = { reachable: boolean; url: string; detail: string };

/** GETs the URL with a 5s timeout. Any HTTP response, even 404, means reachable. */
export async function testConnection(url: string, timeoutMs = 5000): Promise<ReachResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // no-cors: on web a reachable server without CORS headers would otherwise look
    // like a network error. Native ignores it. status 0 = opaque (answered, unreadable).
    const res = await fetch(url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
    return { reachable: true, url, detail: res.status ? `HTTP ${res.status}` : 'server answered' };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { reachable: false, url, detail: aborted ? 'timed out after 5s' : 'no response' };
  } finally {
    clearTimeout(timer);
  }
}
