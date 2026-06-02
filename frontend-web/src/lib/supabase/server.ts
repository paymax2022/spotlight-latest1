import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createFallbackSupabaseClient } from '@/lib/supabase/fallbackClient';
import { hasUsableSupabaseConfig } from '@/lib/supabase/runtime';

// Cookie-aware server client — reads the authenticated user's session from
// httpOnly cookies set by Supabase Auth. Use this inside Server Components,
// Route Handlers, and Server Actions that need to identify the calling user.
export async function createClient() {
  if (!hasUsableSupabaseConfig()) {
    return createFallbackSupabaseClient() as unknown as SupabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  const cookieStore = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll is called from Server Components where mutation is forbidden.
          // Auth middleware handles the actual cookie refresh.
        }
      },
    },
  }) as unknown as SupabaseClient;
}

// Service-role admin client — bypasses RLS. Only use this for trusted
// server-side operations (admin tasks, background jobs, webhooks).
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
