'use client';

import { createFallbackSupabaseClient } from '@/lib/supabase/fallbackClient';

export function createClient() {
  return createFallbackSupabaseClient();
}
