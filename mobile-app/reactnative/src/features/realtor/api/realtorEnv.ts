// ── Spotlight Realtor — runtime flags ────────────────────────────────────────
// Single source for the mock toggle. Defaults to MOCK so the app runs in the
// dev sandbox with no backend; set EXPO_PUBLIC_REALTOR_USE_MOCK=false in a
// configured environment to hit Supabase / the AI route.

import { mockAllowed } from '@/config/mockPolicy';
export const REALTOR_USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_REALTOR_USE_MOCK, true);
