/**
 * Getting to the admin-vote page is half of the route; getting back is the other.
 *
 * `/admin/voting/contestant/[id]` is reached from the leaderboard (see
 * app/admin/competitions/results/leaderboard-links.test.tsx) and from a pasted
 * link. Once an operator added votes there was nothing on the page pointing back
 * to the contest it belongs to, so the flow ended on a dead screen — an operator
 * voting for three contestants had to re-navigate the leaderboard each time.
 *
 * The back target is the SAME leaderboard the operator came from, addressed by the
 * `contest_id` this page's own fetch supplies: the roster payload from
 * GET /api/v1/connect/contests/:id/contestants has no contest_id at all, so this
 * record is the only place the link can come from. When a contestant has no linked
 * contest, voting is unavailable anyway, so the link falls back to the contest list.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

const base = {
  contestant_id: '01e02692-d38b-4f84-b13c-9363e4ab528d',
  name: 'hello new',
  stage_name: '',
  category: 'Singing',
  state: 'Anambra',
  bio: '',
  photo_url: '',
  media_url: '',
  status: 'approved',
  is_active: true,
  free_votes: 0,
  paid_votes: 0,
  total_votes: 0,
  rank: 1,
};

// Swapped per case: the record this page reads decides where the back link points.
let entry: Record<string, unknown> = { ...base, contest_id: 'c7ab8479-0275-473d-a78f-b923664a3b54' };

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: entry.contestant_id }),
}));

vi.mock('@/services/competitionsService', () => ({
  getContestant: vi.fn(async () => entry),
  castAdminVote: vi.fn(async () => ({})),
}));

import ContestantProfilePage from './page';

describe('contestant profile → back into the contest', () => {
  it('links back to the leaderboard of the contest this record belongs to', async () => {
    entry = { ...base, contest_id: 'c7ab8479-0275-473d-a78f-b923664a3b54' };
    render(<ContestantProfilePage />);

    const back = await screen.findByRole('link', { name: /leaderboard/i });
    expect(back).toHaveAttribute('href', `/admin/competitions/results?contestId=${entry.contest_id}`);
  });

  it('falls back to the contest list when the record has no linked contest', async () => {
    entry = { ...base, contest_id: undefined };
    render(<ContestantProfilePage />);

    const back = await screen.findByRole('link', { name: /leaderboard|contests/i });
    expect(back).toHaveAttribute('href', '/admin/competitions/list');
  });
});
