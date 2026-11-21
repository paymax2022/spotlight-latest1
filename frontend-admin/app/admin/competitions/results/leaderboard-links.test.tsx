/**
 * The leaderboard row is the only way an operator reaches a contestant.
 *
 * `app/admin/voting/contestant/[id]/page.tsx` renders the real profile and the
 * admin-vote form, but nothing linked to it: the results table printed each name
 * as inert text, so an operator looking at a ranked contestant had no way to open
 * that contestant — and the admin-vote surface was effectively undiscoverable.
 *
 * These tests pin the one behaviour that connects the two pages: every row of the
 * leaderboard exposes its contestant as a link to that contestant's profile,
 * addressed by the `contestant_id` the roster row carries. The id matters — the
 * detail route is keyed on the contestant alone (`GET /api/v1/connect/contestants/:id`),
 * which is also where `contest_id` comes from for the vote form (the roster payload
 * does not include it).
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

const { roster } = vi.hoisted(() => ({
  roster: [
    {
      contestant_id: '87ad2762-bd98-4f61-9bc9-b2a86807be83',
      name: 'Acceptance MC e2e',
      stage_name: '',
      category: 'Open Mic',
      state: '',
      bio: '',
      photo_url: '',
      media_url: '',
      status: 'approved',
      is_active: true,
      free_votes: 4,
      paid_votes: 6,
      total_votes: 10,
      rank: 1,
    },
    {
      contestant_id: '01e02692-d38b-4f84-b13c-9363e4ab528d',
      name: 'hello new',
      stage_name: 'Stage Two',
      category: 'Open Mic',
      state: 'Lagos',
      bio: '',
      photo_url: '',
      media_url: '',
      status: 'approved',
      is_active: true,
      free_votes: 1,
      paid_votes: 0,
      total_votes: 1,
      rank: 2,
    },
  ],
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('contestId=contest-1'),
}));

vi.mock('@/services/competitionsService', () => ({
  listVotingContests: vi.fn(async () => [
    {
      id: 'contest-1',
      title: 'Open Mic 2026',
      status: 'open',
      paid_vote_kobo: 10000,
      free_votes_per_user: 1,
      velocity_per_minute: 5,
      created_at: '2026-11-01T00:00:00Z',
      contestant_count: 2,
      total_votes: 11,
    },
  ]),
  getContestRoster: vi.fn(async () => roster),
}));

import CompetitionsResultsPage from './page';

describe('Results & Leaderboard → contestant profile', () => {
  it('links every ranked contestant to their own profile page', async () => {
    render(<CompetitionsResultsPage />);

    const rows = await screen.findAllByRole('link', { name: /Acceptance MC e2e|hello new/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', `/admin/voting/contestant/${roster[0].contestant_id}`);
    expect(rows[1]).toHaveAttribute('href', `/admin/voting/contestant/${roster[1].contestant_id}`);
  });
});
