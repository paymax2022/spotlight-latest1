/**
 * Pure logic for the runtime Server switch (Remote / Local).
 *
 * Remote is today's build-time configuration and is NEVER user-typeable. Local
 * is a set of build-time URL templates (EXPO_PUBLIC_LOCAL_*) whose HOSTNAME the
 * developer may edit on the device, so one build can reach either the remote
 * server or a dev machine on the LAN.
 *
 * Security: whatever host is typed ends up in request URLs that carry the
 * signed-in user's tokens, so it must be impossible to point the app at a
 * machine an attacker controls. The validator therefore allows only loopback,
 * RFC 1918 private IPv4, `.local` names and `::1`, and the stored value is
 * re-validated every time it is read. No URL is ever taken from storage, only
 * a host, which is spliced into the build-time templates.
 *
 * Kept free of react-native/expo imports so `node --test` specs can load it.
 */

export type ServerMode = 'remote' | 'local';

/** The build-time Local templates, keyed by their EXPO_PUBLIC_ names. */
export interface LocalEnv {
  EXPO_PUBLIC_LOCAL_API_BASE_URL?: string;
  EXPO_PUBLIC_LOCAL_CONNECT_API_HOST?: string;
  EXPO_PUBLIC_LOCAL_SUPABASE_URL?: string;
  EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY?: string;
}

export type HostCheck = { ok: true; host: string } | { ok: false; reason: string };

export interface LocalProfile {
  available: true;
  host: string;
  apiBase: string;
  connectHost: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export type LocalProfileResult = LocalProfile | { available: false; reason: string };

export type ActiveProfile = { mode: 'remote' } | { mode: 'local'; profile: LocalProfile };

export const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:3000';
export const DEFAULT_LOCAL_CONNECT_API_HOST = 'http://localhost:8091';
export const DEFAULT_LOCAL_SUPABASE_URL = 'http://localhost:54321';
/** An Android emulator reaches the host machine's loopback through this alias. */
export const ANDROID_EMULATOR_HOST = '10.0.2.2';

// Allowlist, fail-closed: an unset, empty or unrecognised EXPO_PUBLIC_APP_ENV
// ('prd', 'live', 'release', 'Production', ...) is treated as production, so a
// typo can only hide the switch, never expose it in a shipped build.
const SWITCH_ENVIRONMENTS = new Set(['development', 'dev', 'staging', 'test', 'local']);

/**
 * The switch exists only in an explicitly non-production build. Matching is
 * exact and case-sensitive after trimming whitespace (' staging ' counts).
 */
export function isSwitchAvailable(appEnv: string | undefined): boolean {
  return typeof appEnv === 'string' && SWITCH_ENVIRONMENTS.has(appEnv.trim());
}

const MAX_HOST_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// Strictly four decimal octets with no leading zeros ("010" is octal to some stacks).
const IPV4 = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

/**
 * Accepts only a bare host that names a local machine. Rejects everything
 * else, including values other validators normalise rather than refuse
 * (whitespace, schemes, ports, userinfo, numeric IP tricks, uppercase,
 * trailing dots), because a lenient parser is exactly what a spoof exploits.
 */
export function validateLocalHost(host: unknown): HostCheck {
  if (typeof host !== 'string') return { ok: false, reason: 'Enter a host.' };
  if (host.length === 0) return { ok: false, reason: 'Enter a host.' };
  if (host.length > MAX_HOST_LENGTH) return { ok: false, reason: 'That host is too long.' };

  if (host === '::1' || host === 'localhost') return { ok: true, host };

  if (/[\s\u0000]/.test(host)) return { ok: false, reason: 'A host cannot contain spaces.' };
  if (/[:/@?#\\[\]]/.test(host)) {
    return { ok: false, reason: 'Enter only the host, without http://, a port, a path or an @.' };
  }
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return { ok: false, reason: 'Use lowercase letters, digits, dots and hyphens only.' };
  }

  // Anything made only of digits and dots must be a canonical IPv4 address.
  if (/^[0-9.]+$/.test(host)) {
    const m = IPV4.exec(host);
    if (!m) return { ok: false, reason: 'Enter a full IPv4 address such as 192.168.1.5.' };
    const [a, b] = [Number(m[1]), Number(m[2])];
    const octets = [m[1], m[2], m[3], m[4]].map(Number);
    if (octets.some((o) => o > 255)) return { ok: false, reason: 'IPv4 numbers go up to 255.' };
    const local =
      a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return local
      ? { ok: true, host }
      : { ok: false, reason: 'Only a local or private network address is allowed.' };
  }

  const labels = host.split('.');
  if (labels.length >= 2 && labels[labels.length - 1] === 'local') {
    const valid = labels.every((l) => l.length <= MAX_LABEL_LENGTH && DNS_LABEL.test(l));
    if (valid) return { ok: true, host };
    return { ok: false, reason: 'That is not a valid .local name.' };
  }

  return { ok: false, reason: 'Only localhost, a private IP address or a .local name is allowed.' };
}

// scheme://host[:port][/]   (no userinfo, path, query or fragment; port 1-65535, no leading zero)
const TEMPLATE = /^(https?):\/\/(\[[0-9a-fA-F:]+\]|[^\s/:@?#\[\]\\]+)(:[1-9]\d{0,4})?\/?$/;

function matchTemplate(template: unknown): RegExpExecArray | null {
  const m = TEMPLATE.exec(typeof template === 'string' ? template : '');
  if (!m) return null;
  if (m[3] && Number(m[3].slice(1)) > 65535) return null;
  return m;
}

/**
 * Replaces the hostname of a build-time template URL, keeping scheme and port.
 * Returns null when the host is not allowed or the template is not a
 * plain http(s) URL, so callers cannot accidentally build an unchecked URL.
 */
export function applyHostToTemplate(template: string, host: string): string | null {
  const check = validateLocalHost(host);
  if (!check.ok) return null;
  const m = matchTemplate(template);
  if (!m) return null;
  const hostPart = check.host.includes(':') ? `[${check.host}]` : check.host;
  return `${m[1]}://${hostPart}${m[3] ?? ''}`;
}

function templateHost(template: string | undefined): string | null {
  const m = matchTemplate(template);
  if (!m) return null;
  return m[2].startsWith('[') ? m[2].slice(1, -1) : m[2];
}

/**
 * The host to pre-fill. An Android emulator cannot be detected reliably, so
 * Android defaults to the emulator alias; a physical phone needs the LAN IP
 * typed. Web and iOS use the template's own host.
 */
export function defaultLocalHost(platformOS: string, env: LocalEnv): string {
  if (platformOS === 'android') return ANDROID_EMULATOR_HOST;
  const fromTemplate = templateHost(env.EXPO_PUBLIC_LOCAL_API_BASE_URL ?? DEFAULT_LOCAL_API_BASE_URL);
  return fromTemplate && validateLocalHost(fromTemplate).ok ? fromTemplate : 'localhost';
}

/** Local needs its own Supabase anon key: local tokens are only valid there. */
export function buildLocalProfile(env: LocalEnv, host: string): LocalProfileResult {
  const anonKey = env.EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) {
    return {
      available: false,
      reason: 'Local is unavailable: this build has no EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY.',
    };
  }
  const check = validateLocalHost(host);
  if (!check.ok) return { available: false, reason: check.reason };

  const apiBase = applyHostToTemplate(env.EXPO_PUBLIC_LOCAL_API_BASE_URL || DEFAULT_LOCAL_API_BASE_URL, host);
  const connectHost = applyHostToTemplate(
    env.EXPO_PUBLIC_LOCAL_CONNECT_API_HOST || DEFAULT_LOCAL_CONNECT_API_HOST,
    host,
  );
  const supabaseUrl = applyHostToTemplate(env.EXPO_PUBLIC_LOCAL_SUPABASE_URL || DEFAULT_LOCAL_SUPABASE_URL, host);
  if (!apiBase || !connectHost || !supabaseUrl) {
    return { available: false, reason: 'Local is unavailable: a EXPO_PUBLIC_LOCAL_* URL is malformed.' };
  }
  return { available: true, host: check.host, apiBase, connectHost, supabaseUrl, supabaseAnonKey: anonKey };
}

export interface StoredChoice {
  mode: 'local';
  host: string;
}

/** Only a Local choice is ever stored; choosing Remote clears the stored value. */
export function serializeLocalChoice(host: string): string {
  const check = validateLocalHost(host);
  if (!check.ok) throw new Error(check.reason);
  return JSON.stringify({ mode: 'local', host: check.host });
}

/** Parses and re-validates a stored value; anything unexpected is null (= Remote). */
export function parseStoredChoice(raw: string | null | undefined): StoredChoice | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { mode, host } = parsed as { mode?: unknown; host?: unknown };
  if (mode !== 'local') return null;
  const check = validateLocalHost(host);
  return check.ok ? { mode: 'local', host: check.host } : null;
}

/**
 * Production ignores any stored value. Otherwise a valid stored Local choice
 * whose profile is available wins; every other case is Remote (build-time env).
 */
export function resolveActiveProfile(args: {
  appEnv: string | undefined;
  stored: string | null | undefined;
  env: LocalEnv;
}): ActiveProfile {
  if (!isSwitchAvailable(args.appEnv)) return { mode: 'remote' };
  const choice = parseStoredChoice(args.stored);
  if (!choice) return { mode: 'remote' };
  const profile = buildLocalProfile(args.env, choice.host);
  return profile.available ? { mode: 'local', profile } : { mode: 'remote' };
}

/**
 * supabase-js stores the session under `sb-<first hostname label>-auth-token`.
 * Null when the URL has no usable hostname.
 */
export function supabaseAuthStorageKey(url: string): string | null {
  const m = /^https?:\/\/(\[[0-9a-fA-F:]+\]|[^\s/:@?#\[\]\\]+)/.exec(typeof url === 'string' ? url : '');
  if (!m || m[1].startsWith('[')) return null;
  const label = m[1].split('.')[0];
  return label ? `sb-${label}-auth-token` : null;
}

export type ApplyResult = { ok: true } | { ok: false; error: string };

/**
 * The apply ordering, kept pure so it is testable: clear the current session,
 * then persist, then reload. A failed clear or persist stops the sequence (the
 * choice must not be saved while the old server's tokens may remain); a failed
 * reload still leaves the choice saved, so the user is told to restart.
 */
export async function runApplySteps(steps: {
  clear: () => Promise<void>;
  persist: () => Promise<void>;
  reload: () => Promise<void>;
}): Promise<ApplyResult> {
  try {
    await steps.clear();
  } catch (err) {
    return { ok: false, error: `Could not sign out of the current server: ${errorText(err)}` };
  }
  try {
    await steps.persist();
  } catch (err) {
    return { ok: false, error: `Could not save the server choice: ${errorText(err)}` };
  }
  try {
    await steps.reload();
  } catch {
    return { ok: false, error: 'Saved. Close and reopen the app to apply.' };
  }
  return { ok: true };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'unexpected error';
}

/** Resolves with the promise, or with `onTimeout` after `ms` (never rejects on timeout). */
export function settleWithin<T, U>(p: Promise<T>, ms: number, onTimeout: U): Promise<T | U> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<U>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
