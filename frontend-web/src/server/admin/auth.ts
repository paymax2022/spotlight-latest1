import { ApiError } from '@/src/lib/api/responses';
import { hasPermission, parseAdminRole, type AdminPermission } from '@/src/server/admin/rbac';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export interface AdminIdentity {
  role: ReturnType<typeof parseAdminRole>;
  actorId: string;
}

// Admin routes accept either:
//   (a) A valid Supabase JWT (Bearer token) whose user_profiles.role satisfies the permission, OR
//   (b) The internal SPOTLIGHT_ADMIN_API_KEY header for server-to-server calls.
// The x-admin-role header is only honoured when a verified JWT is present (it can narrow the
// effective role down but can never elevate beyond what the DB says).
export async function assertAdminPermission(
  request: Request,
  permission: AdminPermission,
): Promise<AdminIdentity> {
  // --- path (b): server-to-server API key ---
  const apiKey = request.headers.get('x-admin-key');
  const expectedKey = process.env.SPOTLIGHT_ADMIN_API_KEY;
  if (expectedKey && apiKey === expectedKey) {
    const claimedRole = parseAdminRole(
      request.headers.get('x-admin-role') || request.headers.get('x-spotlight-role'),
    );
    if (!hasPermission(claimedRole, permission)) {
      throw new ApiError('Forbidden', 403);
    }
    return { role: claimedRole, actorId: request.headers.get('x-actor-id') || 'system' };
  }

  // --- path (a): JWT-based auth ---
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new ApiError('Unauthorized', 401);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new ApiError('Unauthorized', 401);

  // Role from DB is the source of truth; user_metadata is only a fallback.
  //
  // MUST use the service-role client here, not the cookie/RLS-scoped one above.
  // This route is called with `Authorization: Bearer <token>` from a
  // cross-origin admin console (frontend-admin, a different port), never with
  // this app's own session cookies — so `createClient()`'s RLS-scoped query
  // runs unauthenticated (auth.uid() is null) and user_profiles' own-row-only
  // SELECT policy silently returns zero rows. The role check then fell through
  // to the JWT's user_metadata.role — whatever was set at signup and never
  // updated after — making every user_profiles.role change (grant OR revoke)
  // a no-op for every Bearer-token admin caller, i.e. every real caller.
  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from('user_profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  const dbRole =
    (profile as { role?: string } | null)?.role ||
    data.user.app_metadata?.role ||
    data.user.user_metadata?.role ||
    '';

  const role = parseAdminRole(dbRole as string);
  if (!hasPermission(role, permission)) throw new ApiError('Forbidden', 403);

  return { role, actorId: data.user.id };
}
