import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSessionValid, resolveEnforce, SESSION_COOKIE } from '../../../../middleware';
import {
  ADMIN_TIER_ROLE_LABELS,
  ADMIN_TIER_ROLE_SLUGS,
  MAX_PERMISSION_GRANTS,
  MIN_PASSWORD_LENGTH,
  PERMISSION_CATALOG_LIMIT,
  PROFILE_ROLE_FOR_ADMIN,
  classifySignupCode,
  constantTimeEqual,
  decodeJwtSubject,
  describeDisabledSignup,
  describeSignupMode,
  isAdminTierRoleSlug,
  isDuplicateEmailError,
  modeRequiresCode,
  normalizeFullName,
  normalizePermissionSlugs,
  resolveSignupMode,
  sanitizeSignupCode,
  splitFullName,
  validateSignupInput,
  type SignupCodeState,
  type SignupPermissionOption,
  type SignupRoleOption,
} from '@/features/auth/adminSignupShared';

/**
 * Admin account self-service: creates a console-capable account and grants it
 * the chosen role + optional granular permissions.
 *
 * WHY THIS LIVES HERE AND NOT UNDER /admin/*: middleware.ts matches
 * '/admin/:path*' only, so this endpoint is not covered by the page gate and
 * gates itself (same situation as /api/admin-proxy). It also cannot require a
 * session unconditionally — the whole point is to work on the LOGIN page,
 * before anyone is signed in. See resolveSignupMode() for the four allowed
 * states; it fails closed.
 *
 * FOUR WRITES, because a console login has to pass four independent layers and
 * provisioning one says nothing about the others:
 *   1. auth.users (GoTrue credential — otherwise there is nothing to sign in as)
 *   2. user_profiles.role = 'admin' (the console's own gate in adminAuth.ts)
 *   3. platform_users.status = 'active' (checked BEFORE GoTrue, denies at login)
 *   4. user_roles grant (Go-backend RBAC — without it the console loads and every
 *      admin API call 403s)
 * A failure after step 1 deletes the auth user again, so a half-provisioned
 * account cannot linger as a login that always fails at a later layer.
 *
 * The service-role key is read at RUNTIME from the environment and never
 * returned, logged, or embedded in an error message. The new account's password
 * is passed to GoTrue and then dropped — it is not stored, echoed, or audited.
 */
export const dynamic = 'force-dynamic';

const SIGNUP_CODE_ENV = 'ADMIN_SIGNUP_CODE';

let _supabase: SupabaseClient | null = null;

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!_supabase) {
    _supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

/** The configured ADMIN_SIGNUP_CODE, or '' when it is unusable (too short). */
function configuredSignupCode(): string {
  return sanitizeSignupCode(process.env[SIGNUP_CODE_ENV] ?? '');
}

function extractSessionToken(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

/** Only values an `inet` column will accept — a bad header must not fail the insert. */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim() ?? '';
  if (!first || !/^[0-9a-fA-F:.]{3,45}$/.test(first)) return null;
  return first;
}

async function sessionState(request: Request): Promise<{ present: boolean; userId: string | null }> {
  if (!resolveEnforce(process.env.ADMIN_MIDDLEWARE_ENFORCE)) {
    return { present: false, userId: null };
  }
  const token = extractSessionToken(request.headers.get('cookie'));
  if (!(await isSessionValid(token))) return { present: false, userId: null };
  return { present: true, userId: decodeJwtSubject(token) };
}

async function consoleAdminCount(sb: SupabaseClient): Promise<number | null> {
  const { count, error } = await sb
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', PROFILE_ROLE_FOR_ADMIN);
  if (error) return null;
  return count ?? null;
}

async function resolveMode(request: Request): Promise<{
  mode: ReturnType<typeof resolveSignupMode>;
  actorUserId: string | null;
  serviceReady: boolean;
  codeState: SignupCodeState;
}> {
  const sb = serviceClient();
  const session = await sessionState(request);
  // No service client means the count cannot be read; null (not 0) keeps the
  // bootstrap door shut rather than opening it on an outage.
  const count = sb ? await consoleAdminCount(sb) : null;
  // Read through the sanitizer, so a code below MIN_SIGNUP_CODE_LENGTH counts
  // as NOT configured — it must not switch the public code path on.
  const codeState = classifySignupCode(process.env[SIGNUP_CODE_ENV] ?? '');
  const mode = resolveSignupMode({
    hasValidSession: session.present,
    // An unenforceable session (middleware off) must not count as a vouch.
    signupCodeConfigured: codeState === 'usable',
    consoleAdminCount: count,
  });
  return { mode, actorUserId: session.present ? session.userId : null, serviceReady: sb !== null, codeState };
}

function roleOptions(rows: { slug: string; name: string; description: string | null }[] | null): SignupRoleOption[] {
  const bySlug = new Map((rows ?? []).map((r) => [r.slug, r]));
  return ADMIN_TIER_ROLE_SLUGS.map((slug) => {
    const row = bySlug.get(slug);
    return {
      slug,
      name: row?.name ?? ADMIN_TIER_ROLE_LABELS[slug],
      description: row?.description ?? '',
    };
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const { mode, serviceReady, codeState } = await resolveMode(request);

  if (mode === 'disabled') {
    const reason = !serviceReady
      ? 'This server has no SUPABASE_SERVICE_ROLE_KEY configured, so it cannot create accounts.'
      : describeDisabledSignup(codeState);
    return NextResponse.json({
      ok: true,
      enabled: false,
      mode,
      requiresCode: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      roles: [],
      permissions: [],
      message: reason,
    });
  }

  const sb = serviceClient();
  if (!sb) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      mode: 'disabled' as const,
      requiresCode: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      roles: [],
      permissions: [],
      message: 'This server has no SUPABASE_SERVICE_ROLE_KEY configured, so it cannot create accounts.',
    });
  }

  const [rolesRes, permsRes] = await Promise.all([
    sb.from('roles').select('slug,name,description').in('slug', [...ADMIN_TIER_ROLE_SLUGS]).eq('is_active', true),
    sb
      .from('permissions')
      .select('slug,name,module,description')
      .order('module', { ascending: true })
      .order('slug', { ascending: true })
      .limit(PERMISSION_CATALOG_LIMIT),
  ]);

  const permissions: SignupPermissionOption[] = (permsRes.data ?? []).map((p) => ({
    slug: p.slug as string,
    name: (p.name as string) ?? (p.slug as string),
    module: (p.module as string) ?? 'general',
    description: (p.description as string) ?? '',
  }));

  return NextResponse.json({
    ok: true,
    enabled: true,
    mode,
    requiresCode: modeRequiresCode(mode),
    minPasswordLength: MIN_PASSWORD_LENGTH,
    roles: roleOptions(rolesRes.data as { slug: string; name: string; description: string | null }[] | null),
    permissions,
    maxPermissionGrants: MAX_PERMISSION_GRANTS,
    message: describeSignupMode(mode),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const sb = serviceClient();
  if (!sb) {
    return NextResponse.json(
      { ok: false, error: 'This server cannot create accounts (no service credentials configured).' },
      { status: 503 },
    );
  }

  const { mode, actorUserId, codeState } = await resolveMode(request);
  if (mode === 'disabled') {
    return NextResponse.json({ ok: false, error: describeDisabledSignup(codeState) }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body.' }, { status: 400 });
  }

  const validated = validateSignupInput(rawBody);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }
  const input = validated.value;

  if (modeRequiresCode(mode)) {
    const expected = configuredSignupCode();
    if (!input.setupCode || !constantTimeEqual(input.setupCode, expected)) {
      return NextResponse.json({ ok: false, error: 'Invalid setup code.' }, { status: 403 });
    }
  }

  // The permission list is caller-supplied, so every slug is looked up rather
  // than trusted: only rows that actually exist can be granted, and anything
  // that does not exist is reported back instead of silently disappearing.
  const permissionSlugs = normalizePermissionSlugs(input.permissionSlugs);

  const fullName = normalizeFullName(input.fullName);
  const { firstName, lastName } = splitFullName(input.email, fullName);

  const created = await sb.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    // handle_new_user() copies raw_user_meta_data.role into user_profiles.role;
    // it is written explicitly below too, so this is belt and braces for the
    // case where the trigger is absent or has been replaced.
    user_metadata: { full_name: fullName, role: PROFILE_ROLE_FOR_ADMIN },
  });

  if (created.error || !created.data?.user) {
    const message = created.error?.message ?? '';
    if (isDuplicateEmailError(message)) {
      return NextResponse.json(
        { ok: false, error: 'An account with that email already exists.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: `Could not create the account: ${message || 'unknown error'}` },
      { status: 502 },
    );
  }

  const userId = created.data.user.id;

  const rollback = async (error: string, status: number): Promise<NextResponse> => {
    // Leaving the auth row behind would be worse than useless: the account would
    // sign in against GoTrue and then be refused by a later layer, with no way
    // to tell why. Remove it so the attempt is cleanly retryable.
    try {
      await sb.auth.admin.deleteUser(userId);
    } catch {
      /* best effort — the 500 below is the important part */
    }
    return NextResponse.json({ ok: false, error }, { status });
  };

  const { error: profileError } = await sb.from('user_profiles').upsert(
    {
      id: userId,
      email: input.email,
      full_name: fullName,
      role: PROFILE_ROLE_FOR_ADMIN,
    },
    { onConflict: 'id' },
  );
  if (profileError) {
    return rollback(`The account was created but its console profile failed: ${profileError.message}`, 500);
  }

  // The bridge trigger normally inserts this row on auth.users insert, but it
  // swallows its own errors by design — so never assume it ran.
  const existingPlatform = await sb.from('platform_users').select('id').eq('id', userId).maybeSingle();
  const platformPayload = {
    first_name: firstName,
    last_name: lastName,
    email: input.email,
    status: 'active' as const,
    email_verified_at: new Date().toISOString(),
  };
  const { error: platformError } = existingPlatform.data
    ? await sb.from('platform_users').update({ ...platformPayload, updated_at: new Date().toISOString() }).eq('id', userId)
    : await sb.from('platform_users').insert({ id: userId, user_type: 'registered_user', ...platformPayload });
  if (platformError) {
    return rollback(`The account was created but its platform record failed: ${platformError.message}`, 500);
  }

  const roleRes = await sb.from('roles').select('id,slug').eq('slug', input.roleSlug).eq('is_active', true).maybeSingle();
  if (!roleRes.data) {
    return rollback(`The role '${input.roleSlug}' does not exist on this deployment.`, 500);
  }

  // A global grant carries scope_id NULL, and NULLs are distinct in the unique
  // index — ON CONFLICT can never fire here, so existence is checked explicitly.
  const existingGrant = await sb
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role_id', roleRes.data.id)
    .eq('scope_type', 'global')
    .is('scope_id', null)
    .maybeSingle();

  const { error: grantError } = existingGrant.data
    ? await sb
        .from('user_roles')
        .update({ is_active: true, assigned_by: actorUserId, updated_at: new Date().toISOString() })
        .eq('id', existingGrant.data.id)
    : await sb.from('user_roles').insert({
        user_id: userId,
        role_id: roleRes.data.id,
        scope_type: 'global',
        scope_id: null,
        is_active: true,
        assigned_by: actorUserId,
      });
  if (grantError) {
    return rollback(`The account was created but the '${input.roleSlug}' role grant failed: ${grantError.message}`, 500);
  }

  const grantedPermissions: string[] = [];
  const permissionWarnings: string[] = [];
  if (permissionSlugs.length > 0) {
    const permRows = await sb.from('permissions').select('id,slug').in('slug', permissionSlugs);
    const known = new Set((permRows.data ?? []).map((p) => p.slug as string));
    for (const slug of permissionSlugs) {
      if (!known.has(slug)) permissionWarnings.push(`${slug}: not a permission on this deployment`);
    }
    for (const perm of permRows.data ?? []) {
      const permId = perm.id as string;
      const existingPerm = await sb
        .from('user_permissions')
        .select('id')
        .eq('user_id', userId)
        .eq('permission_id', permId)
        .eq('effect', 'allow')
        .eq('scope_type', 'global')
        .is('scope_id', null)
        .maybeSingle();
      if (existingPerm.data) {
        grantedPermissions.push(perm.slug as string);
        continue;
      }
      const { error: permError } = await sb.from('user_permissions').insert({
        user_id: userId,
        permission_id: permId,
        effect: 'allow',
        scope_type: 'global',
        scope_id: null,
        reason: 'Granted when the account was created',
        assigned_by: actorUserId,
      });
      if (permError) permissionWarnings.push(`${perm.slug}: ${permError.message}`);
      else grantedPermissions.push(perm.slug as string);
    }
  }

  // Non-fatal: the account is fully usable without an audit row, and failing the
  // request here would strand a working account behind an error message.
  try {
    await sb.from('audit_logs').insert({
      actor_user_id: actorUserId,
      target_user_id: userId,
      action: 'admin.account.create',
      module: 'admin',
      resource_type: 'user',
      resource_id: userId,
      new_values: {
        email: input.email,
        full_name: fullName,
        profile_role: PROFILE_ROLE_FOR_ADMIN,
        role_slug: input.roleSlug,
        extra_permissions: grantedPermissions,
        via: mode,
      },
      ip_address: clientIp(request),
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      severity: 'warning',
    });
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: true,
    user: { id: userId, email: input.email },
    profileRole: PROFILE_ROLE_FOR_ADMIN,
    roleSlug: input.roleSlug,
    extraPermissions: grantedPermissions,
    via: mode,
    warnings: permissionWarnings,
  });
}
