// Estate Election service — maps the existing single-position election schema
// (elections / election_candidates / election_votes, one vote per voter) onto
// the mobile client's multi-position contract by synthesising ONE position per
// election. Returns the raw shapes the mobile app expects (see
// contracts/visitor.openapi.yaml + src/features/election/types in the app).
//
// NOTE (schema limitation, documented in docs/visitor/09-ENDPOINT-INVENTORY.md):
// the DB is single-position, so every election exposes a single synthesized
// position `${electionId}:main`. To support true multi-position ballots, add an
// election_positions table + position_id columns (additive) and extend here.

import type { SupabaseClient } from '@supabase/supabase-js';

export const MAIN_POSITION_SUFFIX = ':main';

export type ResidentContext = { estateId: string; unit: string; role: string };

/** The caller's estate membership (first/primary), or null if not a resident. */
export async function getResidentContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResidentContext | null> {
  const { data, error } = await supabase
    .from('estate_residents')
    .select('estate_id, unit, role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { estateId: (data as any).estate_id, unit: (data as any).unit ?? '', role: (data as any).role ?? 'resident' };
}

function deriveClientStatus(row: any): { status: string; resultsPublished: boolean } {
  const now = Date.now();
  const within = Date.parse(row.starts_at) <= now && now < Date.parse(row.ends_at);
  if (row.status === 'tallied') return { status: 'results_published', resultsPublished: true };
  if (row.status === 'closed' || now >= Date.parse(row.ends_at)) return { status: 'closed', resultsPublished: false };
  if (row.status === 'open' && within) return { status: 'live', resultsPublished: false };
  return { status: 'scheduled', resultsPublished: false };
}

/** Map an election row to the mobile `Election` shape (single synthesized position). */
export async function mapElection(supabase: SupabaseClient, row: any): Promise<any> {
  const [{ data: candidates }, { data: votes }, { count: eligibleCount }] = await Promise.all([
    supabase.from('election_candidates').select('id, name, bio').eq('election_id', row.id),
    supabase.from('election_votes').select('candidate_id, voter_id').eq('election_id', row.id),
    supabase.from('estate_residents').select('id', { count: 'exact', head: true }).eq('estate_id', row.estate_id),
  ]);

  const tally: Record<string, number> = {};
  for (const v of votes ?? []) tally[(v as any).candidate_id] = (tally[(v as any).candidate_id] ?? 0) + 1;

  const positionId = `${row.id}${MAIN_POSITION_SUFFIX}`;
  const mappedCandidates = (candidates ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    positionId,
    manifesto: c.bio ?? undefined,
    votes: tally[c.id] ?? 0,
  }));

  const { status, resultsPublished } = deriveClientStatus(row);

  return {
    id: row.id,
    estateId: row.estate_id,
    title: row.title,
    description: row.description ?? undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status,
    positions: [{ id: positionId, title: 'Candidates', seats: 1, candidates: mappedCandidates }],
    totalEligibleVoters: eligibleCount ?? 0,
    votesCast: (votes ?? []).length,
    resultsPublished,
  };
}

export function isWithinWindow(row: any): boolean {
  const now = Date.now();
  return Date.parse(row.starts_at) <= now && now < Date.parse(row.ends_at);
}
