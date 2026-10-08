/**
 * AUD-BILL-003: wallet-paid votes were priced by the CLIENT — the v2 route
 * forwarded `costKobo` from the request body into the wallet debit, so
 * `voteCount: N, costKobo: 1` bought N votes for one kobo.
 *
 * These specs pin the server-side quote: quantity gated by voting_settings,
 * price = voteCount × contest base rate (first active vote_package's
 * amount/votes) in integer kobo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@/src/lib/api/responses';

vi.mock('@/src/server/voting/free-vote.service', () => ({
  getVotingSettings: vi.fn(),
  assertVotingOpen: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { priceWalletVote } from '@/src/server/voting-bridge/wallet-pricing';
import { getVotingSettings, assertVotingOpen } from '@/src/server/voting/free-vote.service';
import { createAdminClient } from '@/lib/supabase/server';

const SETTINGS = {
  paidVotingEnabled: true,
  allowCustomVoteQuantity: true,
  minPaidVotes: 1,
  maxPaidVotesPerTxn: 10_000,
};

/**
 * Table-aware supabase stub. `contestants` answers a membership row for
 * 'contestant-1' → 'contest-1' (keyed on the real `contest_id` column);
 * `vote_packages` answers the pricing row: ₦1000 / 10 votes = ₦100 per vote.
 */
function stubDb(opts: {
  packageRow?: { amount: number; votes: number } | null;
  contestantRow?: { contest_id: string } | null;
} = {}) {
  const packageRow = 'packageRow' in opts ? opts.packageRow : { amount: 1000, votes: 10 };
  const contestantRow = 'contestantRow' in opts ? opts.contestantRow : { contest_id: 'contest-1' };
  const selectedColumns: Record<string, string> = {};

  const from = vi.fn((table: string) => {
    if (table === 'contestants') {
      const maybeSingle = vi.fn(async () => ({ data: contestantRow }));
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn((cols: string) => {
        selectedColumns.contestants = cols;
        return { eq };
      });
      return { select };
    }
    // vote_packages: select → eq → eq → order → limit → maybeSingle
    const maybeSingle = vi.fn(async () => ({ data: packageRow }));
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const secondEq = vi.fn(() => ({ order }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const select = vi.fn(() => ({ eq: firstEq }));
    return { select };
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { selectedColumns };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVotingSettings).mockResolvedValue(SETTINGS as never);
  vi.mocked(assertVotingOpen).mockImplementation(() => undefined);
  stubDb();
});

describe('priceWalletVote', () => {
  it('prices voteCount × base rate in integer kobo', async () => {
    // ₦100/vote × 50 votes = ₦5000 = 500_000 kobo
    const quote = await priceWalletVote('contest-1', 'contestant-1', 50);
    expect(quote.costKobo).toBe(500_000);
    expect(quote.voteCount).toBe(50);
  });

  it('rejects non-positive/non-integer quantities', async () => {
    await expect(priceWalletVote('contest-1', 'contestant-1', 0)).rejects.toThrowError(ApiError);
    await expect(priceWalletVote('contest-1', 'contestant-1', -5)).rejects.toThrowError(ApiError);
    await expect(priceWalletVote('contest-1', 'contestant-1', 1.5)).rejects.toThrowError(ApiError);
  });

  it('rejects a contestant that does not belong to the contest', async () => {
    stubDb({ contestantRow: { contest_id: 'other-contest' } });
    await expect(priceWalletVote('contest-1', 'contestant-9', 10)).rejects.toThrowError(/belong/i);
    stubDb({ contestantRow: null });
    await expect(priceWalletVote('contest-1', 'ghost', 10)).rejects.toThrowError(/belong/i);
  });

  it('reads contestants by the real contest_id column, not competition_id', async () => {
    // Regression for the prod bug where `competition_id` was selected — that
    // column does not exist on public.contestants, so EVERY valid
    // (contest, contestant) pair was rejected as "does not belong".
    const { selectedColumns } = stubDb();
    await priceWalletVote('contest-1', 'contestant-1', 10);
    expect(selectedColumns.contestants).toBe('contest_id');
  });

  it('fails closed when paid voting is off', async () => {
    vi.mocked(getVotingSettings).mockResolvedValue({ ...SETTINGS, paidVotingEnabled: false } as never);
    await expect(priceWalletVote('contest-1', 'contestant-1', 10)).rejects.toThrowError(/not enabled/i);
  });

  it('fails closed when custom quantities are disabled', async () => {
    vi.mocked(getVotingSettings).mockResolvedValue({ ...SETTINGS, allowCustomVoteQuantity: false } as never);
    await expect(priceWalletVote('contest-1', 'contestant-1', 10)).rejects.toThrowError(/package/i);
  });

  it('enforces the contest min/max purchase bounds', async () => {
    vi.mocked(getVotingSettings).mockResolvedValue(
      { ...SETTINGS, minPaidVotes: 5, maxPaidVotesPerTxn: 100 } as never,
    );
    await expect(priceWalletVote('contest-1', 'contestant-1', 2)).rejects.toThrowError(/Minimum purchase/);
    await expect(priceWalletVote('contest-1', 'contestant-1', 500)).rejects.toThrowError(/Maximum purchase/);
  });

  it('propagates the voting-window gate', async () => {
    vi.mocked(assertVotingOpen).mockImplementation(() => {
      throw new ApiError('Voting is closed', 400);
    });
    await expect(priceWalletVote('contest-1', 'contestant-1', 10)).rejects.toThrowError(/closed/i);
  });

  it('fails when no active package sets the base rate', async () => {
    stubDb({ packageRow: null });
    await expect(priceWalletVote('contest-1', 'contestant-1', 10)).rejects.toThrowError(/No vote packages/);
  });

  it('fails closed on a zero-priced quote (misconfigured ₦0 base package)', async () => {
    stubDb({ packageRow: { amount: 0, votes: 10 } });
    await expect(priceWalletVote('contest-1', 'contestant-1', 10)).rejects.toThrowError(/pricing/i);
  });
});
