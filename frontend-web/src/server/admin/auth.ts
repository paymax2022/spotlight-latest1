import { ApiError } from '@/src/lib/api/responses';
import {
  hasPermission,
  parseAdminRole,
  resolveAdminRoleFromRbacSlugs,
  roleIsSubset,
  type AdminPermission,
} from '@/src/server/admin/rbac';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export interface AdminIdentity {
  role: ReturnType<typeof parseAdminRole>;
  actorId: string;
}

// E2E-SEC-053: the authoritative admin-role store is public.user_roles →
// public.roles.slug — the SAME source the Go backend's RBAC enforces
// (rbac.GetUserRoles, backend/internal/repositories/rbac_supabase_repository.go:
// user_roles?select=roles!inner(slug)&user_id=eq.<id>&is_active=eq.true).
// user_profiles.role is user-writable profile data (it was self-assignable via
// PUT /api/me/profile) and user_metadata is self-editable — NEITHER may grant
// admin access. Read with the service-role client: these routes are called
// cross-origin with a Bearer token and no session cookies, so the RLS-scoped
// client silently returns zero rows.
export async function getUserRbacRoleSlugs(userId: string): Promise<string[]> {
  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase
    .from('user_roles')
    .select('roles(slug)')
    .eq('user_id', userId)
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? [])
    .map((row) => {
      // PostgREST many-to-one embed returns an object; tolerate an array too.
      const roles = (row as { roles?: { slug?: string } | Array<{ slug?: string }> }).roles;
      const rel = Array.isArray(roles) ? roles[0] : roles;
      return rel?.slug;
    })
    .filter((slug): slug is string => typeof slug === 'string' && slug.trim().length > 0);
}

// Admin routes accept either:
//   (a) A valid Supabase JWT (Bearer token) whose user_roles→roles.slug set
//       grants the permission, OR
//   (b) The internal SPOTLIGHT_ADMIN_API_KEY header for server-to-server calls.
// The x-admin-role header is only honoured on the API-key path (as a narrowing
// of SPOTLIGHT_ADMIN_API_KEY_ROLE); the JWT path never reads it.
export async function assertAdminPermission(
  request: Request,
  permission: AdminPermission,
): Promise<AdminIdentity> {
  const apiKey = request.headers.get('x-admin-key');
  const expectedKey = process.env.SPOTLIGHT_ADMIN_API_KEY;
  if (expectedKey && apiKey === expectedKey) {
    // The key is a single shared credential — it cannot distinguish callers,
    // so headers alone may never decide the effective role or the audit actor
    // (AUD-FE-005). SPOTLIGHT_ADMIN_API_KEY_ROLE optionally caps the key: the
    // declared role is honored only as a NARROWING of that ceiling (same rule
    // the JWT path documents), an out-of-ceiling claim is an escalation
    // attempt and refused outright. x-actor-id is ignored — a caller-forged
    // identity is worse than a constant one.
    const declared = request.headers.get('x-admin-role') || request.headers.get('x-spotlight-role');
    const ceilingRaw = process.env.SPOTLIGHT_ADMIN_API_KEY_ROLE;
    let role = parseAdminRole(declared);
    if (ceilingRaw) {
      const ceiling = parseAdminRole(ceilingRaw);
      if (!declared) {
        role = ceiling;
      } else if (!roleIsSubset(role, ceiling)) {
        throw new ApiError('Forbidden', 403);
      }
    }
    if (!hasPermission(role, permission)) {
      throw new ApiError('Forbidden', 403);
    }
    return { role, actorId: 'api-key' };
  }

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new ApiError('Unauthorized', 401);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new ApiError('Unauthorized', 401);

  // Role resolution reads ONLY the authoritative RBAC store (user_roles →
  // roles.slug) via getUserRbacRoleSlugs — see its comment. The old code read
  // user_profiles.role, which PUT /api/me/profile let any user self-assign
  // ('admin' → super_admin via parseAdminRole's alias), and fell back to
  // self-editable user_metadata.role — both user-controlled, both removed.
  // Fail closed: an unresolvable role lookup denies, and an empty role set
  // resolves to 'no_access' (zero permissions).
  let slugs: string[];
  try {
    slugs = await getUserRbacRoleSlugs(data.user.id);
  } catch {
    throw new ApiError('Forbidden', 403);
  }

  const role = resolveAdminRoleFromRbacSlugs(slugs, permission);
  if (!hasPermission(role, permission)) throw new ApiError('Forbidden', 403);

  return { role, actorId: data.user.id };
}
