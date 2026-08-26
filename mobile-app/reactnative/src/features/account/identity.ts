// ── The applicant's own details, as the ACCOUNT already holds them ────────────
// One source of truth for every form that would otherwise ask a signed-in user
// to retype what they gave at sign-up. Mirrors the server's
// `features/registration/account-prefill` so web and mobile agree on what
// counts as "already known".

import { useAuthStore } from '@/store/authStore';
import { normalizeAccountName } from './name';

export { normalizeAccountName };

export interface AccountIdentity {
  /** '' when the account genuinely has no value — the form must then ask. */
  fullName: string;
  email: string;
  phone: string;
  /** True when at least one detail is known, i.e. worth rendering a summary. */
  hasAny: boolean;
}

/** The signed-in user's details. All fields are '' when signed out. */
export function useAccountIdentity(): AccountIdentity {
  const user = useAuthStore((s) => s.user);
  const email = (user?.email || '').trim();
  const fullName = normalizeAccountName(user?.fullName, email);
  const phone = (user?.phone || '').trim();

  return { fullName, email, phone, hasAny: Boolean(fullName || email || phone) };
}
