// The gate that told a voter "paid voting is unavailable for this contest" while
// six purchasable packages sat on the same screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPaidVotingAvailability } from '@/features/voting/utils/paidVoting';

const pkg = { id: 'p1', name: 'VIP Pack', votes: 50, amount: 5000 };

test('a per-vote price makes paid voting available', () => {
  const r = getPaidVotingAvailability({ paidVotingEnabled: true }, []);
  assert.equal(r.available, true);
  assert.equal(r.reason, 'per_vote_price');
});

test('packages alone make paid voting available — the bug being fixed', () => {
  // paidVotingEnabled is false because connect_contests.paid_vote_kobo is 0,
  // which is exactly the state every seeded contest is in.
  const r = getPaidVotingAvailability({ paidVotingEnabled: false }, [pkg]);
  assert.equal(r.available, true);
  assert.equal(r.reason, 'packages');
});

test('no price and no packages is genuinely nothing on sale', () => {
  const r = getPaidVotingAvailability({ paidVotingEnabled: false }, []);
  assert.equal(r.available, false);
  assert.equal(r.reason, 'nothing_on_sale');
});

test('a pending package query is unknown, never "unavailable"', () => {
  // Returning false here flashes a closed banner and then contradicts it.
  for (const loading of [undefined, null]) {
    const r = getPaidVotingAvailability({ paidVotingEnabled: false }, loading);
    assert.equal(r.available, undefined);
    assert.equal(r.reason, 'loading');
  }
});

test('an unloaded contest with packages still opens', () => {
  assert.equal(getPaidVotingAvailability(undefined, [pkg]).available, true);
  assert.equal(getPaidVotingAvailability(null, [pkg]).available, true);
});

test('an unloaded contest with no packages yet is unknown, not closed', () => {
  assert.equal(getPaidVotingAvailability(undefined, undefined).available, undefined);
});

// ---------------------------------------------------------------------------
// Drift guard.
//
// buy-votes was fixed first and payment-method was not, so the voter cleared one
// screen only to be refused on the next with the same wrong message. Both now
// share getPaidVotingAvailability; this fails if a screen goes back to reading
// the flag directly.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test('no voting screen gates a purchase on contest.paidVotingEnabled directly', () => {
  const dir = join(process.cwd(), 'app/voting');
  const offenders: string[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(join(dir, file), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      // contest-details merely DISPLAYS the flag ("Paid voting: Yes/No"), which
      // is fine. Only a gate — a line that decides whether voting is closed —
      // is an offender.
      if (/paidVotingEnabled/.test(line) && /votingClosed|disabled|return|&&\s*!/.test(line)) {
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `gate the purchase on getPaidVotingAvailability instead:\n${offenders.join('\n')}`);
});
