// Back navigation that survives a cold entry.
//
// `router.back()` is a NO-OP when there is nothing on the stack, and Expo Router
// logs "The action 'GO_BACK' was not handled by any navigator". On native that is
// rare — you almost always arrived by pushing. On WEB it is routine: every deep
// link, every refresh, every URL pasted into the address bar opens a screen with
// an empty history, so the back button silently does nothing.
//
// Reported against /voting/buy-votes?contestantId=…&contestId=… loaded directly.
//
// The idiom already existed, hand-rolled, in referral/onboarding/role-switcher
// and fx/states/[kind]. This makes it shared so a screen cannot forget it.

import { router } from 'expo-router';

/**
 * Go back if there is anywhere to go back to; otherwise REPLACE with `fallback`.
 *
 * replace, not push: the fallback is standing in for a history entry that never
 * existed, so it must not add one — otherwise backing out of the fallback lands
 * on the very screen the user was trying to leave.
 *
 * @param fallback route to land on when the history is empty (the screen's
 *                 logical parent, not necessarily the app root)
 */
export function goBack(fallback: string): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
