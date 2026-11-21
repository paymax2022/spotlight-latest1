// The KYC tier ladder and the Tier-0 notice, as the customer reads them.
//   npm run test:account
//
// Why this file exists: a staging customer held ₦10,030 at Tier 0, tried to send
// ₦1,000, and was refused with `wallet_disabled` — "Complete KYC to enable your
// wallet". They then used the option this screen labels "Tier 0 — Quick
// Activation", saw "KYC Verified", retried, and were refused again. Both refusal
// calls are correct: ADR-001 makes Tier 0 ₦0/day and ADR-043 deliberately keeps
// transfers and withdrawals out of any Tier-0 allowance. The screen was the part
// that lied — it advertised Tier 0 as "₦10,000 / day", a figure that appears in
// NO enforcement ladder (the closest real number is the ₦10,000 PER-PURCHASE
// checkout cap in backend/internal/finance/tiers service.go `CheckoutMaxSingleKobo`).
//
// These tests pin the copy to what the two gates actually do, so the guidance a
// refusal gives cannot drift back into a dead end.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tierWalletLimitLabel, tier0ClaimPanelCopy, walletTierNotice } from '@/features/account/tierCopy';

/** Any "₦X / day" string is a promise that a Tier-0 wallet can spend daily. */
const DAILY_SPEND_PROMISE = /₦[\d,]+\s*\/\s*day/;

describe('tierWalletLimitLabel', () => {
  it('never gives Tier 0 a daily spend limit, because the gate gives it none', () => {
    const label = tierWalletLimitLabel(0);
    assert.doesNotMatch(label, DAILY_SPEND_PROMISE, `"${label}" promises a Tier-0 daily limit that Tier 0 does not have`);
    assert.match(label, /cannot send|locked/i, `"${label}" must say sends are unavailable`);
  });

  it('names Tier 1 as the way out of Tier 0', () => {
    assert.match(tierWalletLimitLabel(0), /Tier 1/);
  });

  it('keeps the ADR-001 daily figures for Tiers 1 to 3', () => {
    // Tier 3 is deliberately LEFT at ADR-001's ₦5,000,000/day even though both
    // servers treat Tier 3 as unlimited — that drift is a compliance question for
    // the gate, not a copy question, and "fixing" the label here would hide it.
    assert.match(tierWalletLimitLabel(1), /50,000/);
    assert.match(tierWalletLimitLabel(2), /200,000/);
    assert.match(tierWalletLimitLabel(3), /5,000,000/);
  });
});

describe('tier0ClaimPanelCopy', () => {
  it('does not call the no-document claim a wallet activation', () => {
    const { title, sub } = tier0ClaimPanelCopy();
    assert.doesNotMatch(`${title} ${sub}`, /activat/i, `"${title} — ${sub}" implies claiming Tier 0 switches the wallet on`);
  });

  it('states plainly that the wallet still cannot move money', () => {
    const { sub } = tier0ClaimPanelCopy();
    assert.match(sub, /cannot send|cannot withdraw/i);
    assert.match(sub, /Tier 1/);
  });

  it('invents no Tier-0 naira figure', () => {
    const { title, sub } = tier0ClaimPanelCopy();
    assert.doesNotMatch(`${title} ${sub}`, /₦/, `"${title} — ${sub}" quotes a Tier-0 amount; Tier 0 has none`);
  });

  it('labels the button for what the claim does, not for the wallet', () => {
    // The screen's own button read "Activate Tier 0" — the last word the customer
    // touched before retrying the same ₦1,000 into the same refusal. The module owns
    // the label so the screen cannot invent one again.
    const { cta } = tier0ClaimPanelCopy();
    assert.equal(typeof cta, 'string', 'panel must supply its own button label');
    assert.doesNotMatch(cta, /activat/i);
    assert.match(cta, /confirm|submit|verify/i);
  });
});

describe('walletTierNotice', () => {
  it('tells a verified-but-Tier-0 customer their sends are still locked', () => {
    // The exact state the bug report is about: claimTier0 sets kyc_status
    // 'verified' while kyc_tier stays 0, so the card must not read as "done".
    const notice = walletTierNotice({ tier: 0, status: 'verified' });
    assert.match(notice, /cannot send|locked/i);
    assert.match(notice, /Tier 1/);
  });

  it('does not describe Tier 0 as a wallet whose limits just need raising', () => {
    // "Unlock HIGHER wallet limits" reads as "you have limits you can use". Tier 0
    // has no spend at all, which is why the customer stopped looking for Tier 1.
    assert.doesNotMatch(
      walletTierNotice({ tier: 0, status: 'verified' }),
      /higher wallet limits/i,
      'a Tier-0 wallet is disabled, not merely capped',
    );
  });

  it('says the same for an account that never claimed Tier 0', () => {
    const notice = walletTierNotice({ tier: 0, status: 'unverified' });
    assert.match(notice, /cannot send|locked/i);
    assert.match(notice, /Tier 1/);
  });

  it('leaves an in-review submission on its own message', () => {
    assert.match(
      walletTierNotice({ tier: 0, status: 'pending', requestedTier: 2 }),
      /Tier 2 request is awaiting admin review/,
    );
  });

  it('reports a real tier as the active level', () => {
    assert.match(walletTierNotice({ tier: 2, status: 'verified' }), /Tier 2/);
    assert.doesNotMatch(walletTierNotice({ tier: 2, status: 'verified' }), /cannot send/i);
  });
});
