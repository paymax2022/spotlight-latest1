/**
 * Server-side pricing for wallet-paid votes (AUD-BILL-003).
 *
 * /api/v2/votes/wallet used to forward the caller's `costKobo` straight into
 * the wallet debit — `voteCount: 1000000, costKobo: 1` bought a million votes
 * for one kobo. The quote is now derived here, mirroring the custom-quantity
 * branch of the (protected) initiatePaidVote(): the quantity is bounded by
 * voting_settings and priced at the contest's base per-vote rate, which the
 * admin sets via vote_packages (first active package by display_order — the
 * same getBaseVoteRate() the protected service uses).
 */
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { getVotingSettings, assertVotingOpen } from '@/src/server/voting/free-vote.service';

export interface WalletVoteQuote {
  voteCount: number;
  /** Total debit in kobo — integer minor units, derived server-side. */
  costKobo: number;
}

async function baseVoteRateNgn(contestId: string): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('vote_packages')
    .select('amount, votes')
    .eq('contest_id', contestId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data || !Number(data.votes)) {
    throw new ApiError('No vote packages configured for this contest', 400);
  }
  return Number(data.amount) / Number(data.votes);
}

/**
 * Validate the purchase and return the price the wallet debit must use.
 * Throws ApiError on any gate failure (voting closed, paid voting off,
 * quantity out of bounds, no pricing configured).
 */
export async function priceWalletVote(contestId: string, contestantId: string, voteCount: number): Promise<WalletVoteQuote> {
  if (!Number.isInteger(voteCount) || voteCount < 1) {
    throw new ApiError('voteCount must be a positive integer', 400);
  }

  // Bind the contestant to the contest — pricing, the KYC gate, and the vote
  // row all key off these ids, so an unbound (contestId, contestantId) pair
  // would bill at one contest's rate while tallying a different contestant.
  // public.contestants keys its contest on `contest_id` (there is no
  // competition_id column — that's arena/competition_enrollments schema).
  const supabase = createAdminClient();
  const { data: contestant } = await supabase
    .from('contestants')
    .select('contest_id')
    .eq('id', contestantId)
    .maybeSingle();
  if (!contestant || contestant.contest_id !== contestId) {
    throw new ApiError('Contestant does not belong to this contest', 400);
  }

  const settings = await getVotingSettings(contestId);
  assertVotingOpen(settings);
  if (!settings.paidVotingEnabled) {
    throw new ApiError('Paid voting is not enabled for this contest', 400);
  }
  // The v2 contract is quantity-based, so it maps onto the custom-quantity
  // pricing branch — which the contest must have enabled.
  if (!settings.allowCustomVoteQuantity) {
    throw new ApiError('Custom vote quantities are not enabled for this contest — use a package.', 400);
  }
  if (voteCount < settings.minPaidVotes) {
    throw new ApiError(`Minimum purchase is ${settings.minPaidVotes} votes`, 400);
  }
  if (voteCount > settings.maxPaidVotesPerTxn) {
    throw new ApiError(`Maximum purchase per transaction is ${settings.maxPaidVotesPerTxn} votes`, 400);
  }

  const rate = await baseVoteRateNgn(contestId);
  const costKobo = Math.round(voteCount * rate * 100);
  if (costKobo < 1) {
    // The Go debit endpoint enforces cost_kobo >= 1; a zero quote means the
    // contest's base package is mispriced (₦0) — fail before any debit.
    throw new ApiError('Contest vote pricing is not configured correctly', 400);
  }
  return { voteCount, costKobo };
}
