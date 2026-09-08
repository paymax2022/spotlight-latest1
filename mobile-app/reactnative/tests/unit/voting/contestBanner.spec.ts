// The contest banner, from the Go payload to what the screens render.
//
// ContestCard and ContestHero already draw `contest.bannerImage` and fall back
// to a placeholder tile when it is absent — that has been true since before a
// banner could be set. What was missing was anything to populate it: the column
// did not exist, so only the mock fixtures ever had one and every real contest
// showed the placeholder.
//
// This pins the mapper end of that wiring. It matters because a banner that
// silently maps to undefined is INVISIBLE as a bug: the screens render exactly
// as they always did, so an admin who uploaded an image simply never sees it
// and has nothing to report beyond "it didn't work".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapContest, type BackendContest } from '@/features/voting/api/connectVoting.mapper';

function raw(over: Partial<BackendContest> = {}): BackendContest {
  return {
    id: 'c1',
    title: 'Open Mic Season 3',
    status: 'open',
    paid_vote_kobo: 10_000,
    free_votes_per_user: 3,
    ...over,
  } as BackendContest;
}

test('a banner url on the wire reaches the screens as bannerImage', () => {
  const c = mapContest(raw({ banner_image_url: 'https://cdn.example/contests/banners/a.jpg' }));
  assert.equal(c.bannerImage, 'https://cdn.example/contests/banners/a.jpg');
});

test('an empty banner becomes undefined, not an empty string', () => {
  // The column is NOT NULL DEFAULT '', so every contest without a banner sends
  // ''. The screens branch on truthiness, but an empty string reaching an
  // <Image source={{uri: ''}}> is a broken-image request rather than the
  // placeholder tile the fallback is meant to show.
  assert.equal(mapContest(raw({ banner_image_url: '' })).bannerImage, undefined);
});

test('an absent banner field is tolerated', () => {
  // Older Go builds predate the column and simply omit it; the field is
  // `omitempty` on the Go struct, so absence is normal rather than exceptional.
  assert.equal(mapContest(raw()).bannerImage, undefined);
});

test('adding the banner did not disturb rulesText beside it', () => {
  // Both are optional strings mapped the same way one line apart. A copy-paste
  // slip here would silently blank the admin-configurable rules.
  const c = mapContest(raw({ rules_text: 'No lip-syncing.', banner_image_url: 'https://x/y.png' }));
  assert.equal(c.rulesText, 'No lip-syncing.');
  assert.equal(c.bannerImage, 'https://x/y.png');
});
