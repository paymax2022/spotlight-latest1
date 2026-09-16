// Pure-logic unit tests for the card rail (top up, then spend).
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/payments/*.spec.ts"
//
// The bug these guard: the card rail used to charge the card directly at Paystack
// for the purchase amount and THEN run the module's charge — which escrows from
// the WALLET. The customer paid twice; and when the wallet was short, the escrow
// failed after the card had already been charged, destroying the PSP money
// (no ledger entry, no settlement, no refund path — the receiving webhook only
// writes an audit row).
//
// The rail now funds the wallet for the exact amount, waits for the webhook to
// credit it, and only then runs the module's ordinary wallet charge. Net wallet
// change is zero and the money travels on one ledger.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardTopupBlockedReason,
  cardOutcome,
  requiresPin,
  pollUntilCredited,
  MIN_CARD_TOPUP_KOBO,
  type TopupStatus,
} from '@/features/payments/paymentFlow';

/** pollUntilCredited with the network fetcher injected — no client import. */
const waitForTopup = (
  ref: string,
  o: { intervalMs?: number; timeoutMs?: number; signal?: () => boolean; now?: () => number;
       fetchStatus: (r: string) => Promise<TopupStatus> },
) => pollUntilCredited(ref, o.fetchStatus, o);

const status = (over: Partial<TopupStatus> = {}): TopupStatus => ({
  reference: 'TOPUP_ABC', status: 'pending', completed: false, amountKobo: 367_500, ...over,
});

describe('cardTopupBlockedReason — refuse before any money moves', () => {
  it('allows a normal purchase amount', () => {
    assert.equal(cardTopupBlockedReason(367_500), null);
    assert.equal(cardTopupBlockedReason(MIN_CARD_TOPUP_KOBO), null);
  });

  it('blocks below the server-side top-up minimum', () => {
    // The server rejects a sub-₦100 top-up. Discovering that AFTER opening the
    // gateway would mean a charged card and no way to complete the purchase, so
    // the check has to happen before the gateway opens.
    assert.ok(cardTopupBlockedReason(MIN_CARD_TOPUP_KOBO - 1));
    assert.ok(cardTopupBlockedReason(1));
  });

  it('blocks non-integer, zero and negative amounts', () => {
    for (const bad of [0, -1, -367_500, 1.5, NaN, Infinity]) {
      assert.ok(cardTopupBlockedReason(bad), `${bad} should be blocked`);
    }
  });

  it('names the wallet as the way forward rather than dead-ending', () => {
    assert.match(String(cardTopupBlockedReason(500)), /wallet/i);
  });
});

describe('cardOutcome — the rule that stopped the double charge', () => {
  it('charges the module ONLY when the top-up is confirmed credited', () => {
    assert.equal(cardOutcome(true), 'charge');
  });

  it('holds when the credit is unconfirmed — never charges on the callback alone', () => {
    // The Paystack success callback is client-side and is not proof of payment.
    // Running the module's wallet charge here is exactly the old defect.
    assert.equal(cardOutcome(false), 'hold_uncredited');
  });
});

describe('the card rail is not PIN-gated', () => {
  it('defers authorisation to the gateway, even though the debit is a wallet debit', () => {
    // The final money move is a wallet debit, but the customer authorised it by
    // entering card details for this exact amount seconds earlier. Asking for a
    // PIN too would be a second authorisation for one payment.
    assert.equal(requiresPin('card', true), false);
    assert.equal(requiresPin('wallet', true), true);
  });
});

describe('waitForTopup — only a real credit lets the purchase proceed', () => {
  it('resolves true once the intent completes', async () => {
    let calls = 0;
    const ok = await waitForTopup('TOPUP_ABC', {
      intervalMs: 1,
      fetchStatus: async () => {
        calls += 1;
        return calls < 3 ? status() : status({ status: 'completed', completed: true });
      },
    });
    assert.equal(ok, true);
    assert.equal(calls, 3);
  });

  it('resolves false immediately when the intent fails — no charge on a failed top-up', () => {
    return waitForTopup('TOPUP_ABC', {
      intervalMs: 1,
      fetchStatus: async () => status({ status: 'failed' }),
    }).then((ok) => assert.equal(ok, false));
  });

  it('resolves false on timeout rather than assuming success', async () => {
    // A slow webhook must NOT be read as a credit. The customer's money is
    // recorded against the intent and still lands in their wallet; guessing here
    // would debit a wallet that has not been funded.
    let t = 0;
    const ok = await waitForTopup('TOPUP_ABC', {
      intervalMs: 1,
      timeoutMs: 50,
      now: () => (t += 20),
      fetchStatus: async () => status(),
    });
    assert.equal(ok, false);
  });

  it('keeps polling through transient status errors', async () => {
    let calls = 0;
    const ok = await waitForTopup('TOPUP_ABC', {
      intervalMs: 1,
      fetchStatus: async () => {
        calls += 1;
        if (calls < 3) throw new Error('network');
        return status({ status: 'completed', completed: true });
      },
    });
    assert.equal(ok, true);
  });

  it('aborts when the caller signals, without claiming a credit', async () => {
    const ok = await waitForTopup('TOPUP_ABC', {
      intervalMs: 1,
      signal: () => true,
      fetchStatus: async () => status({ status: 'completed', completed: true }),
    });
    assert.equal(ok, false);
  });
});
