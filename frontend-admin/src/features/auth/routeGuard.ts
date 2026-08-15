import type { AuthUser } from '@/features/auth/rbac';
import { hasAnyPermission, hasPermission } from '@/features/auth/rbac';

// Baseline permission every authenticated admin operator must hold to reach any
// /admin/* route that isn't explicitly mapped below. Top-level admin roles are
// granted '*' at sign-in (see features/auth/adminAuth), which satisfies this and
// every entry below — so this change never locks out a current admin. It closes
// the previous default-ALLOW hole (any unmapped route was reachable by anyone)
// and is the foundation for genuinely scoped operator roles.
//
// NOTE: this guard is a client-side UX gate only. It is NOT a security boundary —
// the Go backend MUST independently enforce RBAC on every admin endpoint. See the
// admin gap analysis (Phase 0) for the server-side hardening that must accompany it.
const BASELINE_ADMIN_PERMISSION = 'admin.access';

// Routes any authenticated admin may open without a specific permission (landing
// + terminal states). Matched by exact path, not prefix.
const PUBLIC_ADMIN_ROUTES = new Set<string>(['/admin', '/admin/unauthorized']);

// Ordered MOST-SPECIFIC FIRST — isRouteAllowed returns on the first prefix match,
// so a cluster's sensitive sub-routes must precede its catch-all.
const routePermissions: Array<{ prefix: string; permissions: string[] }> = [
  // ── Access, audit & identity ───────────────────────────────────────────────
  { prefix: '/admin/audit-logs', permissions: ['audit.logs.view'] },
  { prefix: '/admin/security-events', permissions: ['audit.logs.view'] },
  { prefix: '/admin/login-activity', permissions: ['audit.logs.view'] },
  { prefix: '/admin/permissions-matrix', permissions: ['permissions.view'] },
  { prefix: '/admin/permissions', permissions: ['permissions.view'] },
  { prefix: '/admin/roles', permissions: ['roles.view'] },
  { prefix: '/admin/rbac-settings', permissions: ['roles.view'] },
  { prefix: '/admin/users', permissions: ['users.view'] },

  // ── Core money path (finance) ──────────────────────────────────────────────
  { prefix: '/admin/finance/transfers', permissions: ['finance.admin.transfers'] },
  { prefix: '/admin/finance/kyc-verify', permissions: ['finance.admin.kyc'] },
  { prefix: '/admin/finance/kyc', permissions: ['finance.admin.kyc'] },
  { prefix: '/admin/finance/disputes', permissions: ['finance.admin.disputes'] },
  { prefix: '/admin/finance/wallets', permissions: ['finance.admin.wallets'] },
  { prefix: '/admin/finance', permissions: ['finance.admin.view'] },

  // ── FX / treasury (KYB PII, force-reversals, SAR filing) ───────────────────
  { prefix: '/admin/fx/compliance', permissions: ['compliance.admin.review'] },
  { prefix: '/admin/fx/customers', permissions: ['fx.admin.customers'] },
  { prefix: '/admin/fx/treasury', permissions: ['fx.admin.treasury'] },
  { prefix: '/admin/fx/reconciliation', permissions: ['fx.admin.recon'] },
  { prefix: '/admin/fx/transactions', permissions: ['fx.admin.transactions'] },
  { prefix: '/admin/fx', permissions: ['fx.admin.view'] },

  // ── Other money / ledger surfaces ──────────────────────────────────────────
  { prefix: '/admin/crypto', permissions: ['crypto.admin.view'] },
  { prefix: '/admin/savings', permissions: ['savings.admin.view'] },
  { prefix: '/admin/invest', permissions: ['invest.admin.view'] },
  { prefix: '/admin/fractionalre', permissions: ['fractionalre.admin.view'] },
  { prefix: '/admin/crowdfunding', permissions: ['crowdfunding.admin.view'] },
  { prefix: '/admin/spray', permissions: ['spray.admin.view'] },
  { prefix: '/admin/points', permissions: ['points.admin.view'] },
  { prefix: '/admin/commission', permissions: ['commission.admin.manage'] },
  { prefix: '/admin/loyalty-black', permissions: ['loyalty.admin.manage'] },
  { prefix: '/admin/loyalty', permissions: ['loyalty.admin.manage'] },
  { prefix: '/admin/social-escrow', permissions: ['escrow.admin.view'] },
  { prefix: '/admin/p2pmarket', permissions: ['p2p.admin.view'] },
  { prefix: '/admin/spotlight', permissions: ['finance.admin.view'] },

  // ── Compliance / risk / moderation (regulatory + PII) ──────────────────────
  { prefix: '/admin/connect/aml', permissions: ['compliance.admin.review'] },
  { prefix: '/admin/connect/underage', permissions: ['compliance.admin.review'] },
  { prefix: '/admin/connect/media-review', permissions: ['moderation.admin.review'] },
  { prefix: '/admin/connect/moderation', permissions: ['moderation.admin.review'] },
  { prefix: '/admin/connect/cases', permissions: ['compliance.admin.review'] },
  { prefix: '/admin/connect/payouts', permissions: ['connect.admin.payouts'] },
  { prefix: '/admin/connect/finance', permissions: ['connect.admin.finance'] },
  { prefix: '/admin/connect/rbac', permissions: ['roles.view'] },
  { prefix: '/admin/connect/identity', permissions: ['compliance.admin.review'] },
  { prefix: '/admin/connect/users', permissions: ['users.view'] },
  { prefix: '/admin/connect', permissions: ['connect.admin.view'] },
  { prefix: '/admin/referral/risk', permissions: ['compliance.admin.review'] },
  { prefix: '/admin/referral/compliance', permissions: ['compliance.admin.review'] },
  { prefix: '/admin/referral/finance', permissions: ['referral.admin.finance'] },
  { prefix: '/admin/referral/users', permissions: ['users.view'] },
  { prefix: '/admin/referral/ambassadors', permissions: ['referral.admin.manage'] },
  { prefix: '/admin/referral-rewards', permissions: ['referral.admin.finance'] },
  { prefix: '/admin/referral', permissions: ['referral.admin.view'] },

  // ── Operational verticals ──────────────────────────────────────────────────
  { prefix: '/admin/merchant-onboarding', permissions: ['merchant.onboarding.view'] },
  { prefix: '/admin/featured-placement', permissions: ['placement.admin.review'] },
  { prefix: '/admin/nutrition', permissions: ['nutrition.admin.manage'] },
  { prefix: '/admin/restaurant/delivery-fee', permissions: ['restaurant.admin.pricing'] },
  // `restaurant.admin.view` was never seeded — it appears in neither
  // 20260919000200_restaurant_admin_rbac.sql nor 20260920000100_rbac_seed_gaps.sql,
  // so this prefix used to admit only wildcard super-admins and locked every
  // real restaurant operator out of the console. The seeded slugs are
  // restaurant.manage plus restaurant.admin.{pricing,dispatch,onboarding,payouts,disputes};
  // hasAnyPermission is an OR, so holding any one of them opens the section and
  // each sub-page still gates its own actions via RESTAURANT_PERMS in _ui.tsx.
  {
    prefix: '/admin/restaurant',
    permissions: [
      'restaurant.manage',
      'restaurant.admin.dispatch',
      'restaurant.admin.onboarding',
      'restaurant.admin.payouts',
      'restaurant.admin.disputes',
      'restaurant.admin.pricing',
    ],
  },
  { prefix: '/admin/marketplace', permissions: ['marketplace.admin.view'] },
  { prefix: '/admin/vendors', permissions: ['marketplace.admin.view'] },
  { prefix: '/admin/insurance', permissions: ['insurance.admin.view'] },
  { prefix: '/admin/estate', permissions: ['estate.admin.view'] },
  { prefix: '/admin/association', permissions: ['estate.admin.view'] },
  { prefix: '/admin/realtor', permissions: ['realtor.admin.view'] },
  { prefix: '/admin/telemedicine', permissions: ['health.admin.view'] },
  { prefix: '/admin/health', permissions: ['health.admin.view'] },
  { prefix: '/admin/intake', permissions: ['health.admin.intake'] },

  // Multi-modal mobility: mode pages require mobility.view to enter; sensitive
  // in-page actions are additionally gated by mode-specific mobility.*.manage
  // permissions (see _ui MOBILITY_PERMS).
  { prefix: '/admin/mobility', permissions: ['mobility.view'] },

  // ── Platform config (feature flags, edtech super-admin) ────────────────────
  { prefix: '/admin/platform', permissions: ['platform.admin.manage'] },
];

/**
 * Client-side route gate (UX only; the backend is the security boundary).
 *
 * Returns false for an unauthenticated user, true for an explicitly public admin
 * route, the mapped permission check for a matched sensitive prefix, and — for any
 * other /admin route — DEFAULT-DENY: the operator must hold the baseline admin
 * permission. Wildcard/super-admin operators satisfy every branch.
 */
export function isRouteAllowed(pathname: string, user: AuthUser | null): boolean {
  if (!user) return false;
  if (PUBLIC_ADMIN_ROUTES.has(pathname)) return true;

  for (const item of routePermissions) {
    if (pathname.startsWith(item.prefix)) {
      return hasAnyPermission(user, item.permissions);
    }
  }

  // Default-deny: unmapped /admin/* now requires the baseline admin permission
  // (previously this returned true, letting any authenticated user in).
  return hasPermission(user, BASELINE_ADMIN_PERMISSION);
}
