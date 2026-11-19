/**
 * Which organisation the in-app admin console is acting on, and how that scope
 * goes on the wire.
 *
 * The backend resolves an admin read the same way every time: take `org_id` from
 * the request, and when it is absent fall back to the caller's own
 * `assoc_member_roles ⋈ assoc_memberships` row (service.go `resolveOrgID`). That
 * fallback is the whole reason a per-org officer never had to say: their
 * membership names the org. It cannot work for a platform super-admin, who is
 * authorized by `isPlatformSuperAdmin` and holds no membership at all — the
 * lookup returns `pgx.ErrNoRows`, the package error map writes it as a 404, and
 * the screens rendered that as a bare "Couldn't load / Please try again."
 *
 * `GET /me/admin-access` already says so: for a super-admin it answers
 * `isAdmin:true` with `organisationId:null`, and its own comment records that
 * "the console picks the org explicitly". The web console does (associationAdminService
 * `useSelectedOrg`); the mobile console never did. These two functions are that
 * missing decision, kept free of `@/api/client` so it can be tested under
 * `node --test` — the same split as doctor/mapping.ts.
 */

/** The scope travels as `org_id`: the Go handlers read `c.Query("org_id")` and
 *  `MemberDirectoryQuery` binds `form:"org_id"`. A camelCase key is dropped in
 *  silence and the request re-reads as unscoped. */
export type OrgScopedParams = Record<string, string | undefined>;

/**
 * Add the org scope to a request's query params.
 *
 * Blank is treated as absent on purpose: `requireCapInOrg` answers an empty
 * `org_id` with `ErrForbidden`, so forwarding one would turn "no scope chosen
 * yet" into a 403 the screen then has to explain.
 */
export function withOrgScope<T extends object>(params: T, orgId?: string | null): T & { org_id?: string } {
  const scope = typeof orgId === 'string' ? orgId.trim() : '';
  if (!scope) return params;
  return { ...params, org_id: scope };
}

export type AdminOrgScopeInput = {
  /** `GET /me/admin-access → organisationId` — set for a real per-org officer. */
  ownOrgId?: string | null;
  /** The admin's remembered pick from the console's picker, if any. */
  selection?: string | null;
  /** `GET /admin/organisations`, or null while that list is still loading. */
  orgs: readonly { id: string }[] | null;
};

export type AdminOrgScope = {
  /** The org to send as `org_id`, or null when nothing is resolvable yet. */
  orgId: string | null;
  /** Ask the admin to choose: there are several orgs and no valid pick. */
  needsPick: boolean;
  /** The list that would answer the question is still in flight. */
  isResolving: boolean;
};

/**
 * Resolve the console's organisation scope.
 *
 * An officer's own org always wins over a stored pick: somebody who used the
 * console as a super-admin, chose another organisation, and now reads as an
 * org-bound officer would otherwise be sent at an org `requireCapInOrg` refuses.
 */
export function resolveAdminOrgScope({ ownOrgId, selection, orgs }: AdminOrgScopeInput): AdminOrgScope {
  const own = typeof ownOrgId === 'string' ? ownOrgId.trim() : '';
  if (own) return { orgId: own, needsPick: false, isResolving: false };

  if (!orgs) return { orgId: null, needsPick: false, isResolving: true };
  // No organisations at all is a real answer, not a race: there is nothing to
  // pick, so the console says the roll is empty instead of asking forever.
  if (orgs.length === 0) return { orgId: null, needsPick: false, isResolving: false };
  if (orgs.length === 1) return { orgId: orgs[0].id, needsPick: false, isResolving: false };

  const picked = typeof selection === 'string' ? selection.trim() : '';
  if (picked && orgs.some((o) => o.id === picked)) {
    return { orgId: picked, needsPick: false, isResolving: false };
  }
  return { orgId: null, needsPick: true, isResolving: false };
}
