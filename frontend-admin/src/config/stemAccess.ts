const MANAGE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'OPERATIONS_MANAGER', 'CONTEST_MANAGER']);
const READ_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATIONS_MANAGER',
  'CONTEST_MANAGER',
  'SCHOOL_ADMIN',
  'TEACHER_COACH',
  'JUDGE',
  'MENTOR',
  'SPONSOR',
]);

// AUTH-020 follow-up (still open): the backend now resolves the caller's REAL
// STEM role via a verified RBAC lookup (RequireStemRoles in
// backend/internal/middleware/stem_authz.go, backed by
// 20270205000000_stem_admin_rbac_roles.sql) — the x-stem-role header this
// module used to send is no longer trusted server-side for authorization. But
// getCurrentStemRole() below still derives its value from a static build-time
// env var, not the signed-in user's real roles — it only controls which nav
// items/buttons render, so a stale value here is a UX papercut (a rendered
// button 403s), not a security gap. There is no "my roles" endpoint to call
// yet, so this hasn't been wired up: doing so needs a new backend endpoint
// (GET .../admin/stem/my-role, or similar, resolving c.Get("adminUserID") via
// rbac.GetUserRoles) plus a real async fetch here in place of the sync env
// read, which several call sites (AdminDashboard.tsx, AdminSidebar.tsx)
// currently assume is synchronous.
export function getCurrentStemRole(): string {
  return (process.env.NEXT_PUBLIC_STEM_ROLE || 'ADMIN').toUpperCase();
}

export function canReadStem(role = getCurrentStemRole()): boolean {
  return READ_ROLES.has(role);
}

export function canManageStem(role = getCurrentStemRole()): boolean {
  return MANAGE_ROLES.has(role);
}

