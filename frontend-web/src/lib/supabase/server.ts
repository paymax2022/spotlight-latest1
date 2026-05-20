import type { SupabaseClient } from '@supabase/supabase-js';
import { createFallbackSupabaseClient } from '@/lib/supabase/fallbackClient';

export async function createClient() {
  return createFallbackSupabaseClient() as unknown as SupabaseClient;
}

export function createAdminClient() {
  return createFallbackSupabaseClient() as unknown as SupabaseClient;
}
