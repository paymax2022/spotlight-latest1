// Single source for the mock toggle. Defaults to MOCK so the app runs in the
// configured environment to hit Supabase / the AI route.

import { mockAllowed } from '@/config/mockPolicy';
export const REALTOR_USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_REALTOR_USE_MOCK, true);
