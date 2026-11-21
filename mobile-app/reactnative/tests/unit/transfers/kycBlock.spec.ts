// A Tier-0 wallet answers a CORRECT PIN with a 403 that no number of retries can
// clear. The sheet used to print that sentence and offer nothing, so the customer
// had to dismiss it and go find KYC themselves. These tests pin the detector that
// puts the button there — including the trap that a looser match falls into:
// "Could not verify transaction PIN." must NOT grow a KYC button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kycBlockFor } from '@/features/transfers/kycBlock';

/** Next.js envelope: `{ success:false, error, code }`. */
const nextErr = (status: number, body: Record<string, unknown>) => ({
  message: 'Request failed with status code ' + status,
  response: { status, data: body },
});

/** Go envelope: `{ message, code }`. */
const goErr = (status: number, body: Record<string, unknown>) => nextErr(status, body);

const WALLET_DISABLED =
  'Wallet is disabled for unverified accounts. Complete KYC to enable your wallet.';

test('a coded wallet_disabled offers verification and keeps the server wording', () => {
  const block = kycBlockFor(nextErr(403, { error: WALLET_DISABLED, code: 'wallet_disabled' }));
  assert.ok(block, 'expected a KYC block');
  assert.equal(block!.label, 'Verify my account');
  assert.equal(block!.message, WALLET_DISABLED);
});

test('the Go rail\'s message-shaped envelope is read the same way', () => {
  const block = kycBlockFor(goErr(403, { message: WALLET_DISABLED, code: 'wallet_disabled' }));
  assert.equal(block!.label, 'Verify my account');
  assert.equal(block!.message, WALLET_DISABLED);
});

test('a daily-limit refusal asks to raise the limit, not to verify from scratch', () => {
  const block = kycBlockFor(
    nextErr(403, { error: 'Daily wallet limit of ₦50,000 reached for your KYC tier.', code: 'daily_limit_exceeded' }),
  );
  assert.equal(block!.label, 'Raise my limit');
});

// The tier gate only started returning `code` alongside this change; a client
// shipped before it, or talking to an older deployment, still has to recognise
// the refusal from prose.
test('prose without a code is still recognised, so the button works today', () => {
  const block = kycBlockFor(nextErr(403, { error: WALLET_DISABLED }));
  assert.equal(block!.label, 'Verify my account');
  assert.equal(block!.message, WALLET_DISABLED);
});

test('a wrong PIN stays a wrong PIN', () => {
  assert.equal(kycBlockFor(nextErr(403, { error: 'Incorrect PIN. 2 attempt(s) remaining.', code: 'pin_invalid' })), null);
});

test('"Could not verify transaction PIN." does not grow a KYC button', () => {
  assert.equal(kycBlockFor(nextErr(403, { error: 'Could not verify transaction PIN.' })), null);
  assert.equal(kycBlockFor(nextErr(503, { error: 'Could not verify transaction PIN. Please try again.' })), null);
});

test('a locked or absent PIN is not a tier problem', () => {
  assert.equal(kycBlockFor(nextErr(403, { error: 'Your transaction PIN is locked. Try again later.', code: 'pin_locked' })), null);
  assert.equal(kycBlockFor(nextErr(403, { error: 'You have not set a transaction PIN yet.', code: 'pin_not_set' })), null);
});

test('insufficient balance and a missing recipient are not tier problems', () => {
  assert.equal(kycBlockFor(nextErr(402, { error: 'Insufficient wallet balance', code: 'insufficient_funds' })), null);
  assert.equal(kycBlockFor(nextErr(404, { error: 'No Paymax account matches that number.', code: 'recipient_not_found' })), null);
});

// Only the 403 gate carries a tier refusal. A 400 that happens to mention KYC is
// somebody else's message and must not be reinterpreted here.
test('non-403 prose is not promoted into a KYC block', () => {
  assert.equal(kycBlockFor(nextErr(400, { error: 'kyc payload rejected' })), null);
});

test('a request that never reached the server retries, with no button', () => {
  assert.equal(kycBlockFor(new Error('Network Error')), null);
});

test('a code with no message still reads as an instruction, not as blank text', () => {
  const block = kycBlockFor(nextErr(403, { code: 'wallet_disabled' }));
  assert.ok(block);
  assert.match(block!.message, /verify your identity/i);
  assert.doesNotMatch(block!.message, /undefined|null/);
});

// ── Verbatim production copy ────────────────────────────────────────────────
// The cases above paraphrase. These two are copied character-for-character from
// the throw sites, so a rewrite of the server's wording that keeps the meaning
// cannot silently break the detector — and the per-bill refusal proves the
// fallback earns its keep: that branch throws 403 with NO code at all
// (frontend-web `src/server/tiers/service.ts`, `enforceWalletLimit`).
test('the real per-bill Tier-1 refusal, which ships no code, still gets the button', () => {
  const block = kycBlockFor(nextErr(403, {
    error: 'This payment requires KYC Tier 1. Unverified accounts can pay up to ₦25,000 per bill — verify your identity to pay more.',
  }));
  assert.ok(block, 'expected a KYC block for the codeless 403');
  // First verification, not a limit raise: this member has no tier to climb yet.
  assert.equal(block!.label, 'Verify my account');
});

// The race guard in `src/server/transfers/wallet-to-wallet.ts` words the same
// refusal differently from the tier gate; both must land on 'Raise my limit'.
test('the rail\'s second daily-limit wording reaches the same conclusion', () => {
  const block = kycBlockFor(nextErr(403, {
    error: 'Daily wallet limit for your KYC tier has been reached',
    code: 'daily_limit_exceeded',
  }));
  assert.equal(block!.label, 'Raise my limit');
});
