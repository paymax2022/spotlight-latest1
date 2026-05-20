import { createAdminClient, createClient } from '@/lib/supabase/server';

export type UserServiceContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
};

export type AdminServiceContext = {
  supabase: ReturnType<typeof createAdminClient>;
};

export async function getUserServiceContext(): Promise<UserServiceContext> {
  return { supabase: await createClient() };
}

export function getAdminServiceContext(): AdminServiceContext {
  return { supabase: createAdminClient() };
}
