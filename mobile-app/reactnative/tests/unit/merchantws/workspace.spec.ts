// Pure-logic unit tests for merchant workspace resolution.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/merchantws/*.spec.ts"
//
// The defect these close: on approval the Go service writes
// workspace_route = "/merchant/<slug>", every capability row links there, and no
// such route existed — app/(merchant) is a route GROUP and parentheses are not a
// path segment. Approved merchants tapped their capability and went nowhere.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkspace,
  workspaceSlug,
  MERCHANT_WORKSPACES,
} from '@/features/merchant/workspace';
import type { MerchantProfile } from '@/types/merchant';

const profile = (over: Partial<MerchantProfile> = {}): MerchantProfile => ({
  id: 'mp-1',
  userId: 'u-1',
  moduleId: 'mod-food',
  moduleName: 'Food',
  merchantTypeId: 'mt-restaurant',
  merchantTypeName: 'Restaurant',
  icon: 'UtensilsCrossed',
  roleGranted: 'restaurant_merchant',
  status: 'ACTIVE',
  workspaceRoute: '/merchant/restaurant',
  ...over,
});

describe('workspaceSlug', () => {
  it('reads the slug the server issues', () => {
    assert.equal(workspaceSlug('/merchant/restaurant'), 'restaurant');
    assert.equal(workspaceSlug('/merchant/medical-practitioner'), 'medical-practitioner');
  });

  it('tolerates a trailing slash and a query string', () => {
    assert.equal(workspaceSlug('/merchant/seller/'), 'seller');
    assert.equal(workspaceSlug('/merchant/seller?from=hub'), 'seller');
  });

  it('does not match a non-merchant route', () => {
    // A legacy profile may still carry an old hard-coded route. It must simply
    // not match, rather than matching some wrong slug.
    assert.equal(workspaceSlug('/services/marketplace'), '');
    assert.equal(workspaceSlug('/(doctor)/(tabs)/dashboard'), '');
    assert.equal(workspaceSlug('/merchant/a/b'), '');
    assert.equal(workspaceSlug(undefined), '');
    assert.equal(workspaceSlug(''), '');
  });
});

describe('resolveWorkspace', () => {
  it('sends an approved restaurant merchant to its real tools', () => {
    // The headline case: previously routed to /services/marketplace, which is
    // the shopping tab, while Manage Store sat unreachable.
    const r = resolveWorkspace('restaurant', [profile()]);
    assert.equal(r.kind, 'workspace');
    if (r.kind === 'workspace') assert.equal(r.route, '/food/restaurant/manage');
  });

  it('routes a practitioner to the doctor tab group, not a dashboard screen', () => {
    // The old guess used /(doctor)/(tabs)/dashboard; the tab is named `index`
    // and merely titled "Dashboard", so that route does not resolve.
    const r = resolveWorkspace('medical-practitioner', [
      profile({ workspaceRoute: '/merchant/medical-practitioner' }),
    ]);
    assert.equal(r.kind, 'workspace');
    if (r.kind === 'workspace') {
      assert.equal(r.route, '/(doctor)/(tabs)');
      assert.ok(!r.route.endsWith('/dashboard'));
    }
  });

  it('sends an approved pharmacist to their order inbox', () => {
    // Pharmacy was 'not-built' until the inbox existed. It is the merchant side
    // (app/pharmacy); app/health/pharmacy is the CUSTOMER side.
    const r = resolveWorkspace('pharmacy', [profile({ workspaceRoute: '/merchant/pharmacy' })]);
    assert.equal(r.kind, 'workspace');
    if (r.kind === 'workspace') assert.equal(r.route, '/pharmacy/orders');
  });

  it('still reports honestly when a type genuinely has no tooling', () => {
    // The not-built path must keep working for the next type added to the
    // registry before its screens exist — that is the whole point of the state.
    const stub = { label: 'Stub trade' } as const;
    const original = MERCHANT_WORKSPACES.__stub;
    (MERCHANT_WORKSPACES as Record<string, typeof stub>).__stub = stub;
    try {
      const r = resolveWorkspace('__stub', [profile({ workspaceRoute: '/merchant/__stub' })]);
      assert.equal(r.kind, 'not-built');
      if (r.kind === 'not-built') assert.equal(r.label, 'Stub trade');
    } finally {
      if (original === undefined) delete (MERCHANT_WORKSPACES as Record<string, unknown>).__stub;
    }
  });

  it('refuses a workspace the caller has not been approved for', () => {
    // Holding the URL is not approval. The server enforces ownership on every
    // merchant API; this keeps the user off a screen that would only fail later.
    const r = resolveWorkspace('seller', [profile()]); // holds restaurant only
    assert.equal(r.kind, 'not-a-merchant');
  });

  it('treats a non-ACTIVE profile as no access', () => {
    for (const status of ['SUSPENDED', 'REVOKED', 'PENDING'] as const) {
      const r = resolveWorkspace('restaurant', [profile({ status: status as never })]);
      assert.equal(r.kind, 'not-a-merchant', `${status} must not grant a workspace`);
    }
  });

  it('handles no profiles and missing capabilities without throwing', () => {
    assert.equal(resolveWorkspace('restaurant', []).kind, 'not-a-merchant');
    assert.equal(resolveWorkspace('restaurant', undefined).kind, 'not-a-merchant');
  });

  it('reports an unknown slug rather than guessing', () => {
    const r = resolveWorkspace('haberdashery', [profile()]);
    assert.equal(r.kind, 'unknown');
  });

  it('ignores a legacy profile whose route predates /merchant/<slug>', () => {
    // Profiles written by the old client carried e.g. /services/marketplace.
    // They must not silently unlock a workspace.
    const legacy = profile({ workspaceRoute: '/services/marketplace' });
    assert.equal(resolveWorkspace('restaurant', [legacy]).kind, 'not-a-merchant');
    assert.equal(resolveWorkspace('seller', [legacy]).kind, 'not-a-merchant');
  });

  it('covers every merchant type the platform seeds', () => {
    // onb_merchant_type currently seeds these four. A new type without an entry
    // would resolve to `unknown`, which this catches at build time instead.
    for (const slug of ['restaurant', 'pharmacy', 'medical-practitioner', 'seller']) {
      assert.ok(MERCHANT_WORKSPACES[slug], `no workspace entry for '${slug}'`);
      assert.ok(MERCHANT_WORKSPACES[slug].label, `'${slug}' needs a label for its empty state`);
    }
  });
});
