'use client';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createFallbackSupabaseClient } from '@/lib/supabase/fallbackClient';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const hasConfig =
    !!url &&
    !!anon &&
    !url.includes('placeholder') &&
    !anon.includes('placeholder');

  if (hasConfig) {
    return createSupabaseClient(url, anon);
  }

  return createFallbackSupabaseClient();
}
