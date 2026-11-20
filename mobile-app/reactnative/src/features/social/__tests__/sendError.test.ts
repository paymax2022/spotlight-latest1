// Pure-logic tests for the cashtag send failure classifier.
// Run with Node's native TS type-stripping:
//   node --experimental-strip-types --test src/features/social/__tests__/sendError.test.ts
// (npm run test:social-send)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySendFailure, customerCopy } from '../sendError.ts';

/** Build the axios-shaped error the screen actually catches. */
const http = (status: number, data?: unknown) => ({ isAxiosError: true, response: { status, data } });
const offline = () => ({ isAxiosError: true, message: 'Network Error' });

test('a short wallet becomes a top-up dialog naming both amounts', () => {
  const f = classifySendFailure(
    http(402, { success: false, error: 'insufficient wallet balance', code: 'INSUFFICIENT_BALANCE' }),
    { amountLabel: '₦2,500', balanceLabel: '₦310.00' },
  );
  assert.equal(f.kind, 'insufficient_funds');
  assert.equal(f.title, 'Insufficient wallet balance');
  assert.match(f.message, /₦2,500/);
  assert.match(f.message, /₦310\.00/);
  assert.equal(f.cta, 'top_up');
  assert.equal(f.ctaLabel, 'Top up wallet');
});

test('the 402 is recognised even when only the code, or only the text, survives', () => {
  // A client that lost the status (proxy rewrite, older envelope).
  assert.equal(classifySendFailure({ code: 'INSUFFICIENT_BALANCE' }).kind, 'insufficient_funds');
  // The Go wrap, prefix stripped, still says "insufficient".
  assert.equal(
    classifySendFailure(http(400, { error: 'social: send debit: ledger: insufficient funds' })).kind,
    'insufficient_funds',
  );
});

test('short-wallet copy degrades to a generic amount line when the balance is unknown', () => {
  const f = classifySendFailure(http(402, { code: 'INSUFFICIENT_BALANCE' }));
  assert.equal(f.kind, 'insufficient_funds');
  assert.doesNotMatch(f.message, /undefined/);
  assert.match(f.message, /Add money to your wallet/);
});

test('a tier-0 wallet is sent to verification, not to a top-up', () => {
  // A top-up would be the wrong advice: the debit gate, not the balance, refused it.
  const f = classifySendFailure(http(403, { error: 'tiers: wallet disabled for tier 0 — complete kyc to activate' }));
  assert.equal(f.kind, 'kyc_required');
  assert.equal(f.cta, 'verify');
});

test('daily-limit refusals (403 and AML 429) both name the tier upgrade', () => {
  for (const e of [
    http(403, { error: 'tiers: daily debit limit exceeded' }),
    http(429, { error: 'social: daily transfer amount limit reached' }),
  ]) {
    const f = classifySendFailure(e);
    assert.equal(f.kind, 'daily_limit');
    assert.match(f.message, /KYC tier/);
    assert.equal(f.cta, 'verify');
  }
});

test('an unknown cashtag is described as one, not as a crash', () => {
  const f = classifySendFailure(http(404, { error: 'not found' }));
  assert.equal(f.kind, 'recipient_not_found');
  assert.match(f.message, /@cashtag/);
  assert.equal(f.cta, 'none');
});

test('a request that never reached the server says so', () => {
  const f = classifySendFailure(offline());
  assert.equal(f.kind, 'network');
  assert.match(f.message, /internet connection/);
});

test('a locally thrown error is NOT blamed on the connection', () => {
  // A screen guard or a bad input has no response object; telling the user to
  // check their wifi would send them debugging the wrong thing.
  assert.equal(classifySendFailure(new Error('Invalid transfer details.')).kind, 'failed');
});

test('a server-side failure makes no promise about whether money moved', () => {
  for (const f of [classifySendFailure(http(503, { error: 'social: money path requires a tier gate (not wired)' })), classifySendFailure(http(500))]) {
    assert.equal(f.kind, 'unavailable');
    assert.doesNotMatch(f.message, /not (been )?(charged|debited)|has not left/i);
  }
});

test('an unmapped 400 keeps the server copy, with the internal prefix stripped', () => {
  const f = classifySendFailure(http(400, { error: 'social: cannot send to yourself' }));
  assert.equal(f.kind, 'failed');
  assert.equal(f.message, 'cannot send to yourself');
});

test('customerCopy strips known module prefixes, and only those', () => {
  assert.equal(customerCopy('ledger: insufficient funds'), 'insufficient funds');
  assert.equal(customerCopy('social: cannot send to yourself'), 'cannot send to yourself');
  // A mid-chain wrap ("send debit:") is not a module name: stripping anything
  // that ends in a colon would also eat ordinary copy like the next line.
  assert.equal(customerCopy('Payment failed: card declined'), 'Payment failed: card declined');
  assert.equal(customerCopy(''), '');
  assert.equal(customerCopy(null), '');
});

test('the wrapped multi-prefix text still routes to the top-up dialog', () => {
  // Classification does not depend on customerCopy getting the wrap off
  // perfectly — "insufficient" survives the strip and still decides the kind.
  const f = classifySendFailure(http(400, { error: 'social: send debit: ledger: insufficient funds' }));
  assert.equal(f.kind, 'insufficient_funds');
  assert.equal(f.cta, 'top_up');
  assert.doesNotMatch(f.message, /ledger|social:/);
});

test('a non-error throw (undefined) still yields a dialog, never a crash', () => {
  for (const junk of [undefined, null, 'boom', {}, new Error('boom')]) {
    const f = classifySendFailure(junk);
    assert.ok(typeof f.title === 'string' && f.title.length > 0);
    assert.ok(typeof f.message === 'string' && f.message.length > 0);
  }
});
