// Shared estate-resident context for the estate-module API handlers.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@/src/lib/api/responses';

export type ResidentContext = { estateId: string; unit: string; role: string };

export type ResidentContextOptions = {
  // forWrite asserts the estate is active before returning — the BFF mirror of
  // the Go LifecycleGate on /api/finance/estate/:id (ESTD-D025). Mutating
  // handlers pass { forWrite: true }; reads never do.
  forWrite?: boolean;
};

// Lifecycle gate (ESTD-D025 / EST-UAT-0419): a suspended/pending/closed estate
// takes no mutating estate action — records are retained, reads stay open, and
// the platform reactivates via /api/finance/estate-admin/estates/{id}/lifecycle.
// Throws ApiError(423) — same status the Go gate returns.
export async function assertEstateWritable(supabase: SupabaseClient, estateId: string): Promise<void> {
  const { data, error } = await supabase.from('estates').select('status').eq('id', estateId).maybeSingle();
  if (error) throw new ApiError('Failed to verify estate status', 500);
  const status: string = (data as any)?.status ?? 'unknown';
  if (status !== 'active') {
    throw new ApiError(`Estate is ${status} — changes are disabled until it is active`, 423);
  }
}

// Canonical membership resolution for every estate BFF route (dues, meetings,
// elections, facilities, …). Banned and soft-deleted memberships fail closed —
// the Go side enforces the same gate in assertRoles/roleIn (ESTATE-AUTHZ-003);
// this copy previously skipped those columns, so a banned or deleted resident
// kept full BFF access (could still vote, pay dues, RSVP).
export async function getResidentContext(
  supabase: SupabaseClient,
  userId: string,
  opts?: ResidentContextOptions,
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
  const ctx = {
    estateId: (data as any).estate_id,
    unit: (data as any).unit ?? '',
    role: (data as any).role ?? 'resident',
  };
  // Membership first: a non-member gets the plain 403 below without learning
  // the estate's status. Only writes pay for the extra estates lookup.
  if (opts?.forWrite) await assertEstateWritable(supabase, ctx.estateId);
  return ctx;
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
