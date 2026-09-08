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
export function promptSignIn(returnTo?: string): void {
  const dest = returnTo ?? currentPathForReturn();
  router.replace(
    dest
      ? { pathname: '/(auth)/login', params: { returnTo: dest } }
      : ('/(auth)/login' as never),
  );
}
