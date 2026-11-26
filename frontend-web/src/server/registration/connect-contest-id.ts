/**
 * slug -> `connect_contests.id`, the one lookup needed to decide whether a
 * contest has a compositing template configured.
 *
 * This began as a private helper inside `supabase-store.ts`. It lives here now
 * because the photo registry needs it and the registry is going to be called
 * FROM `supabase-store.ts` (the submit and review paths are its only callers),
 * which would have made the two modules import each other. A one-function
 * module breaks the cycle without any behaviour change, and both sides arrive
 * through the same query instead of maintaining two copies that can drift.
 *
 * Returns null (never throws) on any miss or error — an unresolvable contest
 * simply means no template is consulted and the caller keeps the plain photo.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy + memoized for the same reason as template-resolver.ts: building a
// client at import time captures whatever env happened to be set when the
// module was first loaded, which is never a time to construct one (vitest
// collection, next build).
let supabaseClient: SupabaseClient | null = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } },
    );
  }
  return supabaseClient;
}

export async function resolveConnectContestId(
  slug: string | null | undefined,
): Promise<string | null> {
  if (!slug) return null;
  const { data, error } = await getSupabase()
    .from('connect_contests')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}
