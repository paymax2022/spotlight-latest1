import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getUserRbacRoleSlugs } from '@/src/server/admin/auth';
import { adminRoleFromRbacSlug } from '@/src/server/admin/rbac';

export interface AuthenticatedRequestContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
}

export interface AdminRequestContext extends AuthenticatedRequestContext {
  role: string;
}

export interface JudgeRequestContext extends AuthenticatedRequestContext {
  role: string;
}

export async function requireUser(request?: Request): Promise<AuthenticatedRequestContext> {
  const supabase = await createClient();
  const authHeader = request?.headers.get('authorization') || request?.headers.get('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const {
    data: { user },
  } = bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser();

  if (!user) {
    throw new Error('UNAUTHORIZED');
  }

  return { supabase, user };
}

// E2E-SEC-053: this used to read user_profiles.role — a column
// PUT /api/me/profile let any user self-assign — and fell back to
// self-editable user_metadata.role. Both are user-controlled and neither may
// grant admin/judge access. The authoritative store is public.user_roles →
// public.roles.slug, the same source the Go backend's RBAC enforces
// (see getUserRbacRoleSlugs / adminRoleFromRbacSlug). Kept for callers of
// requireUser-style contexts; fail closed on any lookup error.
export async function getUserRole(
  _supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  try {
    const slugs = await getUserRbacRoleSlugs(userId);
    return slugs[0] ?? null;
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<AdminRequestContext> {
  const { supabase, user } = await requireUser();

  let isAdmin = false;
  try {
    const slugs = await getUserRbacRoleSlugs(user.id);
    isAdmin = slugs.some((slug) => adminRoleFromRbacSlug(slug) === 'super_admin');
  } catch {
    isAdmin = false;
  }

  if (!isAdmin) {
    throw new Error('FORBIDDEN');
  }

  return { supabase, user, role: 'admin' };
}

export async function requireJudgeOrAdmin(): Promise<JudgeRequestContext> {
  const { supabase, user } = await requireUser();

  let role: 'admin' | 'judge' | null = null;
  try {
    const slugs = await getUserRbacRoleSlugs(user.id);
    const mapped = slugs.map(adminRoleFromRbacSlug);
    if (mapped.includes('super_admin')) role = 'admin';
    else if (mapped.includes('judge')) role = 'judge';
  } catch {
    role = null;
  }

  if (!role) {
    throw new Error('FORBIDDEN');
  }

  return { supabase, user, role };
}
