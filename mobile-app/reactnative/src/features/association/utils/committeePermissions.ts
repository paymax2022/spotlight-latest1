// Who may do what with a committee, on the client.
//
// This mirrors the server's split (association requireCommitteeAdmin vs
// requireOrgAdmin) so the UI shows the actions a caller will actually be
// allowed to perform. It is NOT the authorisation — hiding a button is not a
// permission check; the server refuses these calls on the same capability
// regardless of what the client renders.

export interface CommitteeAccess {
  isAdmin?: boolean;
  organisationId?: string | null;
  can?: {
    manageMembers?: boolean;
    manageCommittees?: boolean;
  } | null;
}

/**
 * Create / rename / delete a committee — the organisation owner only.
 *
 * Requires organisationId as well as the capability: creating a committee POSTs
 * to /admin/organisations/:id/committees, and with no org id there is nothing
 * to post to. An older backend that does not report manageCommittees yields
 * false rather than an accidental true.
 */
export function canManageCommittees(access?: CommitteeAccess | null): boolean {
  if (!access) return false;
  return Boolean(access.can?.manageCommittees) && Boolean(access.organisationId);
}

/**
 * Run a committee's roster — add, approve, decline, remove, set role.
 * Deliberately wider: chapter admins do this day-to-day work without being
 * able to create or destroy a committee.
 */
export function canManageCommitteeRoster(access?: CommitteeAccess | null): boolean {
  if (!access) return false;
  return Boolean(access.isAdmin);
}
