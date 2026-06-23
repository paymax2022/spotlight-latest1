'use client';

import { createClient } from '@supabase/supabase-js';
import { env, hasSupabaseConfig } from '@/config/env';

let cached: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!hasSupabaseConfig) return null;
  if (cached) return cached;
  cached = createClient(env.supabaseUrl, env.supabaseAnonKey);
  return cached;
}
