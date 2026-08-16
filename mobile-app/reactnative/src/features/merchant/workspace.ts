// ── Merchant workspace resolution ────────────────────────────────────────────
//
// Closes the seam between onboarding and the tools an approved merchant actually
// uses. On approval the Go service writes
// `workspace_route = "/merchant/<merchant-type-slug>"` (onboarding/service.go),
// and every capability row in the app links there — but no such route existed:
// `app/(merchant)` is a route GROUP, and parentheses are not a path segment. So
// an approved merchant tapped their capability and went nowhere.
//
// This maps the slug the server issues onto the screens that really exist, and
// says plainly when a merchant type has no tooling yet rather than dumping the
// user on an unrelated screen. (The previous client-side guess sent everyone who
// was not a doctor to `/services/marketplace` — including restaurant merchants,
// who have the richest tooling in the app.)
//
// Dependency-free so it can run under `node --test`.

import type { MerchantProfile } from '@/types/merchant';

/** A merchant type's home inside the app, keyed by the server's type slug. */
export interface MerchantWorkspace {
  /** Human name, for the "not built yet" copy. */
  label: string;
  /**
   * Where the tools live. Undefined means this type is approved-able but has no
   * merchant tooling yet — an honest gap, not a routing bug.
   */
  route?: string;
}

/**
 * Slug → workspace. Slugs are `onb_merchant_type.slug` (the live set is
 * restaurant, pharmacy, medical-practitioner, seller).
 *
 * Routes point at each type's real entry screen:
 *   • restaurant           — Manage Store, which itself links to Orders + Earnings
 *   • medical-practitioner — the doctor tab group; its dashboard is the `index`
 *                            tab, so the route is the GROUP. The old client guess
 *                            used `/(doctor)/(tabs)/dashboard`, which does not
 *                            resolve — there is no `dashboard` screen.
 *   • seller               — marketplace selling: listings, compose, edit, boost
 *   • pharmacy             — nothing yet. Everything under app/health/pharmacy is
 *                            the CUSTOMER side (cart, checkout, BNPL).
 */
export const MERCHANT_WORKSPACES: Record<string, MerchantWorkspace> = {
  restaurant: { label: 'Restaurant', route: '/food/restaurant/manage' },
  'medical-practitioner': { label: 'Medical practice', route: '/(doctor)/(tabs)' },
  seller: { label: 'Marketplace shop', route: '/marketplace/sell' },
  pharmacy: { label: 'Pharmacy' },
};

export type WorkspaceResolution =
  /** Send them to their tools. */
  | { kind: 'workspace'; route: string; label: string }
  /** They hold this capability, but it has no tooling yet. */
  | { kind: 'not-built'; label: string }
  /** Signed in, but holds no active profile for this merchant type. */
  | { kind: 'not-a-merchant'; label: string }
  /** A slug the app has never heard of. */
  | { kind: 'unknown'; slug: string };

/** ACTIVE is the only state that grants access; SUSPENDED/REVOKED must not. */
function activeProfileFor(slug: string, profiles: readonly MerchantProfile[]): MerchantProfile | null {
  for (const p of profiles) {
    if (p.status !== 'ACTIVE') continue;
    // The profile carries the server's own route; the last segment is the slug.
    if (workspaceSlug(p.workspaceRoute) === slug) return p;
  }
  return null;
}

/**
 * The slug out of a `/merchant/<slug>` route.
 *
 * Tolerates a trailing slash and a query string, and returns '' for anything
 * that is not a merchant route — so a legacy profile still carrying an old
 * hard-coded route (e.g. `/services/marketplace`) simply does not match, rather
 * than matching the wrong slug.
 */
export function workspaceSlug(route: string | undefined | null): string {
  if (!route) return '';
  const path = route.split('?')[0].replace(/\/+$/, '');
  const m = /^\/merchant\/([^/]+)$/.exec(path);
  return m ? m[1] : '';
}

/**
 * Decide what `/merchant/[slug]` should do for this caller.
 *
 * Authorization is by the caller's OWN capabilities: holding the URL for a
 * merchant type you have not been approved for resolves to `not-a-merchant`.
 * That is a UX guard, not the security boundary — every merchant API enforces
 * ownership server-side — but it keeps someone off a workspace that would only
 * fail on its first request.
 */
export function resolveWorkspace(
  slug: string,
  profiles: readonly MerchantProfile[] | undefined,
): WorkspaceResolution {
  const known = MERCHANT_WORKSPACES[slug];
  if (!known) return { kind: 'unknown', slug };

  const profile = activeProfileFor(slug, profiles ?? []);
  if (!profile) return { kind: 'not-a-merchant', label: known.label };

  if (!known.route) return { kind: 'not-built', label: known.label };
  return { kind: 'workspace', route: known.route, label: known.label };
}
