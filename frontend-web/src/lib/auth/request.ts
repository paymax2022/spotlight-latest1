import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

export type RequestUser = {
  id: string;
  email?: string;
};

export async function requireRequestUser(request: Request): Promise<RequestUser> {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw new Error('UNAUTHORIZED');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');

  return { id: data.user.id, email: data.user.email || undefined };
}

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
