import { createFallbackSupabaseClient } from '@/lib/supabase/fallbackClient';

export async function createClient() {
  return createFallbackSupabaseClient();
}

export function createAdminClient() {
  return createFallbackSupabaseClient();
}
