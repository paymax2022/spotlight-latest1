import { router } from 'expo-router';
import { currentPathForReturn } from '@/lib/authError';

/**
 * Send the user to sign in, and bring them back afterwards.
 *
 * Split from authError.ts on purpose: that module is pure so node --test can
 * import it, and importing expo-router there pulls in JSX the test runner cannot
 * parse. The classification is the part worth testing; this is the part that
 * navigates.
 *
 * `replace`, not push: the screen being left cannot be reached without a session,
 * so it must not sit in the history behind the login form.
 */

/**
 * COLLAPSE CONCURRENT 401s INTO ONE NAVIGATION.
 *
 * A screen typically fires several queries at once, and an expired session fails
 * all of them within milliseconds. Without this guard each failure would call
 * router.replace, and app/_layout.tsx already carries a comment about a
 * router.replace storm producing "Maximum update depth exceeded" — so this is a
 * crash this app has met before, not a theoretical one.
 *
 * Time-based rather than a flag cleared on arrival: navigation is async and can
 * be interrupted, and a flag that never clears would silently disable the prompt
 * for the rest of the session — failing in the direction of a user stuck on a
 * dead screen with no way to sign in.
 */
const PROMPT_COOLDOWN_MS = 3_000;
let lastPromptAt = Number.NEGATIVE_INFINITY; // never throttle the FIRST prompt

/** Exported for tests; resets the cooldown so cases cannot leak into each other. */
export function resetSignInPromptThrottle(): void {
  lastPromptAt = Number.NEGATIVE_INFINITY;
}

export function promptSignIn(returnTo?: string): void {
  const now = Date.now();
  if (now - lastPromptAt < PROMPT_COOLDOWN_MS) return;
  lastPromptAt = now;

  const dest = returnTo ?? currentPathForReturn();
  router.replace(
    dest
      ? { pathname: '/(auth)/login', params: { returnTo: dest } }
      : ('/(auth)/login' as never),
  );
}
