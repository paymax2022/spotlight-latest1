import { createAdminClient } from '@/lib/supabase/server';

export type RequestUser = {
  id: string;
  email?: string;
};

// Bearer-token validation uses the admin (service-role) client.
// This path is purely for JWT verification — it does not read cookies and
// therefore works reliably in all Route Handler and Server Action contexts.
export async function requireRequestUser(request: Request): Promise<RequestUser> {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new Error('UNAUTHORIZED');

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');

  return { id: data.user.id, email: data.user.email || undefined };
}

// Non-throwing variant for routes that branch on auth failure instead of
// catching (the v2 vote routes use this shape).
export async function validateRequest(
  request: Request,
): Promise<{ user: RequestUser | null; error: string | null }> {
  try {
    const user = await requireRequestUser(request);
    return { user, error: null };
  } catch {
    return { user: null, error: 'UNAUTHORIZED' };
  }
}

// Service-role client for role lookups — RLS is bypassed intentionally because
// this is a server-side internal call, not a user-facing query.
export async function getRequestUserRole(userId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return (data as { role?: string } | null)?.role || null;
}
