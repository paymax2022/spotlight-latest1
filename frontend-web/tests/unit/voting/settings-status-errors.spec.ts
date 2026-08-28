/**
 * Why a contest refuses votes.
 *
 * getVotingSettings filtered on status='active' inside the query, so a contest
 * with no settings row and a contest whose settings were still in draft both
 * failed with "Voting is not enabled for this contest". An admin looking at a
 * console that shows Enable Voting ✓ and Enable Paid Voting ✓ reads that as a
 * contradiction, and nothing anywhere points at the status field.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/server';
import { getVotingSettings } from '@/src/server/voting/free-vote.service';

const mockAdmin = createAdminClient as ReturnType<typeof vi.fn>;
const CONTEST = '93660d54-5a80-4a9d-b501-369cd17314fb';

function rowIs(data: Record<string, unknown> | null, error: unknown = null) {
  mockAdmin.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }),
    }),
  });
}

beforeEach(() => mockAdmin.mockReset());

describe('getVotingSettings failure messages', () => {
  it('says the contest has no settings at all when none exist', async () => {
    rowIs(null);
    await expect(getVotingSettings(CONTEST)).rejects.toThrow(/has not been set up/i);
  });

  it('names the status, and points at the fix, when the row is not active', async () => {
    for (const status of ['draft', 'paused', 'closed']) {
      rowIs({ contest_id: CONTEST, status, voting_enabled: true });
      // The whole point: an admin must be able to act on this.
      await expect(getVotingSettings(CONTEST), status).rejects.toThrow(
        new RegExp(`still ${status}[\\s\\S]*status to active`, 'i'),
      );
    }
  });

  it('never blames "voting is not enabled" when voting IS enabled but the row is draft', async () => {
    rowIs({ contest_id: CONTEST, status: 'draft', voting_enabled: true, paid_voting_enabled: true });
    await expect(getVotingSettings(CONTEST)).rejects.toThrow(/still draft/i);
    await expect(getVotingSettings(CONTEST)).rejects.not.toThrow(/not enabled/i);
  });

  it('returns the settings when the row is active', async () => {
    rowIs({ contest_id: CONTEST, status: 'active', voting_enabled: true, free_votes_per_day: 3 });
    await expect(getVotingSettings(CONTEST)).resolves.toBeTruthy();
  });

  it('still reports a database failure as a 500, not a configuration problem', async () => {
    rowIs(null, { message: 'connection reset' });
    await expect(getVotingSettings(CONTEST)).rejects.toThrow(/Failed to load voting settings/i);
  });
});
