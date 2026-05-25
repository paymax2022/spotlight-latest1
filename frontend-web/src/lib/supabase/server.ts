import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createFallbackSupabaseClient } from '@/lib/supabase/fallbackClient';
import { hasUsableSupabaseConfig } from '@/lib/supabase/runtime';

export async function createClient() {
  if (!hasUsableSupabaseConfig()) {
    return createFallbackSupabaseClient() as unknown as SupabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  return createSupabaseClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as unknown as SupabaseClient;
}

export function createAdminClient() {
  if (!hasUsableSupabaseConfig()) {
    return createFallbackSupabaseClient() as unknown as SupabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  return createSupabaseClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as unknown as SupabaseClient;
}
