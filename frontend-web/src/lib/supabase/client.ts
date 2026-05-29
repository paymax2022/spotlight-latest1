'use client';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createFallbackSupabaseClient } from '@/lib/supabase/fallbackClient';

let browserClient: ReturnType<typeof createSupabaseClient> | null = null;
let fallbackClient: ReturnType<typeof createFallbackSupabaseClient> | null = null;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const hasConfig =
    !!url &&
    !!anon &&
    !url.includes('placeholder') &&
    !anon.includes('placeholder');

  if (hasConfig) {
    if (!browserClient) {
      browserClient = createSupabaseClient(url, anon);
    }
    return browserClient;
  }

  if (!fallbackClient) {
    fallbackClient = createFallbackSupabaseClient();
  }
  return fallbackClient;
}
