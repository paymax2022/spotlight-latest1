// Shared estate-resident context for the estate-module API handlers.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ResidentContext = { estateId: string; unit: string; role: string };

// Canonical membership resolution for every estate BFF route (dues, meetings,
// elections, facilities, …). Banned and soft-deleted memberships fail closed —
// the Go side enforces the same gate in assertRoles/roleIn (ESTATE-AUTHZ-003);
// this copy previously skipped those columns, so a banned or deleted resident
// kept full BFF access (could still vote, pay dues, RSVP).
export async function getResidentContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResidentContext | null> {
  const { data, error } = await supabase
    .from('estate_residents')
    .select('estate_id, unit, role')
    .eq('user_id', userId)
    .is('banned_at', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    estateId: (data as any).estate_id,
    unit: (data as any).unit ?? '',
    role: (data as any).role ?? 'resident',
  };
}

/** Resolve display names for a set of user ids → { [id]: full_name }. */
export async function resolveNames(supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data } = await supabase.from('user_profiles').select('id, full_name').in('id', unique);
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[(r as any).id] = (r as any).full_name ?? 'Resident';
  return map;
}
