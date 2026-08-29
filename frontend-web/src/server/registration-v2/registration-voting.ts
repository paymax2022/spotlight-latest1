// Registration → voting seam, read side.
//
// WHY THIS EXISTS
// An approved registration becomes a contestant (see the
// promote_registration_to_contestant seam), but nothing told the APPLICANT.
// The registration status screen showed a status chip and a withdraw button and
// stopped there — no contest details, no way to vote, nothing to share so other
// people could vote. Everything needed was already in the database; there was
// simply no endpoint that joined it.
//
// THE PLANES (this is the part that trips people up)
//   registrations          the application the applicant submitted
//   contestants            the roster row the promotion seam creates
//   connect_contests       what the MOBILE app votes against, via Go
//                          /api/v1/connect — this is the plane that WORKS
//   contests               the web/admin voting plane; mirrored from
//                          connect_contests by trigger, so ids and slugs match
//   competition_enrollments the web public vote page's contestant plane — a
//                          promoted contestant is NOT in here, which is why the
//                          public /vote/<contest>/<contestant> page cannot serve
//                          one and why the share target below is the app route.
//
// Nothing here edits a protected legacy file: it reads the roster and the
// contest and joins them. Per CLAUDE.md § Brownfield safety and the hook's own
// guidance, new registration behaviour lives in registration-v2/.
import { createAdminClient } from '@/lib/supabase/server';

export interface RegistrationVotingContest {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  status: string;
  freeVotesPerUser: number;
  paidVoteKobo: number;
  bannerImageUrl: string | null;
  rulesText: string | null;
  opensAt: string | null;
  closesAt: string | null;
}

export interface RegistrationVotingContestant {
  id: string;
  name: string;
  stageName: string | null;
  photoUrl: string | null;
  category: string | null;
  state: string | null;
  totalVotes: number;
  ranking: number | null;
  isActive: boolean;
  isVerified: boolean;
  status: string | null;
}

export interface RegistrationVoting {
  /** True only when there is an active roster row on an open contest. */
  votable: boolean;
  /**
   * Why voting is not available, when it is not. Lets the client say something
   * specific instead of hiding the section with no explanation.
   */
  reason:
    | null
    | 'not_approved'
    | 'not_promoted'
    | 'no_contest'
    | 'contestant_inactive'
    | 'contest_not_open';
  applicationStatus: string;
  contest: RegistrationVotingContest | null;
  contestant: RegistrationVotingContestant | null;
  /**
   * Relative path to the in-app contestant page. The caller turns this into an
   * absolute URL against whatever origin it is served from — the public web
   * vote page cannot resolve a promoted contestant (it reads
   * competition_enrollments), so the app route is the only share target that
   * actually lets someone vote for this person today.
   */
  sharePath: string | null;
  shareText: string | null;
}

/** Statuses that mean the application has been accepted onto a roster. */
const APPROVED_STATUSES = new Set([
  'approved',
  'selected_for_public_voting',
  'selected_for_bootcamp',
]);

function notVotable(
  applicationStatus: string,
  reason: RegistrationVoting['reason'],
  contest: RegistrationVotingContest | null = null,
  contestant: RegistrationVotingContestant | null = null,
): RegistrationVoting {
  return {
    votable: false,
    reason,
    applicationStatus,
    contest,
    contestant,
    sharePath: null,
    shareText: null,
  };
}

/**
 * Resolve the voting context for one registration.
 *
 * Returns a fully-populated object in every case — the caller renders the
 * `reason` rather than getting a 404 and guessing. Ownership is enforced by the
 * route, not here.
 */
export async function getRegistrationVoting(
  registrationId: string,
): Promise<RegistrationVoting | null> {
  if (!registrationId || typeof registrationId !== 'string') {
    throw new Error('Invalid registration id');
  }
  const supabase = createAdminClient();

  const { data: registration, error: regErr } = await supabase
    .from('registrations')
    .select('id, status')
    .eq('id', registrationId)
    .maybeSingle();

  if (regErr) throw new Error(`Failed to load registration: ${regErr.message}`);
  if (!registration) return null;

  const applicationStatus = String((registration as any).status ?? '');
  if (!APPROVED_STATUSES.has(applicationStatus)) {
    return notVotable(applicationStatus, 'not_approved');
  }

  // The roster row the promotion seam created, if it ran.
  const { data: rosterRow, error: rosterErr } = await supabase
    .from('contestants')
    .select(
      'id, name, stage_name, photo_url, category, state, total_votes, ranking, is_active, is_verified, status, connect_contest_id',
    )
    .eq('registration_id', registrationId)
    .maybeSingle();

  if (rosterErr) throw new Error(`Failed to load contestant: ${rosterErr.message}`);
  if (!rosterRow) return notVotable(applicationStatus, 'not_promoted');

  const contestant: RegistrationVotingContestant = {
    id: String((rosterRow as any).id),
    name: String((rosterRow as any).name ?? 'Contestant'),
    stageName: (rosterRow as any).stage_name ?? null,
    photoUrl: (rosterRow as any).photo_url ?? null,
    category: (rosterRow as any).category ?? null,
    state: (rosterRow as any).state ?? null,
    // total_votes is a denormalised counter; it is the roster's own number and
    // is what the app already renders elsewhere.
    totalVotes: Number((rosterRow as any).total_votes ?? 0),
    ranking: (rosterRow as any).ranking ?? null,
    isActive: Boolean((rosterRow as any).is_active),
    isVerified: Boolean((rosterRow as any).is_verified),
    status: (rosterRow as any).status ?? null,
  };

  // A registration whose contest_slug matched no contest promotes with a null
  // contest rather than failing, so this is a real and expected state.
  const connectContestId = (rosterRow as any).connect_contest_id as string | null;
  if (!connectContestId) return notVotable(applicationStatus, 'no_contest', null, contestant);

  const { data: contestRow, error: contestErr } = await supabase
    .from('connect_contests')
    .select(
      'id, slug, title, description, status, free_votes_per_user, paid_vote_kobo, banner_image_url, rules_text, opens_at, closes_at',
    )
    .eq('id', connectContestId)
    .maybeSingle();

  if (contestErr) throw new Error(`Failed to load contest: ${contestErr.message}`);
  if (!contestRow) return notVotable(applicationStatus, 'no_contest', null, contestant);

  const contest: RegistrationVotingContest = {
    id: String((contestRow as any).id),
    slug: (contestRow as any).slug ?? null,
    title: String((contestRow as any).title ?? 'Contest'),
    description: (contestRow as any).description ?? null,
    status: String((contestRow as any).status ?? ''),
    freeVotesPerUser: Number((contestRow as any).free_votes_per_user ?? 0),
    paidVoteKobo: Number((contestRow as any).paid_vote_kobo ?? 0),
    bannerImageUrl: (contestRow as any).banner_image_url ?? null,
    rulesText: (contestRow as any).rules_text ?? null,
    opensAt: (contestRow as any).opens_at ?? null,
    closesAt: (contestRow as any).closes_at ?? null,
  };

  if (!contestant.isActive) {
    return notVotable(applicationStatus, 'contestant_inactive', contest, contestant);
  }
  if (contest.status !== 'open') {
    return notVotable(applicationStatus, 'contest_not_open', contest, contestant);
  }

  const displayName = contestant.stageName || contestant.name;
  return {
    votable: true,
    reason: null,
    applicationStatus,
    contest,
    contestant,
    sharePath: `/voting/contestant-profile?contestantId=${encodeURIComponent(
      contestant.id,
    )}&contestId=${encodeURIComponent(contest.id)}`,
    shareText: `Vote for ${displayName} in ${contest.title} on Spotlight! 🎤`,
  };
}
