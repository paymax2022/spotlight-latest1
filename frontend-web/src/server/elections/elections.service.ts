// Estate Election service — maps the existing single-position election schema
// (elections / election_candidates / election_votes, one vote per voter) onto
// the mobile client's multi-position contract by synthesising ONE position per
// election. Returns the raw shapes the mobile app expects (see
// contracts/visitor.openapi.yaml + src/features/election/types in the app).
// NOTE (schema limitation, documented in docs/visitor/09-ENDPOINT-INVENTORY.md):
// the DB is single-position, so every election exposes a single synthesized
// position `${electionId}:main`. To support true multi-position ballots, add an
// election_positions table + position_id columns (additive) and extend here.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getResidentContext } from '@/src/server/estate/resident';

export const MAIN_POSITION_SUFFIX = ':main';

// Marker returned in place of a candidate id wherever a ballot receipt or
// pre-publish tally would otherwise reveal a selection. Secret-ballot rule:
// participation is verifiable, the choice is not (EST-UAT-0213/0216/0228).
export const SEALED_BALLOT = 'sealed';

export type { ResidentContext } from '@/src/server/estate/resident';
// Canonical membership resolver — this file used to carry a copy that skipped
// the banned_at/deleted_at fail-closed filter, letting a banned or deleted
// resident keep voting through the BFF while the Go API refused them.
export { getResidentContext };

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
    // Tally needs candidate_id only. voter_id is never selected: this surface
    // must not widen the voter→choice link the election_votes row carries.
    supabase.from('election_votes').select('candidate_id').eq('election_id', row.id),
    // "Eligible voters" = active memberships only; banned/deleted residents can
    // no longer reach the ballot anyway (getResidentContext fails closed).
    supabase
      .from('estate_residents')
      .select('id', { count: 'exact', head: true })
      .eq('estate_id', row.estate_id)
      .is('banned_at', null)
      .is('deleted_at', null),
  ]);

  const { status, resultsPublished } = deriveClientStatus(row);

  // Live tallies are withheld until results are published (status 'tallied').
  // Previously every list/detail call exposed running per-candidate counts
  // mid-poll — an unauthorized tally read the Go GetResults gate refuses.
  const tally: Record<string, number> = {};
  if (resultsPublished) {
    for (const v of votes ?? []) tally[(v as any).candidate_id] = (tally[(v as any).candidate_id] ?? 0) + 1;
  }

  const positionId = `${row.id}${MAIN_POSITION_SUFFIX}`;
  const mappedCandidates = (candidates ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    positionId,
    manifesto: c.bio ?? undefined,
    votes: resultsPublished ? (tally[c.id] ?? 0) : 0,
  }));

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

export interface VoteEligibility {
  eligible: boolean;
  reasons: string[];
}

// Mirror of the Go election gate (internal/estate/election_eligibility.go +
// the dues-restriction check in CastVote). The BFF vote route previously
// ignored election_eligibility_rules and estate_dues_restrictions entirely, so
// a voter the Go API would refuse (outstanding dues, wrong resident type,
// unverified KYC, active restriction) could still cast through /api/v1/elections.
export async function checkVoteEligibility(
  supabase: SupabaseClient,
  estateId: string,
  userId: string,
  electionId: string,
): Promise<VoteEligibility> {
  const reasons: string[] = [];

  // Any active dues restriction blocks voting (soft or hard — the Go
  // restrictionBlocks matrix gates ActionVote on both).
  const { data: restriction } = await supabase
    .from('estate_dues_restrictions')
    .select('id')
    .eq('estate_id', estateId)
    .eq('resident_id', userId)
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (restriction) reasons.push('outstanding_dues_restriction');

  const { data: rules } = await supabase
    .from('election_eligibility_rules')
    .select('require_kyc, require_payment, resident_types')
    .eq('election_id', electionId)
    .maybeSingle();

  if (rules) {
    if ((rules as any).require_kyc) {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('kyc_status')
        .eq('id', userId)
        .maybeSingle();
      if ((prof as any)?.kyc_status !== 'verified') reasons.push('kyc_required');
    }
    if ((rules as any).require_payment) {
      const now = new Date().toISOString();
      const { count } = await supabase
        .from('estate_dues_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('estate_id', estateId)
        .eq('resident_id', userId)
        .or(`status.eq.overdue,and(status.eq.pending,due_date.lt.${now})`);
      if ((count ?? 0) > 0) reasons.push('outstanding_dues');
    }
    const types: string[] = Array.isArray((rules as any).resident_types) ? (rules as any).resident_types : [];
    if (types.length > 0) {
      // resident_profiles.resident_id references estate_residents.id.
      const { data: resident } = await supabase
        .from('estate_residents')
        .select('id')
        .eq('estate_id', estateId)
        .eq('user_id', userId)
        .maybeSingle();
      let voterType = '';
      if (resident) {
        const { data: rp } = await supabase
          .from('resident_profiles')
          .select('occupancy_type')
          .eq('resident_id', (resident as any).id)
          .maybeSingle();
        voterType = (rp as any)?.occupancy_type ?? '';
      }
      if (!types.includes(voterType)) reasons.push('resident_type_ineligible');
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
