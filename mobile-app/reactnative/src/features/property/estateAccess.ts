// Estate & visitor features are estate-scoped: every BFF route under
// /api/v1/estate and /api/v1/visitor resolves the caller's estate_residents row
// and refuses without one. Membership is therefore the client-side signal for
// "may this account use estate services".
//
// It is not inferred from the property context envelope: that is a switchable
// UI hint (and is mocked in local development), while a banned or soft-deleted
// resident keeps their contexts but loses every estate route.
import type { EstateMembership } from './types';

/** Fails closed: loading, error or any non-affirmative answer → no access. */
export function hasEstateAccess(membership: EstateMembership | null | undefined): boolean {
  return membership?.isResident === true;
}
