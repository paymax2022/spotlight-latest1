import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

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

export async function getUserRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error) {
    return null;
  }

  return (profile as { role?: string } | null)?.role ?? null;
}

export async function requireAdmin(): Promise<AdminRequestContext> {
  const { supabase, user } = await requireUser();
  const dbRole = await getUserRole(supabase, user.id);
  const metadataRole =
    typeof user.user_metadata?.role === 'string'
      ? user.user_metadata.role
      : typeof user.app_metadata?.role === 'string'
        ? user.app_metadata.role
        : null;
  const role = dbRole || metadataRole;

  if (role !== 'admin') {
    throw new Error('FORBIDDEN');
  }

  return { supabase, user, role };
}

export async function requireJudgeOrAdmin(): Promise<JudgeRequestContext> {
  const { supabase, user } = await requireUser();
  const dbRole = await getUserRole(supabase, user.id);
  const metadataRole =
    typeof user.user_metadata?.role === 'string'
      ? user.user_metadata.role
      : typeof user.app_metadata?.role === 'string'
        ? user.app_metadata.role
        : null;
  const role = dbRole || metadataRole;

  if (role !== 'admin' && role !== 'judge') {
    throw new Error('FORBIDDEN');
  }

  return { supabase, user, role: role || 'judge' };
}
