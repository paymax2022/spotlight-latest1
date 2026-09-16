// Guards which campaign a withdrawal is filed against.
//
// The withdrawal screen resolved its target as
// `wallet.data?.campaignId ?? 'my1'`, ignoring the campaign it had been opened
// for. An owner who tapped "Withdraw funds" on campaign B was therefore shown
// campaign A's available balance and would have moved money out of campaign A's
// pot — with a believable amount on screen the whole time. The `'my1'` tail is a
// MOCK campaign id, so on a live build with the wallet unresolved the request
// went out naming a campaign from the mock dataset.
//
// Nothing else in the repo covers this, and the failure is silent by nature:
// the request succeeds, against the wrong campaign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// `@/` + extensionless, resolved by tests/unit/ts-path-hooks.mjs.
import { resolveWithdrawalCampaignId } from '@/features/crowdfunding/utils/withdrawalTarget';

test('the campaign the screen was opened for wins over the loaded wallet', () => {
  // The regression: arriving from campaign B must not file against campaign A.
  assert.equal(resolveWithdrawalCampaignId('campaign-b', 'campaign-a'), 'campaign-b');
});

test('the wallet is the fallback when the screen was opened bare', () => {
  // Reached from the wallet rather than from a campaign — the previous
  // behaviour, which stays correct in that entry path.
  assert.equal(resolveWithdrawalCampaignId(undefined, 'campaign-a'), 'campaign-a');
  assert.equal(resolveWithdrawalCampaignId(null, 'campaign-a'), 'campaign-a');
});

test('no resolvable campaign yields null rather than a guess', () => {
  // The caller blocks submission on null. Anything else here would be inventing
  // a destination for real money.
  assert.equal(resolveWithdrawalCampaignId(undefined, undefined), null);
  assert.equal(resolveWithdrawalCampaignId(null, null), null);
});

test('blank and whitespace-only ids do not count as a target', () => {
  // An empty route param (`?campaign=`) reaches the screen as '' — it must fall
  // through to the wallet, not be treated as a campaign id of its own.
  assert.equal(resolveWithdrawalCampaignId('', 'campaign-a'), 'campaign-a');
  assert.equal(resolveWithdrawalCampaignId('   ', 'campaign-a'), 'campaign-a');
  assert.equal(resolveWithdrawalCampaignId('', ''), null);
  assert.equal(resolveWithdrawalCampaignId('  ', '  '), null);
});

test('ids are returned trimmed, never padded', () => {
  assert.equal(resolveWithdrawalCampaignId(' campaign-b ', undefined), 'campaign-b');
  assert.equal(resolveWithdrawalCampaignId(undefined, ' campaign-a '), 'campaign-a');
});
