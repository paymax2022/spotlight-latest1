// ── Pure name handling for account prefill ───────────────────────────────────
// Kept free of React Native imports so it can be unit-tested under plain node
// (the hook in ./identity pulls in the auth store, and with it Supabase).

/**
 * Sign-up stores the email as the display name when no name was given, and
 * `getMe` falls back to the email too. Neither is a name: returning it would
 * pre-fill "you@example.com" into a Full name field and — on the forms that
 * render account details read-only — leave no way to correct it.
 */
export function normalizeAccountName(name?: string | null, email?: string | null): string {
  const value = (name || '').trim();
  if (!value) return '';
  return value.toLowerCase() === (email || '').trim().toLowerCase() ? '' : value;
}
