/**
 * Dependency-free logic shared by the admin signup endpoint
 * (app/api/admin/signup/route.ts) and the login page's signup panel.
 *
 * Deliberately imports nothing — no Next, no Supabase — so a server route
 * handler and a browser component can both use it, and so the decisions that
 * matter (who may sign up, what they may be granted, what input is acceptable)
 * are unit-testable without a service-role key or a live project.
 */

/**
 * roles.slug values a signup may grant. This is the intersection of two sets:
 * roles that EXIST in the roles table (seeded by 20260527100000) and roles the
 * console actually admits (features/auth/adminAuth.ts). The table has no
 * 'admin' row at all — 'admin' is a user_profiles.role value, not an RBAC role,
 * so offering any other slug here would create an account that authenticates
 * against GoTrue and is then refused by the console's own gate.
 */
export const ADMIN_TIER_ROLE_SLUGS = ['super-admin', 'system-admin'] as const;
export type AdminTierRoleSlug = (typeof ADMIN_TIER_ROLE_SLUGS)[number];

export const ADMIN_TIER_ROLE_LABELS: Record<AdminTierRoleSlug, string> = {
  'super-admin': 'Super Admin — unrestricted',
  'system-admin': 'System Admin — users, roles, audit',
};

/**
 * The user_profiles.role every admin-tier account is written with.
 *
 * adminAuth.ts admits exactly 'admin' plus four finance_* roles, and compares
 * case-sensitively. Writing the tier ('super-admin') into this column would
 * lock the account out of the console even though GoTrue accepted it — the
 * account's TIER belongs in user_roles, which is what the Go backend reads.
 */
export const PROFILE_ROLE_FOR_ADMIN = 'admin';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_FULL_NAME_LENGTH = 120;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PERMISSION_GRANTS = 60;
/** Shorter codes are guessable by grinding the endpoint; refuse them outright. */
export const MIN_SIGNUP_CODE_LENGTH = 8;

export const PERMISSION_CATALOG_LIMIT = 1000;

export type SignupMode = 'session' | 'code' | 'bootstrap' | 'disabled';

export interface SignupInput {
  email: string;
  password: string;
  fullName: string;
  roleSlug: AdminTierRoleSlug;
  permissionSlugs: string[];
  setupCode: string;
}

export type ValidationResult =
  | { ok: true; value: SignupInput }
  | { ok: false; error: string };

/**
 * Who is allowed to create an admin account.
 *
 * Exactly one of four states, in priority order:
 *   session   — the caller already holds a verified admin session cookie; an
 *               authenticated admin vouching for a colleague beats any shared
 *               secret, and needs no code.
 *   code      — no session, but ADMIN_SIGNUP_CODE is configured on the server;
 *               the caller must present it.
 *   bootstrap — no session, no code, and the console has ZERO admins. The
 *               chicken-and-egg door: a fresh deploy needs some way to make its
 *               first admin. It self-closes the moment one exists.
 *   disabled  — everything else. Fail closed.
 *
 * `consoleAdminCount === null` means the lookup failed; that must NOT be read as
 * zero, or a transient database error would fling the bootstrap door open on a
 * console that already has admins.
 */
export function resolveSignupMode(opts: {
  hasValidSession: boolean;
  signupCodeConfigured: boolean;
  consoleAdminCount: number | null;
}): SignupMode {
  if (opts.hasValidSession) return 'session';
  if (opts.signupCodeConfigured) return 'code';
  if (opts.consoleAdminCount === 0) return 'bootstrap';
  return 'disabled';
}

/** True when the caller must supply the shared signup code. */
export function modeRequiresCode(mode: SignupMode): boolean {
  return mode === 'code';
}

export function isSignupModeOpen(mode: SignupMode): boolean {
  return mode !== 'disabled';
}

export type SignupCodeState = 'absent' | 'too-short' | 'usable';

/**
 * Classifies the CONFIGURED ADMIN_SIGNUP_CODE (the server's own value, not a
 * caller-supplied one). 'too-short' is tracked separately from 'absent'
 * because the operator who set a four-character code needs to be told it was
 * rejected for length — a bare "set ADMIN_SIGNUP_CODE" reads as a lie to
 * someone who just did exactly that and sends them hunting for a variable that
 * is present.
 */
export function classifySignupCode(raw: string): SignupCodeState {
  const code = raw.trim();
  if (!code) return 'absent';
  return code.length >= MIN_SIGNUP_CODE_LENGTH ? 'usable' : 'too-short';
}

/**
 * The configured code when it is usable, else ''.
 *
 * Both the mode decision and the POST comparison must read the code through
 * this: a one-character ADMIN_SIGNUP_CODE would otherwise switch the public
 * `code` path ON while being guessable in a handful of requests, so the
 * endpoint would look gated and not be. Emptying it makes the mode fall through
 * to bootstrap (zero admins, self-closing) or disabled (fail closed) instead.
 */
export function sanitizeSignupCode(raw: string): string {
  return classifySignupCode(raw) === 'usable' ? raw.trim() : '';
}

/**
 * The disabled-mode explanation, refined by WHY signup is closed. A rejected
 * code is named as such rather than reported as missing.
 */
export function describeDisabledSignup(codeState: SignupCodeState): string {
  if (codeState === 'too-short') {
    return `ADMIN_SIGNUP_CODE is set but shorter than ${MIN_SIGNUP_CODE_LENGTH} characters, so this server refuses it. Use a longer code, or sign in as an existing admin.`;
  }
  return describeSignupMode('disabled');
}

/**
 * Length-independent, branch-free-ish comparison, so a wrong code cannot be
 * narrowed down by timing how long the rejection took. Plain !== would return
 * at the first differing byte.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

export function normalizeFullName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_FULL_NAME_LENGTH);
}

/**
 * platform_users.first_name / last_name are both NOT NULL, so a single-field
 * form has to be split into two. An empty full name falls back to the email's
 * local part rather than an empty string, so the RBAC rows stay legible.
 */
export function splitFullName(email: string, fullName: string): { firstName: string; lastName: string } {
  const cleaned = normalizeFullName(fullName);
  if (!cleaned) {
    const local = (email.split('@')[0] || 'admin').slice(0, 80);
    return { firstName: local, lastName: 'Admin' };
  }
  const idx = cleaned.indexOf(' ');
  if (idx === -1) return { firstName: cleaned, lastName: '' };
  return { firstName: cleaned.slice(0, idx), lastName: cleaned.slice(idx + 1) };
}

export function isAdminTierRoleSlug(slug: string): slug is AdminTierRoleSlug {
  return (ADMIN_TIER_ROLE_SLUGS as readonly string[]).includes(slug);
}

/**
 * Trims, de-duplicates and bounds a caller-supplied slug list, so an arbitrary
 * string cannot be smuggled in and a thousand-element array cannot be walked.
 *
 * Existence is NOT decided here: this project has more permissions than the
 * catalog endpoint returns in one page (351 vs a 200-row page), so a local
 * allow-list would silently reject valid slugs that simply fell off the end.
 * The database is asked about the requested slugs instead.
 */
export function normalizePermissionSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const slug = item.trim();
    if (!slug || out.includes(slug)) continue;
    out.push(slug);
    if (out.length >= MAX_PERMISSION_GRANTS) break;
  }
  return out;
}

export function validateSignupInput(raw: unknown): ValidationResult {
  const body = (raw ?? {}) as Record<string, unknown>;

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!email) return { ok: false, error: 'An email address is required.' };
  if (!isValidEmail(email)) return { ok: false, error: 'That does not look like a valid email address.' };

  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: 'Password must contain at least one letter and one number.' };
  }

  const roleSlug = typeof body.roleSlug === 'string' ? body.roleSlug.trim() : '';
  if (!isAdminTierRoleSlug(roleSlug)) {
    return { ok: false, error: 'Choose a valid admin role.' };
  }

  const setupCode = typeof body.setupCode === 'string' ? body.setupCode : '';

  return {
    ok: true,
    value: {
      email,
      password,
      fullName: normalizeFullName(typeof body.fullName === 'string' ? body.fullName : ''),
      roleSlug,
      permissionSlugs: Array.isArray(body.permissionSlugs)
        ? (body.permissionSlugs.filter((s): s is string => typeof s === 'string'))
        : [],
      setupCode,
    },
  };
}

/**
 * GoTrue's duplicate-email rejection is a message, not a code, and the wording
 * has moved between versions. Matching variants beats coupling to one string.
 */
export function isDuplicateEmailError(message: string): boolean {
  return /already\s+(been\s+)?(registered|exists)|email_exists|duplicate/i.test(message);
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
}

/**
 * Reads `sub` out of an already-VERIFIED token — callers must run
 * isSessionValid() first. This is attribution for the audit trail, never
 * authorization: nothing here is trusted to admit a request.
 */
export function decodeJwtSubject(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface SignupRoleOption {
  slug: string;
  name: string;
  description: string;
}

export interface SignupPermissionOption {
  slug: string;
  name: string;
  module: string;
  description: string;
}

/** Human-facing status line for a resolved mode; also used by the UI. */
export function describeSignupMode(mode: SignupMode): string {
  switch (mode) {
    case 'session':
      return 'You are signed in, so no setup code is needed.';
    case 'code':
      return 'A setup code is required (ADMIN_SIGNUP_CODE is configured on the server).';
    case 'bootstrap':
      return 'No admin account exists yet on this console — this first one needs no setup code.';
    case 'disabled':
      return 'Admin signup is disabled. Set ADMIN_SIGNUP_CODE on the server, or sign in as an existing admin.';
  }
}
