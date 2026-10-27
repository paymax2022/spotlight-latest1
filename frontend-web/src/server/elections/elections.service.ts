// Estate Election service — maps the estate election schema (elections /
// election_candidates, a participation registry in election_votes and the choices in
// the anonymous election_ballots table, one ballot per voter) onto the mobile
// client's multi-position contract by synthesising ONE position per election. Returns
// the raw shapes the mobile app expects (see contracts/visitor.openapi.yaml +
// src/features/election/types in the app).
// NOTE (schema limitation, documented in docs/visitor/09-ENDPOINT-INVENTORY.md):
// the DB is single-position, so every election exposes a single synthesized
// position `${electionId}:main`. To support true multi-position ballots, add an
// election_positions table + position_id columns (additive) and extend here.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getResidentContext } from '@/src/server/estate/resident';

export const MAIN_POSITION_SUFFIX = ':main';

// Every column mapElection reads, so no route can serve an election that silently
// reports the default governance shape.
export const ELECTION_SELECT =
  'id, estate_id, title, description, starts_at, ends_at, status, kind, weighting, ' +
  'quorum_type, quorum_value, tie_break, nomination_opens_at, nomination_closes_at, ' +
  'roll_frozen_at, rules_locked_at';

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
  const [{ data: candidates }, { data: ballots }, { count: eligibleCount }] = await Promise.all([
    supabase.from('election_candidates').select('id, name, bio').eq('election_id', row.id),
    // ESTB-D003: the tally reads the anonymous ballot table. election_votes is now a
    // participation registry with no choice column at all, so nothing on this surface
    // can widen a voter→choice link — there is no link to widen.
    supabase.from('election_ballots').select('candidate_id').eq('election_id', row.id),
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
    for (const b of ballots ?? []) {
      const cid = (b as any).candidate_id;
      // A null candidate is an abstention/blank ballot (EST-UAT-0221): counted in
      // turnout, never attributed to a candidate.
      if (!cid) continue;
      tally[cid] = (tally[cid] ?? 0) + 1;
    }
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
    // How the poll was configured (Phase 2.2 governance). A client needs the weighting to
    // know a ballot is cast per unit rather than per person, and the quorum/tie-break rules
    // to explain a verdict that has no winner (EST-UAT-0205/0223/0225).
    governance: {
      kind: row.kind ?? 'binding',
      weighting: row.weighting ?? 'one_person_one_vote',
      quorumType: row.quorum_type ?? 'none',
      quorumValue: row.quorum_value ?? 0,
      tieBreak: row.tie_break ?? 'none',
      nominationOpensAt: row.nomination_opens_at ?? null,
      nominationClosesAt: row.nomination_closes_at ?? null,
      rollFrozenAt: row.roll_frozen_at ?? null,
      rulesLockedAt: row.rules_locked_at ?? null,
    },
    positions: [{ id: positionId, title: 'Candidates', seats: 1, candidates: mappedCandidates }],
    totalEligibleVoters: eligibleCount ?? 0,
    votesCast: (ballots ?? []).length,
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

  // A published roll is the franchise (EST-UAT-0204/0219): once a frozen roll exists, an
  // active entry on its newest version is the right to vote, and removing that entry takes
  // the right away mid-poll. estate_cast_vote enforces the same rule in the write itself —
  // this mirror is what lets the app explain the refusal instead of reporting a 409.
  const { data: frozenRoll } = await supabase
    .from('election_rolls')
    .select('id')
    .eq('election_id', electionId)
    .eq('status', 'frozen')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (frozenRoll) {
    const { data: entry } = await supabase
      .from('election_roll_entries')
      .select('id')
      .eq('roll_id', (frozenRoll as any).id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (!entry) reasons.push('not_on_roll');
  }

  return { eligible: reasons.length === 0, reasons };
}

export interface VoterUnit {
  id: string;
  label: string;
}

// The holdings behind a voter's participation rows. Read from estate_properties rather
// than the roll weight, because the write path (estate_cast_vote) checks the holding, not
// the snapshot, and a ballot for a unit the voter no longer holds must be refused.
export async function getVoterUnits(
  supabase: SupabaseClient,
  estateId: string,
  userId: string,
): Promise<VoterUnit[]> {
  const { data } = await supabase
    .from('estate_properties')
    .select('id, unit_label, block')
    .eq('estate_id', estateId)
    .eq('archived', false)
    .or(`landlord_id.eq.${userId},tenant_id.eq.${userId}`)
    .order('unit_label');
  return (data ?? []).map((p: any) => ({
    id: p.id,
    label: p.block ? `${p.block} / ${p.unit_label}` : p.unit_label,
  }));
}

