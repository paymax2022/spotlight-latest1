// "Paid voting amount is not showing" survives its first fix on two screens:
// My Votes and the vote receipt. PR #1170 fixed the packages a voter BUYS
// (mapVotePackage, naira -> kobo). The log of votes already CAST goes through a
// different seam, `toVoteTransaction`, and that seam divided by 100 on the way
// out — while every renderer of its result, `app/voting/my-votes.tsx:110` and
// `src/features/voting/components/VoteReceiptCard.tsx:55`, calls
// `formatAmount(amount)`, which divides by 100 AGAIN. A ₦500 vote therefore
// printed "₦5": a paid row that looks like a rounding error, and a receipt whose
// amount contradicts the payment the gateway actually took.
//
// The unit this suite pins is the one the client already uses everywhere else:
//   - VotePackage.amount is kobo (votePackagePrice.spec.ts, #1170), and
//     payment-method.tsx hands it to checkout.start({ amountKobo }).
//   - MOCK_VOTE_TRANSACTIONS writes `amount: 400_00`, i.e. kobo for ₦400.
//   - formatAmount's own parameter is named `kobo`.
// So VoteTransaction.amount is kobo, full stop, and the mapping must not
// pre-divide. Asserted by execution rather than by reading the source: this is
// arithmetic that was wrong by exactly the factor a regex cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toVoteTransaction, type ConnectVoteRow } from '@/features/voting/api/connectVoting.mapper';
import { formatAmount } from '@/features/voting/utils/voteFormatters';

/** Verbatim shape of one /api/v1/connect/votes/mine row: ₦500 paid for 50 votes. */
const paidRow: ConnectVoteRow = {
  id: '0f6a1c2e-3b4d-4e5f-6a7b-8c9d0e1f2a3b',
  contest_id: 'b2737863-33b8-4786-8e12-664b13360fd3',
  contest_title: 'Spotlight Open Mic',
  contestant_id: '7da04d1c-19da-4ee2-9e4d-9d056627c8ef',
  contestant_name: 'test sdsd',
  photo_url: '',
  paid: true,
  quantity: 50,
  amount_kobo: 50000,
  created_at: '2026-11-25T09:00:00Z',
};

const freeRow: ConnectVoteRow = {
  ...paidRow,
  id: 'aa112233-4455-6677-8899-aabbccddeeff',
  paid: false,
  quantity: 1,
  amount_kobo: 0,
};

test('a paid vote keeps its amount in KOBO across the seam', () => {
  assert.equal(toVoteTransaction(paidRow).amount, 50000);
});

test('the amount My Votes prints is the amount the voter paid', () => {
  const tx = toVoteTransaction(paidRow);
  // The screen's line is exactly this call: formatAmount(tx.amount).
  assert.equal(tx.amount != null ? formatAmount(tx.amount) : '', '₦500');
});

test('the receipt card and the list agree — one divide, not two', () => {
  const tx = toVoteTransaction(paidRow);
  // Whatever the renderer does, the mapped value must still equal the log's own
  // kobo figure, so no consumer can be handed a pre-divided number.
  assert.equal(tx.amount, paidRow.amount_kobo);
});

test('the mapped amount matches the package price that was charged', () => {
  // Supporter Pack costs ₦2,500 => 250000 kobo; a vote cast against it must read
  // back at the same figure the package card showed (#1170's mapVotePackage).
  const row: ConnectVoteRow = { ...paidRow, amount_kobo: 250000 };
  assert.equal(toVoteTransaction(row).amount, 250000);
  assert.equal(toVoteTransaction(row).amount != null ? formatAmount(toVoteTransaction(row).amount!) : '', '₦2,500');
});

test('a free vote carries no amount at all', () => {
  const tx = toVoteTransaction(freeRow);
  assert.equal(tx.voteType, 'FREE');
  assert.equal(tx.amount, undefined);
});

test('the vote type, votes and status still translate (regression guard)', () => {
  const tx = toVoteTransaction(paidRow);
  assert.equal(tx.voteType, 'PAID');
  assert.equal(tx.votes, 50);
  assert.equal(tx.status, 'SUCCESSFUL');
  assert.equal(tx.reference, paidRow.id);
  assert.equal(tx.contestantPhoto, undefined);
});
