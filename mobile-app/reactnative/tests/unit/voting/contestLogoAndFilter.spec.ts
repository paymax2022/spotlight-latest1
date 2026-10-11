// Contest logo + the Active/Closed list filter, mobile side.
// The logo travels Go `logo_url` -> mapContest -> Contest.logoImage -> card/hero.
// A logo that silently maps to undefined is invisible as a bug (the screens just
// render as before), so the mapper end is pinned here.
// The filter is applied client-side as well as sent to the API: the list must
// show only Active (default) or only Closed contests even against a backend that
// has not yet deployed the `?status=` param and still returns both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapContest, type BackendContest } from '@/features/voting/api/connectVoting.mapper';
import {
  CONTEST_FILTER_OPTIONS,
  DEFAULT_CONTEST_FILTER,
  contestFilterFromLabel,
  contestFilterLabel,
  contestFilterApiStatus,
  filterContestsByStatus,
} from '@/features/voting/utils/contestFilter';
import type { Contest } from '@/features/voting/types/voting.types';

function raw(over: Partial<BackendContest> = {}): BackendContest {
  return {
    id: 'c1',
    title: 'Open Mic Season 3',
    status: 'open',
    paid_vote_kobo: 0,
    free_votes_per_user: 1,
    ...over,
  } as BackendContest;
}

function contest(id: string, status: Contest['status']): Contest {
  return { id, title: id, category: '', status, contestantCount: 0, totalVotes: 0 } as Contest;
}

test('logo_url on the wire reaches the screens as logoImage', () => {
  assert.equal(mapContest(raw({ logo_url: 'https://x/contests/logos/a.png' })).logoImage, 'https://x/contests/logos/a.png');
});

test('an empty or absent logo becomes undefined', () => {
  assert.equal(mapContest(raw({ logo_url: '' })).logoImage, undefined);
  assert.equal(mapContest(raw()).logoImage, undefined);
});

test('the logo does not disturb the banner beside it', () => {
  const c = mapContest(raw({ banner_image_url: 'https://x/b.jpg', logo_url: 'https://x/l.png' }));
  assert.equal(c.bannerImage, 'https://x/b.jpg');
  assert.equal(c.logoImage, 'https://x/l.png');
});

test('the default filter is Active', () => {
  assert.equal(DEFAULT_CONTEST_FILTER, 'active');
  assert.equal(contestFilterLabel(DEFAULT_CONTEST_FILTER), 'Active contests');
});

test('the dropdown offers Active first, then Closed, and nothing else', () => {
  assert.deepEqual(CONTEST_FILTER_OPTIONS, ['Active contests', 'Closed contests']);
});

test('labels round-trip and unknown labels fall back to the default', () => {
  assert.equal(contestFilterFromLabel('Closed contests'), 'closed');
  assert.equal(contestFilterFromLabel('Active contests'), 'active');
  assert.equal(contestFilterFromLabel('whatever'), 'active');
});

test('the API status sent matches the backend allowlist', () => {
  assert.equal(contestFilterApiStatus('active'), 'active');
  assert.equal(contestFilterApiStatus('closed'), 'closed');
});

test('active shows only LIVE contests; closed only CLOSED; upcoming is never listed', () => {
  const all = [contest('a', 'LIVE'), contest('b', 'CLOSED'), contest('c', 'UPCOMING'), contest('d', 'LIVE')];
  assert.deepEqual(filterContestsByStatus(all, 'active').map((c) => c.id), ['a', 'd']);
  assert.deepEqual(filterContestsByStatus(all, 'closed').map((c) => c.id), ['b']);
});
