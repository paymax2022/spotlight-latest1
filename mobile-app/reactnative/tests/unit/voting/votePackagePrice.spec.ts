// "Paid vote shows ₦0" on /voting/contestant-profile (and buy-votes, the
// package cards, and the confirmation sheet — four surfaces, one mapper).
//
// Root cause: /api/v1/contests/:id/vote-packages answers with the BFF's server
// DTO — camelCase, and `amount` in NAIRA (vote_packages.amount is a major-unit
// numeric(12,2); the admin console writes naira into it). The mobile mapper read
// `r.priceKobo`, a field that exists in no response, so `Number(undefined ?? 0)`
// produced 0 for every package, `formatAmount(0)` printed ₦0, and the same 0 was
// handed to the payment sheet as `amountKobo`.
//
// Two invariants this suite pins, because they were each asserted in a comment
// and contradicted in code:
//   1. VotePackage.amount is KOBO on the client. payment-method.tsx passes it
//      straight to checkout.start({ amountKobo }), and the server re-prices the
//      order from packageId — a wrong client figure is a wrong charge request,
//      never a corrected one.
//   2. The conversion is exactly ×100 from the naira column, matching
//      frontend-web's own `amount * 100` coin math (vote-payment-order) and the
//      admin display (`amount * 100, 'KOBO'`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapVotePackage, type BackendVotePackage } from '@/features/voting/api/connectVoting.mapper';

/** Verbatim from `curl localhost:3000/api/v1/contests/<openmic>/vote-packages`. */
const starter: BackendVotePackage = {
  id: '90b32057-05ca-4749-97ba-3649b624a3ea',
  contestId: 'b2737863-33b8-4786-8e12-664b13360fd3',
  name: 'Starter Pack',
  description: 'Get started supporting your favourite contestant.',
  votes: 10,
  bonusVotes: 0,
  totalVotes: 10,
  amount: 500,
  currency: 'NGN',
  isActive: true,
  isRecommended: false,
  promoLabel: null,
  displayOrder: 1,
};

const supporter: BackendVotePackage = {
  ...starter,
  id: 'a8d68b15-1889-4759-8db2-fdd97b5787f3',
  name: 'Supporter Pack',
  votes: 50,
  totalVotes: 50,
  amount: 2500,
  isRecommended: true,
};

test('a naira price becomes the kobo the charge is made of — never 0', () => {
  assert.equal(mapVotePackage(starter).amount, 50_000);
  assert.equal(mapVotePackage(supporter).amount, 250_000);
});

test('the mapped amount renders as the price the organizer set', () => {
  // The bug was visible as ₦0; the guard is that ₦500 survives the mapping.
  assert.equal(formatAmountKobo(mapVotePackage(starter).amount), '₦500');
});

test('a fractional naira price rounds to whole kobo', () => {
  assert.equal(mapVotePackage({ ...starter, amount: 1999.99 }).amount, 199_999);
  assert.equal(mapVotePackage({ ...starter, amount: 50.5 }).amount, 5_050);
});

test('a missing or non-numeric price maps to 0 rather than NaN', () => {
  // A blank would still print ₦0, but NaN would print "NaN" and hand a NaN
  // amountKobo to the gateway.
  for (const amount of [undefined, null, 0, 'abc']) {
    const out = mapVotePackage({ ...starter, amount: amount as unknown as number | undefined });
    assert.equal(Number.isNaN(out.amount), false, `amount ${String(amount)} must not be NaN`);
    assert.equal(out.amount, 0);
  }
});

test('the label comes from the DTO name, and the badge from isRecommended', () => {
  // `label` and `popular` are not fields the endpoint answers with, so the
  // promo ribbon silently never appeared either.
  assert.equal(mapVotePackage(supporter).label, 'Supporter Pack');
  assert.equal(mapVotePackage(supporter).isPopular, true);
  assert.equal(mapVotePackage(starter).isPopular, false);
});

test('base votes and bonus stay separate — the card adds them itself', () => {
  // VotePackageCard renders `votes + bonusVotes` as the headline and
  // `votes + " + N bonus"` underneath. Collapsing them into totalVotes here
  // would print 150 votes on a 125-vote pack: the server already sends both
  // fields, so pass them through and let the one renderer do the sum.
  const out = mapVotePackage({ ...starter, votes: 100, bonusVotes: 25, totalVotes: 125 });
  assert.equal(out.votes, 100);
  assert.equal(out.bonusVotes, 25);
  assert.equal(out.votes + (out.bonusVotes ?? 0), 125);
});

test('a zero bonus does not render a bonus row', () => {
  // The card gates the row on `pkg.bonusVotes` being truthy; the live rows carry
  // 0, not null, so a 0 must not become a "10 + 0 bonus" line.
  const out = mapVotePackage({ ...starter, votes: 10, bonusVotes: 0, totalVotes: 10 });
  assert.equal(out.votes, 10);
  assert.equal(out.bonusVotes ? out.bonusVotes : 0, 0);
});

// ── Drift guards ────────────────────────────────────────────────────────────

const apiSrc = readFileSync(
  join(process.cwd(), 'src/features/voting/api/voting.api.ts'),
  'utf8',
);
const fn = apiSrc.slice(
  apiSrc.indexOf('export async function getVotePackages'),
  apiSrc.indexOf('export async function getVoteReceipt'),
);

test('getVotePackages goes through the mapped, tested shape', () => {
  assert.match(
    fn,
    /mapVotePackage/,
    'the mapper is where the naira→kobo rule lives; a re-inlined map re-opens ₦0',
  );
});

test('nothing reads the priceKobo field that no endpoint returns', () => {
  assert.doesNotMatch(
    apiSrc,
    /priceKobo/,
    'priceKobo is not in the response of /api/v1/contests/:id/vote-packages — reading it yields 0',
  );
});

test('the client unit stays kobo at the gateway boundary', () => {
  const pay = readFileSync(join(process.cwd(), 'app/voting/payment-method.tsx'), 'utf8');
  assert.match(
    pay,
    /amountKobo:\s*totalAmount/,
    'payment-method passes the client amount as kobo; if that ever changes, the ×100 here must change with it',
  );
});

// Small local copy of the formatter rule so this file has no React Native
// import chain: the screen renders formatAmount(pkg.amount), which divides kobo
// by 100.
function formatAmountKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}
