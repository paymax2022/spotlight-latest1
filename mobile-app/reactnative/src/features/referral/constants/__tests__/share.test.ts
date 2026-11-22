// node --experimental-strip-types --test "src/features/referral/constants/__tests__/*.test.ts"
//
// The profile tab shows the signed-in user's own code beside a Share action. The pair
// has to be built from whatever the dashboard returned, and the two rules the screen
// cannot reason about inline live here: an account with no code yields NOTHING (a share
// sheet reading "use my code undefined" sends people to an unattributed signup), and the
// link must carry the code that is displayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referralShare } from '../share.ts';

test('builds the invite link from the code when the API returned none', () => {
  assert.deepEqual(referralShare('ABCDE'), {
    code: 'ABCDE',
    link: 'https://spotlight.ng/j/ABCDE',
  });
});

test('keeps the link the engine returned', () => {
  assert.deepEqual(
    referralShare('JIDE4', 'https://spotlight.ng/j/JIDE4?src=profile'),
    { code: 'JIDE4', link: 'https://spotlight.ng/j/JIDE4?src=profile' },
  );
});

// A cached code paired with another fetch's link would invite people with the wrong
// attribution, so a link that does not carry the code counts as no link.
test('drops a link that does not contain the code', () => {
  assert.deepEqual(referralShare('ABCDE', 'https://spotlight.ng/j/ZZZZZ'), {
    code: 'ABCDE',
    link: 'https://spotlight.ng/j/ABCDE',
  });
});

// Nothing to show, nothing to share.
test('no code means no share payload', () => {
  for (const empty of [undefined, null, '', '   ']) {
    assert.equal(referralShare(empty), null, `expected null for ${JSON.stringify(empty)}`);
  }
});

// Codes are stored upper-cased; a legacy lower-case row has to be presented the way the
// attribution lookup resolves it, and without the padding a stored value can carry.
test('trims and upper-cases what is displayed and shared', () => {
  const share = referralShare('  k7qx2  ');
  assert.ok(share);
  assert.equal(share.code, 'K7QX2');
  assert.equal(share.link, 'https://spotlight.ng/j/K7QX2');
});
