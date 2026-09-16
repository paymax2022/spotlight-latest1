// ── Crowdfunding — which campaign a withdrawal is actually against ───────────
//
// The withdrawal screen is reachable two ways: from the wallet (no campaign in
// the route) and from the owner management screen for ONE campaign. It used to
// resolve the target as `wallet.data?.campaignId ?? 'my1'`, which had two
// defects worth a named function and a test, because nothing else in the repo
// guards this:
//
//  1. It ignored the campaign the screen was OPENED for. An owner who tapped
//     "Withdraw funds" on campaign B was shown campaign A's available balance
//     and would have filed the withdrawal against campaign A — a money movement
//     from the wrong pot, with a plausible-looking amount on screen.
//  2. `'my1'` is a MOCK campaign id sitting in production code. With the wallet
//     lookup unresolved on a live build, the request went out naming a campaign
//     that belongs to the mock dataset.
//
// So: the route wins when present, the wallet is the fallback, and when neither
// resolves the answer is null — the caller must block submission rather than
// invent a target.

/**
 * Resolve the campaign a withdrawal request belongs to.
 *
 * @param routeCampaignId  campaign the screen was opened for, if any
 * @param walletCampaignId campaign of the wallet the screen loaded
 * @returns the campaign id, or `null` when there is no defensible target
 */
export function resolveWithdrawalCampaignId(
  routeCampaignId: string | null | undefined,
  walletCampaignId: string | null | undefined,
): string | null {
  const fromRoute = routeCampaignId?.trim();
  if (fromRoute) return fromRoute;

  const fromWallet = walletCampaignId?.trim();
  if (fromWallet) return fromWallet;

  return null;
}
