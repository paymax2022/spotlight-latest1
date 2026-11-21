// The "price to be won", mobile end.
//
// Two rails carry it and they are NOT the same shape:
//   • contests.prize_pool, a free-text headline the console's contest form writes
//     (read by Go as prize_text through the id the mirror preserves), and
//   • voting_contest_prizes, the structured per-position ladder Go returns as
//     `prizes`, which is what the console's prize editor writes.
// contest-details.tsx renders Contest.prizes as bullet lines and paints the FIRST
// one gold as the winner, so everything below is about getting the right strings in
// the right order — and about rendering nothing at all when the organizer has not
// priced the contest, because an empty "Prizes" card reads as a broken contest.
//
// Run: npm run test:voting
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapContest, type BackendContest } from '@/features/voting/api/connectVoting.mapper';

function raw(over: Partial<BackendContest> = {}): BackendContest {
  return {
    id: 'c1',
    title: 'Rising Star 2026',
    status: 'open',
    paid_vote_kobo: 0,
    free_votes_per_user: 1,
    ...over,
  } as BackendContest;
}

test('the prize ladder becomes one line per position, description with its amount', () => {
  const c = mapContest(raw({
    prizes: [
      { position: 1, description: 'Winner', value_kobo: 50_000_000 },
      { position: 2, description: 'Runner-up', value_kobo: 10_000_000 },
    ],
  }));
  assert.deepEqual(c.prizes, ['Winner — ₦500,000', 'Runner-up — ₦100,000']);
});

test('a prize with no amount renders its description alone, not "— ₦0"', () => {
  const c = mapContest(raw({
    prizes: [
      { position: 1, description: 'Grand Prize', value_kobo: 20_000_000 },
      { position: 2, description: 'A management deal', value_kobo: null },
    ],
  }));
  assert.deepEqual(c.prizes, ['Grand Prize — ₦200,000', 'A management deal']);
});

// The gold dot is index 0. If the backend ever drops its ORDER BY position, the
// runner-up wins the top spot on the phone and nothing else notices, so the mapper
// re-sorts rather than trusting the wire.
test('an out-of-order wire is repaired by position before the gold dot lands', () => {
  const c = mapContest(raw({
    prizes: [
      { position: 2, description: 'Runner-up', value_kobo: 10_000_000 },
      { position: 1, description: 'Winner', value_kobo: 50_000_000 },
    ],
  }));
  assert.deepEqual(c.prizes, ['Winner — ₦500,000', 'Runner-up — ₦100,000']);
});

test('a blank description is not a line; a blank description with an amount is just the amount', () => {
  const c = mapContest(raw({
    prizes: [
      { position: 1, description: '   ', value_kobo: 50_000_000 },
      { position: 2, description: '', value_kobo: null },
      { position: 3, description: 'Second runner-up', value_kobo: null },
    ],
  }));
  assert.deepEqual(c.prizes, ['₦500,000', 'Second runner-up']);
});

// The console's contest form writes the free-text headline and the prize editor
// writes the ladder, so a contest can legitimately have only the headline: it must
// still show, as the single gold line.
test('prize_text stands alone when there is no ladder', () => {
  const c = mapContest(raw({ prize_text: '₦500,000 + a management deal' }));
  assert.deepEqual(c.prizes, ['₦500,000 + a management deal']);
});

test('an empty ladder falls back to prize_text too', () => {
  const c = mapContest(raw({ prizes: [], prize_text: '₦1,000,000' }));
  assert.deepEqual(c.prizes, ['₦1,000,000']);
});

// Both rails filled must not read as the same prize twice.
test('the ladder wins over the headline when both are present', () => {
  const c = mapContest(raw({
    prize_text: '₦500,000',
    prizes: [{ position: 1, description: 'Winner', value_kobo: 50_000_000 }],
  }));
  assert.deepEqual(c.prizes, ['Winner — ₦500,000']);
});

// Nothing on either rail means no section at all: contest-details.tsx gates on
// `prizes.length > 0`, so [] and undefined both hide it — but undefined keeps the
// field honest about "this contest has no prize data" instead of "it has zero".
test('a contest nobody priced gets no prizes field, so the section stays hidden', () => {
  assert.equal(mapContest(raw()).prizes, undefined);
  assert.equal(mapContest(raw({ prize_text: '' })).prizes, undefined);
  assert.equal(mapContest(raw({ prize_text: '   ' })).prizes, undefined);
});

// The mapper must not disturb the neighbours it now reads beside.
test('prizes do not disturb the logo, banner or rules mapped in the same pass', () => {
  const c = mapContest(raw({
    logo_url: 'https://x/l.png',
    banner_image_url: 'https://x/b.jpg',
    rules_text: 'One vote a day',
    prize_text: '₦500,000',
  }));
  assert.equal(c.logoImage, 'https://x/l.png');
  assert.equal(c.bannerImage, 'https://x/b.jpg');
  assert.equal(c.rulesText, 'One vote a day');
  assert.deepEqual(c.prizes, ['₦500,000']);
});
