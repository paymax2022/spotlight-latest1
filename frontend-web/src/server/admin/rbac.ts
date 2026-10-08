export type AdminRole =
  | 'super_admin'
  | 'program_manager'
  | 'contest_manager'
  | 'voting_manager'
  | 'finance_admin'
  | 'finance_maker'    // Block 9: can initiate wallet adjustments
  | 'finance_checker'  // Block 9: can approve/reject adjustments (no self-approval)
  | 'finance_viewer'   // Block 9: read-only view of adjustments
  | 'content_manager'
  | 'media_manager'
  | 'sponsor_manager'
  | 'judge'
  | 'reviewer'
  | 'event_manager'
  | 'support_agent'
  | 'auditor'
  | 'executive_readonly'
  // WAL-010: sentinel for unrecognized/missing role input. NOT an assignable
  // admin role — never offer it in a role picker, never provision a user
  // with it directly. It exists only so parseAdminRole() has a genuinely
  // permission-less value to fall back to (see rolePermissions below and the
  // comment on parseAdminRole). Do NOT add any permission to it.
  | 'no_access';

export type AdminPermission =
  | 'dashboard:view'
  | 'programs:manage'
  | 'contests:manage'
  | 'applications:review'
  | 'scores:manage'
  | 'votes:manage'
  | 'votes:sensitive:initiate'   // UAT Batch 8: propose a dual-control Contest action (reverse/adjust/publish)
  | 'votes:sensitive:approve'    // UAT Batch 8: approve/reject another user's proposed Contest action
  | 'finance:view'
  | 'finance:refund'
  | 'finance:adjust:initiate'   // Block 9: propose a manual credit/debit
  | 'finance:adjust:approve'    // Block 9: approve/reject another user's adjustment
  | 'utility:manage'
  | 'utility:support'
  | 'content:manage'
  | 'reports:export'
  | 'users:manage'
  | 'roles:manage'
  | 'audit:view';

const rolePermissions: Record<AdminRole, AdminPermission[]> = {
  super_admin: [
    'dashboard:view','programs:manage','contests:manage','applications:review','scores:manage','votes:manage',
    // UAT Batch 8 (SEC-005/G-MC): super_admin is the checker for Contest dual-control
    // actions — deliberately NOT granted to contest_manager/voting_manager. Unlike
    // finance_admin (which intentionally holds both initiate+approve as a documented
    // ADR-005 compromise for senior finance leads), this split is NOT a compromise:
    // propose and approve are genuinely different roles for Contest actions, and the
    // natural top-authority second approver is super_admin alone.
    'votes:sensitive:approve',
    'finance:view','finance:refund','content:manage','reports:export','users:manage','roles:manage','audit:view',
    'utility:manage','utility:support',
  ],
  program_manager: ['dashboard:view', 'programs:manage', 'applications:review', 'reports:export'],
  contest_manager: [
    'dashboard:view', 'contests:manage', 'applications:review', 'scores:manage', 'votes:manage',
    // UAT Batch 8: contest_manager is a maker (proposer) only — see super_admin comment above.
    'votes:sensitive:initiate',
    'reports:export',
  ],
  voting_manager: [
    'dashboard:view', 'scores:manage', 'votes:manage',
    // UAT Batch 8: voting_manager is a maker (proposer) only — see super_admin comment above.
    'votes:sensitive:initiate',
    'reports:export',
  ],
  finance_admin: [
    'dashboard:view', 'finance:view', 'finance:refund',
    'finance:adjust:initiate', 'finance:adjust:approve',
    'utility:manage', 'utility:support', 'reports:export', 'audit:view',
  ],
  finance_maker:  ['dashboard:view', 'finance:view', 'finance:adjust:initiate', 'audit:view'],
  finance_checker: ['dashboard:view', 'finance:view', 'finance:adjust:approve', 'audit:view'],
  finance_viewer:  ['dashboard:view', 'finance:view', 'audit:view'],
  content_manager: ['dashboard:view', 'content:manage'],
  media_manager: ['dashboard:view', 'content:manage'],
  sponsor_manager: ['dashboard:view', 'programs:manage', 'reports:export'],
  judge: ['dashboard:view', 'scores:manage'],
  reviewer: ['dashboard:view', 'applications:review', 'scores:manage'],
  event_manager: ['dashboard:view', 'programs:manage'],
  support_agent: ['dashboard:view', 'applications:review', 'utility:support'],
  auditor: ['dashboard:view', 'audit:view', 'utility:support', 'reports:export'],
  executive_readonly: ['dashboard:view', 'finance:view', 'audit:view', 'utility:support'],
  // WAL-010: deliberately empty. See the AdminRole comment above — this is
  // the fail-closed fallback for input that isn't a real admin role (plain
  // customer 'user', null/empty, typos, garbage). Never add a permission
  // permission.
  no_access: [],
};

// WAL-010 (P0): previously fell back to 'executive_readonly' for ANY
// unrecognized input — including the ordinary customer role 'user', empty
// string, and null — and executive_readonly carries real permissions
// (finance:view, audit:view, dashboard:view, utility:support). That silently
// granted those permissions to every authenticated non-admin caller. The
// fallback must resolve to a role with ZERO permissions ('no_access'), never
// to any role that has one. executive_readonly remains a real, assignable
// admin role for legitimately-provisioned executive/readonly staff — it is
// only ever reached here via an exact, explicit match below.
export function parseAdminRole(input: string | null | undefined): AdminRole {
  if (!input) return 'no_access';
  const normalized = input.trim().toLowerCase();
  const aliasMap: Record<string, AdminRole> = {
    admin: 'super_admin',
    operations_manager: 'program_manager',
  };
  const mapped = (aliasMap[normalized] || normalized) as AdminRole;
  // 'no_access' is a sentinel, not a role anyone should be able to claim by
  // literally passing the string "no_access" — treat that input the same as
  // any other unrecognized value (it already resolves here since it's not a
  // real assignable role's alias, but this guard keeps that true even if the
  // rolePermissions map or aliasMap changes shape later).
  if (mapped === 'no_access') return 'no_access';
  return mapped in rolePermissions ? mapped : 'no_access';
}

export function hasPermission(role: AdminRole, permission: AdminPermission) {
  return rolePermissions[role]?.includes(permission) ?? false;
}

// E2E-SEC-053: the AUTHORITATIVE role store is public.user_roles →
// public.roles.slug — the same source the Go backend's RBACService reads
// (rbac.GetUserRoles → user_roles?select=roles!inner(slug)&is_active=eq.true,
// backend/internal/repositories/rbac_supabase_repository.go). Slugs there are
// kebab-case ('super-admin', 'contest-manager', …); this map translates them
// into this app's snake_case AdminRole names.
//
// 'system-admin' maps to super_admin deliberately: the Go admin-console gate
// (RequireAdminConsoleRole, consoleAdminRoleSlugs) admits system-admin to
// every admin route exactly like super-admin, and this app's AdminRole model
// has no narrower platform-admin role to express it as.
//
// Slugs with no BFF admin-console meaning (registered-user, verified-user,
// contestant, state-coordinator, estate-admin, sponsor-representative, …) are
// intentionally ABSENT — they resolve to no role at all (fail closed).
const rbacSlugToAdminRole: Record<string, AdminRole> = {
  'super-admin': 'super_admin',
  'system-admin': 'super_admin',
  admin: 'super_admin',
  'operations-manager': 'program_manager',
  'program-manager': 'program_manager',
  'contest-manager': 'contest_manager',
  'voting-manager': 'voting_manager',
  'finance-admin': 'finance_admin',
  'finance-maker': 'finance_maker',
  'finance-checker': 'finance_checker',
  'finance-viewer': 'finance_viewer',
  'content-manager': 'content_manager',
  'media-manager': 'media_manager',
  'sponsor-manager': 'sponsor_manager',
  judge: 'judge',
  reviewer: 'reviewer',
  'event-manager': 'event_manager',
  'support-agent': 'support_agent',
  auditor: 'auditor',
  'executive-readonly': 'executive_readonly',
};

// Precedence for REPORTING the effective role when a user holds several:
// broadest first. Permission checks are union semantics (see
// resolveAdminRoleFromRbacSlugs) — this order only decides which granting
// role is reported for audit/display, never whether access is allowed.
const ADMIN_ROLE_PRECEDENCE: AdminRole[] = [
  'super_admin',
  'finance_admin',
  'contest_manager',
  'voting_manager',
  'program_manager',
  'sponsor_manager',
  'event_manager',
  'content_manager',
  'media_manager',
  'finance_maker',
  'finance_checker',
  'finance_viewer',
  'executive_readonly',
  'auditor',
  'judge',
  'reviewer',
  'support_agent',
];

// adminRoleFromRbacSlug maps ONE public.roles.slug to an AdminRole, or null
// when the slug is not an admin-console role here.
export function adminRoleFromRbacSlug(slug: string | null | undefined): AdminRole | null {
  if (!slug) return null;
  const normalized = slug.trim().toLowerCase().replace(/_/g, '-');
  return rbacSlugToAdminRole[normalized] ?? null;
}

// resolveAdminRoleFromRbacSlugs answers the question assertAdminPermission
// asks: "does any of this user's REAL RBAC role slugs grant `permission`, and
// if so which AdminRole do we report?" Union semantics — a user holding both
// 'judge' and 'finance-viewer' still gets scores:manage through judge even
// though a single-role read would have picked only one. Returns 'no_access'
// when no held role grants the permission (fail closed).
export function resolveAdminRoleFromRbacSlugs(
  slugs: Array<string | null | undefined>,
  permission: AdminPermission,
): AdminRole {
  const held = new Set<AdminRole>();
  for (const slug of slugs) {
    const mapped = adminRoleFromRbacSlug(slug);
    if (mapped) held.add(mapped);
  }
  for (const role of ADMIN_ROLE_PRECEDENCE) {
    if (held.has(role) && hasPermission(role, permission)) return role;
  }
  return 'no_access';
}

// roleIsSubset reports whether every permission `role` holds is also held by
// the shared API key) down to a weaker role without ever elevating past it.
// NOTE: finance_admin is NOT a subset of super_admin (the finance:adjust:*
// perms exist only on the finance_* ladder) — subset is about permission
// sets, not a role hierarchy.
export function roleIsSubset(role: AdminRole, ceiling: AdminRole): boolean {
  const allowed = new Set(rolePermissions[ceiling]);
  return rolePermissions[role].every((p) => allowed.has(p));
}
