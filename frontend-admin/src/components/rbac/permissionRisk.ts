/**
 * Client-side risk heuristics for the permission matrix.
 *
 * NOTE: these are UX guardrails only — the backend remains the source of truth
 * and re-validates every assignment (deny-by-default). We surface a warning so
 * an operator confirms an intentional, high-blast-radius change before it is
 * sent; we never silently allow or block on the client.
 */

const CRITICAL_SLUG_PATTERNS: RegExp[] = [
  /(^|[._:-])(super[._-]?admin)([._:-]|$)/i,
  /(^|[._:-])permissions?([._:-]|$)/i,
  /(^|[._:-])roles?([._:-]|$)/i,
  /(^|[._:-])rbac([._:-]|$)/i,
  /([._:-])(delete|destroy|purge)([._:-]|$)/i,
  /([._:-])(impersonate|sudo)([._:-]|$)/i,
  /(^|[._:-])(billing|payouts?|ledger|wallet|funds?)([._:-])(write|update|delete|approve|transfer)/i,
];

export function isCriticalPermissionSlug(slug: string): boolean {
  if (!slug) return false;
  return CRITICAL_SLUG_PATTERNS.some((re) => re.test(slug));
}

/** Roles that should not normally receive critical permissions via the matrix UI. */
function isPrivilegedRole(roleSlug: string | undefined, roleName: string | undefined): boolean {
  const s = `${roleSlug ?? ''} ${roleName ?? ''}`.toLowerCase();
  return /super[\s._-]?admin|system[\s._-]?admin|root/.test(s);
}

export type AssignmentWarning = {
  level: 'critical' | 'warning';
  reason: string;
};

/**
 * Evaluate a single (role, permission) assignment toggle that is about to be
 * ENABLED. Returns a warning if the operator should confirm first, else null.
 *
 * - Granting a critical permission to a non-privileged role => 'critical' warn.
 * - Granting any permission to a role flagged below (e.g. a disabled/system
 *   role) can also surface a softer 'warning'.
 */
export function evaluateAssignment(input: {
  permissionSlug: string;
  roleSlug?: string;
  roleName?: string;
}): AssignmentWarning | null {
  const critical = isCriticalPermissionSlug(input.permissionSlug);
  if (!critical) return null;
  if (isPrivilegedRole(input.roleSlug, input.roleName)) {
    // Expected: super-admins already hold these; still note it for the audit-minded operator.
    return {
      level: 'warning',
      reason: `"${input.permissionSlug}" is a critical permission. It is being granted to a privileged role.`,
    };
  }
  return {
    level: 'critical',
    reason: `"${input.permissionSlug}" is a critical/high-blast-radius permission. Granting it to "${input.roleName ?? input.roleSlug ?? 'this role'}" can let that role manage roles, permissions, or destructive actions.`,
  };
}

/**
 * Detect conflicting selections within a single bulk operation: e.g. a row that
 * would hold both a broad "*.manage"/"admin" grant and narrower deny-style
 * scoped permissions, which is usually a mistake. Returns reasons (possibly
 * empty).
 */
export function detectBulkConflicts(slugs: string[]): string[] {
  const reasons: string[] = [];
  const hasWildcardAdmin = slugs.some((s) => /(^|[._:-])(admin|manage|all|\*)([._:-]|$)/i.test(s));
  const criticalCount = slugs.filter(isCriticalPermissionSlug).length;
  if (hasWildcardAdmin && criticalCount > 0) {
    reasons.push('This bulk action mixes broad admin/manage grants with critical permissions — confirm this is intended.');
  }
  if (criticalCount >= 3) {
    reasons.push(`This bulk action grants ${criticalCount} critical permissions at once.`);
  }
  return reasons;
}
