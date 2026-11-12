// Pure-logic tests for the module-visibility gate on the services grid.
// The gate decides which service tiles a user sees. Two failure directions:
//   • too loose  → an unpublished module leaks into production.
// The tests below pin both.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  visibilityFor,
  moduleStateFor,
  resolveModuleState,
  STABLE_MODULE_KEYS,
  type ModuleVisibility,
} from '@/features/modules/rules';
import {
  SERVICE_MODULE_REGISTRY_KEY,
  registryKeyFor,
  PROPERTY_SUBMODULE_REGISTRY_KEY,
  propertyRegistryKeyFor,
  QUICK_ACTION_REGISTRY_KEY,
  quickActionRegistryKeyFor,
  FEATURED_REGISTRY_KEY,
  featuredRegistryKeyFor,
} from '@/features/modules/serviceModuleKeys';
import {
  moduleKeyForSegments,
  guardAppliesTo,
  MODULE_LABELS,
} from '@/features/modules/routeModuleKeys';
import {
  SERVICE_MODULES,
  PROPERTY_SUBMODULES,
  QUICK_ACTIONS,
  FEATURED_SERVICES,
} from '@/constants/modules';

const list = (...modules: string[]): ModuleVisibility => ({ environment: 'production', modules });

describe('visibilityFor', () => {
  test('shows a published module and hides an unpublished one', () => {
    assert.equal(visibilityFor(list('telemedicine', 'wallet'), 'telemedicine'), true);
    assert.equal(visibilityFor(list('telemedicine', 'wallet'), 'restaurant'), false);
  });

  test('an empty published list hides everything registry-gated', () => {
    // Distinct from "unreachable" below: the server answered, and the answer is
    // that nothing is published here.
    assert.equal(visibilityFor(list(), 'telemedicine'), false);
  });

  test('an unreachable registry shows the money rails and hides unreleased work', () => {
    // Fail-CLOSED, with one exception: the long-live rails that hold a user's
    // own money. The previous behaviour showed every tile when the registry
    // could not be read, on the reasoning that this only decides what to render
    // and the API refuses the rest. That reasoning held only while the registry
    // route existed; with the route missing it became the normal path, and the
    // admin's publication decision stopped applying to store builds altogether.
    // A last-known-good answer (see resolveModuleState) covers the flaky-network
    // case, so hiding unreleased work no longer means an empty tab.
    assert.equal(visibilityFor(null, 'wallet'), true);
    assert.equal(visibilityFor(undefined, 'walletTransfers'), true);
    assert.equal(visibilityFor(null, 'telemedicine'), false);
    assert.equal(visibilityFor(undefined, 'restaurant'), false);
  });

  test('the allowlist only ever contains keys the app knows', () => {
    // A typo here would permanently show a tile the admin hid, and no other
    // test would notice because every other case compares against a live list.
    const known = new Set<string>(Object.keys(MODULE_LABELS));
    for (const key of STABLE_MODULE_KEYS) {
      assert.ok(known.has(key), `STABLE_MODULE_KEYS has '${key}', which is not a registry key`);
    }
  });

  test('matching is exact — no prefix or case coercion', () => {
    // modules when an admin published one.
    assert.equal(visibilityFor(list('health'), 'healthLab'), false);
    assert.equal(visibilityFor(list('Telemedicine'), 'telemedicine'), false);
  });
});

describe('resolveModuleState — the last known answer beats the allowlist', () => {
  test('a live registry read wins over anything cached', () => {
    const cached = list('telemedicine', 'restaurant');
    const fresh = list('wallet');
    assert.equal(resolveModuleState(fresh, cached, 'restaurant'), false);
    assert.equal(resolveModuleState(fresh, cached, 'wallet'), true);
  });

  test('a failed read falls back to what the device saw last', () => {
    // This is what makes fail-closed affordable: a user on a flaky network keeps
    // the grid they had, instead of losing every module nobody unpublished.
    const cached = list('telemedicine');
    assert.equal(resolveModuleState(null, cached, 'telemedicine'), true);
    assert.equal(resolveModuleState(undefined, cached, 'restaurant'), false);
  });

  test('no read and no cache leaves only the allowlist', () => {
    assert.equal(resolveModuleState(null, null, 'wallet'), true);
    assert.equal(resolveModuleState(null, null, 'telemedicine'), false);
  });

  test('a cached answer listing nothing stays nothing — an empty registry is an answer', () => {
    // Distinguishes "the admin published nothing here" from "we never asked".
    // Treating a persisted empty list as absent would resurrect the old leak.
    assert.equal(resolveModuleState(null, list(), 'telemedicine'), false);
    assert.equal(resolveModuleState(null, list(), 'wallet'), false);
  });
});

describe('service-grid mapping', () => {
  test('every mapped id is a real tile in the grid', () => {
    // A mapping whose id no longer exists is dead weight that hides nothing and
    // misleads the next reader.
    const ids = new Set<string>(SERVICE_MODULES.map((m) => m.id));
    for (const id of Object.keys(SERVICE_MODULE_REGISTRY_KEY)) {
      assert.ok(ids.has(id), `mapped id '${id}' is not in SERVICE_MODULES`);
    }
  });

  test('unmapped tiles are never registry-gated', () => {
    // The safe direction: no mapping ⇒ always render. Returning a key here would
    // gate a tile against a module the registry has never heard of, hiding it
    // permanently. 'shopping' is a coming-soon placeholder with no engine and no
    // registry row; 'academy' USED to belong in this list and became a real module
    // in 20271410000000.
    assert.equal(registryKeyFor('shopping'), null);
    assert.equal(registryKeyFor('definitely-not-a-module'), null);
  });

  test('the seven surfaces registered in 20271410000000 are now gated', () => {
    // These tiles used to ignore the registry completely — publishing or hiding them
    // in the admin portal changed nothing, which is how an unfinished module stayed
    // in the store build.
    const gates: [string, string][] = [
      ['marketplace', 'marketplace'],
      ['crypto', 'crypto'],
      ['learn', 'academy'],
      ['academy', 'academy'],
      ['film-academy', 'filmAcademy'],
      ['contest', 'competitions'],
      ['naija-driver', 'arena'],
      ['connect', 'connect'],
    ];
    for (const [id, key] of gates) {
      assert.equal(registryKeyFor(id), key, `'${id}' must follow the '${key}' module`);
      assert.ok(REGISTRY_KEYS.has(key), `'${id}' maps to '${key}', which is not a registered module`);
    }
  });

  test('the whole bill-payment family maps to one registry module', () => {
    for (const id of ['bills', 'airtime', 'data', 'electricity', 'cable-tv']) {
      assert.equal(registryKeyFor(id), 'utilityPayments', `${id} should follow utilityPayments`);
    }
  });

  test('health sub-modules map to their own keys, not the umbrella', () => {
    // Publishing pharmacy must not publish the lab.
    assert.equal(registryKeyFor('pharmacy'), 'healthPharmacy');
    assert.equal(registryKeyFor('laboratory'), 'healthLab');
    assert.equal(registryKeyFor('veterinary'), 'healthVet');
  });
});

describe('the gate applied to the grid', () => {
  const gate = (published: ModuleVisibility | null) =>
    SERVICE_MODULES.filter((m) => {
      const key = registryKeyFor(m.id);
      return key === null || visibilityFor(published, key);
    });

  test('hiding one module removes exactly its tiles', () => {
    // Baseline is "every module published", not "registry unknown". Since the
    // fallback went fail-closed those two are different grids, and what this
    // test cares about is the one-tile difference an unpublish makes.
    const everyKey = Object.values(SERVICE_MODULE_REGISTRY_KEY);
    const all = gate(list(...everyKey)).map((m) => m.id);
    // Publish everything except restaurant.
    const keys = new Set(everyKey);
    keys.delete('restaurant');
    const withoutFood = gate(list(...keys)).map((m) => m.id);

    assert.ok(all.includes('food'), 'precondition: food is in the grid');
    assert.ok(!withoutFood.includes('food'), 'unpublishing restaurant must remove the food tile');
    // And nothing else moved.
    const removed = all.filter((id) => !withoutFood.includes(id));
    assert.deepEqual(removed.sort(), ['food', 'food-ride'].filter((id) => all.includes(id)).sort());
  });

  test('unmapped tiles survive an empty published list', () => {
    const survivors = gate(list()).map((m) => m.id);
    assert.ok(survivors.includes('shopping'), 'an unmapped tile must not be hidden by the registry');
    assert.ok(!survivors.includes('telemedicine'), 'a mapped tile must be hidden when unpublished');
  });
});

describe('property hub gate', () => {
  const gate = (published: ModuleVisibility | null) =>
    PROPERTY_SUBMODULES.filter((p) => {
      const key = propertyRegistryKeyFor(p.id);
      return key === null || visibilityFor(published, key);
    });

  test('every mapped pillar id is a real pillar', () => {
    const ids = new Set<string>(PROPERTY_SUBMODULES.map((p) => p.id));
    for (const id of Object.keys(PROPERTY_SUBMODULE_REGISTRY_KEY)) {
      assert.ok(ids.has(id), `mapped pillar '${id}' is not in PROPERTY_SUBMODULES`);
    }
  });

  test("the two id-spaces do not share a table", () => {
    // 'marketplace' means the lifestyle shopping tile in one space and the
    // property buy/rent marketplace in the other. One shared table would gate the
    // shopping tile on the realtor module — the reason these maps are separate.
    // Both now resolve, to DIFFERENT modules: the shopping tile got its own registry
    // key in 20271410000000, while the property pillar still follows realtor.
    assert.equal(registryKeyFor('marketplace'), 'marketplace');
    assert.equal(propertyRegistryKeyFor('marketplace'), 'realtor');
  });

  test('unpublishing realtor hides both listings and leases', () => {
    // pillars follow it.
    const left = gate(list('stays', 'estate')).map((p) => p.id);
    assert.deepEqual(left.sort(), ['estate', 'stays']);
  });

  test('publishing only stays leaves exactly one pillar', () => {
    assert.deepEqual(gate(list('stays')).map((p) => p.id), ['stays']);
  });

  test('all pillars unpublished yields an empty hub, not a partial one', () => {
    // produce zero rather than silently falling back to "show everything".
    assert.equal(gate(list()).length, 0);
  });

  test('an unreachable registry shows no property pillar', () => {
    // Property is a service, not a rail that holds a user's money, so it is not
    // on the allowlist. The hub goes empty rather than advertising verticals an
    // admin never published; the last known answer (not tested here) is what
    // covers a genuinely offline device.
    assert.equal(gate(null).length, 0);
  });
});

// Mirrors the keys seeded into platform_modules (supabase migrations 20261210000000,
// generated from frontend-web/src/lib/feature-flags.ts, and 20271410000000, the app
// surfaces that had no flag). Keep in
// a module that can never be published, hiding it forever with no error anywhere.
const REGISTRY_KEYS = new Set([
  'academy', 'aiCare', 'arena', 'association', 'beneficiaries', 'checkoutTopupTier0',
  'competitions', 'connect', 'creators', 'crypto', 'crowdfunding', 'disputes', 'estate',
  'events', 'filmAcademy', 'fintechAdmin', 'fx', 'groups', 'health', 'healthLab',
  'healthPharmacy', 'healthVet', 'insurance', 'kyc', 'loyalty', 'marketplace', 'ratings',
  'realtor', 'referrals', 'restaurant', 'savings', 'socialPay', 'stays', 'telemedicine',
  'tierLimits', 'transport', 'utilityPayments', 'virtualAccounts', 'voteBridge',
  'votesBridge', 'wallet', 'walletBankTransfers', 'walletTransfers',
]);

describe('mapped values are real registry modules', () => {
  test('every services-grid mapping targets a registered module', () => {
    for (const [id, key] of Object.entries(SERVICE_MODULE_REGISTRY_KEY)) {
      assert.ok(REGISTRY_KEYS.has(key), `'${id}' maps to '${key}', which is not a registered module`);
    }
  });

  test('every property-hub mapping targets a registered module', () => {
    for (const [id, key] of Object.entries(PROPERTY_SUBMODULE_REGISTRY_KEY)) {
      assert.ok(REGISTRY_KEYS.has(key), `'${id}' maps to '${key}', which is not a registered module`);
    }
  });
});

describe('home tab gates', () => {
  test('every mapped quick-action and featured id is real', () => {
    const qaIds = new Set<string>(QUICK_ACTIONS.map((q) => q.id));
    for (const id of Object.keys(QUICK_ACTION_REGISTRY_KEY)) {
      assert.ok(qaIds.has(id), `quick action '${id}' does not exist`);
    }
    const fIds = new Set<string>(FEATURED_SERVICES.map((f) => f.id));
    for (const id of Object.keys(FEATURED_REGISTRY_KEY)) {
      assert.ok(fIds.has(id), `featured card '${id}' does not exist`);
    }
  });

  test('quick-action and featured mappings target registered modules', () => {
    for (const [id, key] of Object.entries(QUICK_ACTION_REGISTRY_KEY)) {
      assert.ok(REGISTRY_KEYS.has(key), `quick action '${id}' -> unknown module '${key}'`);
    }
    for (const [id, key] of Object.entries(FEATURED_REGISTRY_KEY)) {
      assert.ok(REGISTRY_KEYS.has(key), `featured '${id}' -> unknown module '${key}'`);
    }
  });

  test('ids that are NOT service tiles resolve only in their own space', () => {
    // 'withdraw' and 'exchange' were dropped from the services map because no such
    // tile exists; they are quick actions. 'food-ride' is a featured card only.
    // Each must resolve in exactly one table.
    assert.equal(registryKeyFor('withdraw'), null);
    assert.equal(quickActionRegistryKeyFor('withdraw'), 'walletBankTransfers');
    assert.equal(registryKeyFor('exchange'), null);
    assert.equal(quickActionRegistryKeyFor('exchange'), 'fx');
    assert.equal(registryKeyFor('food-ride'), null);
    assert.equal(featuredRegistryKeyFor('food-ride'), 'restaurant');
  });

  test('unpublishing a wallet sub-module removes only its quick action', () => {
    const gateQA = (published: ModuleVisibility | null) =>
      QUICK_ACTIONS.filter((q) => {
        const k = quickActionRegistryKeyFor(q.id);
        return k === null || visibilityFor(published, k);
      }).map((q) => q.id);

    // Everything except walletTransfers: 'send' goes, the rest stay.
    const left = gateQA(list('wallet', 'walletBankTransfers', 'fx'));
    assert.ok(!left.includes('send'), 'send must follow walletTransfers');
    assert.deepEqual(left.sort(), ['add', 'exchange', 'withdraw']);
  });

  test('a category group that gates to empty is dropped entirely', () => {
    // The Explore card renders a label + grid per group. A group filtered to zero
    // must disappear, not render a label above an empty grid.
    const groups = [
      { label: 'Financial', modules: SERVICE_MODULES.filter((m) => m.category === 'financial') },
      { label: 'Learn', modules: SERVICE_MODULES.filter((m) => m.id === 'shopping') },
    ];
    const gated = groups
      .map((g) => ({ ...g, modules: g.modules.filter((m) => {
        const k = registryKeyFor(m.id);
        return k === null || visibilityFor(list(), k);
      }) }))
      .filter((g) => g.modules.length > 0);

    // Financial is entirely registry-mapped, so an empty published list clears it.
    assert.ok(!gated.some((g) => g.label === 'Financial'), 'empty Financial group must be dropped');
    // Learn is 'shopping', a placeholder tile with no registry module, so it survives.
    assert.ok(gated.some((g) => g.label === 'Learn'), 'ungated group must survive');
  });
});

describe('route guard', () => {
  test('a nested route beats its parent', () => {
    // The whole reason for longest-first matching. If ['health'] won, publishing
    // the health umbrella would silently publish pharmacy, lab and vet too.
    assert.equal(moduleKeyForSegments(['health', 'lab']), 'healthLab');
    assert.equal(moduleKeyForSegments(['health', 'pharmacy']), 'healthPharmacy');
    assert.equal(moduleKeyForSegments(['health', 'vet']), 'healthVet');
  });

  test('every screen beneath a mapped route inherits the gate', () => {
    // Prefix matching is what keeps this to one map instead of 36 entries.
    assert.equal(
      moduleKeyForSegments(['services', 'telemedicine', 'book', 'confirm']),
      'telemedicine',
    );
    assert.equal(moduleKeyForSegments(['health', 'lab', 'checkout']), 'healthLab');
    assert.equal(moduleKeyForSegments(['wallet', 'send', 'review']), 'wallet');
  });

  test('hubs and navigation are never gated', () => {
    // screen that lists what IS available.
    assert.equal(moduleKeyForSegments(['services']), null);
    assert.equal(moduleKeyForSegments(['(tabs)', 'home']), null);
    assert.equal(moduleKeyForSegments(['profile']), null);
  });

  test('ambiguous and unregistered routes are left ungated', () => {
    // Conservative on purpose: gating a route wrongly locks users out of a
    // working screen, which is worse than leaving one merely undiscoverable.
    // 'academy' here is the TOP-LEVEL /academy, which is not a route — StudyHub
    // lives at /learn/academy and is gated through 'learn' below.
    for (const seg of [['academy'], ['dues'], ['properties'], ['investment'], ['invest-ai'], ['shopping'], ['parcel']]) {
      assert.equal(moduleKeyForSegments(seg), null, `${seg[0]} should not be gated`);
    }
  });

  test('the surfaces registered in 20271410000000 are now gated by route too', () => {
    // The guard used to be blind to all seven, so a push notification or a saved
    // link reached screens the admin portal had no power over.
    const gated: [string[], string][] = [
      [['marketplace'], 'marketplace'],
      [['crypto'], 'crypto'],
      [['learn'], 'academy'],
      // Prefix matching: StudyHub needs no entry of its own.
      [['learn', 'academy', 'lesson', '1'], 'academy'],
      [['film-academy'], 'filmAcademy'],
      [['voting'], 'competitions'],
      [['arena'], 'arena'],
      [['connect'], 'connect'],
    ];
    for (const [seg, key] of gated) {
      assert.equal(moduleKeyForSegments(seg), key, `/${seg.join('/')} must follow '${key}'`);
      assert.ok(REGISTRY_KEYS.has(key), `'${key}' is not a registered module`);
      // And an unpublished one must actually be refused by the guard.
      assert.equal(visibilityFor(list(), key), false, `${key} must be hidden when unpublished`);
    }
  });

  test('every route mapping targets a registered module', () => {
    for (const seg of [
      ['health', 'lab'], ['health', 'pharmacy'], ['health', 'vet'],
      ['services', 'telemedicine'], ['services', 'bills'], ['services', 'cards'],
      ['wallet'], ['savings'], ['stays'], ['mobility'], ['food'], ['realtor'],
      ['association'], ['events'], ['fractionalre'], ['referral'], ['social'],
    ]) {
      const key = moduleKeyForSegments(seg);
      assert.ok(key && REGISTRY_KEYS.has(key), `/${seg.join('/')} -> '${key}' is not a registered module`);
    }
  });

  test('the guard never runs on itself, or on the auth stack', () => {
    // the auth guard over navigation is the other way to trap a user.
    assert.equal(guardAppliesTo(['module-unavailable']), false);
    assert.equal(guardAppliesTo(['(auth)', 'login']), false);
    assert.equal(guardAppliesTo(['onboarding']), false);
    assert.equal(guardAppliesTo([]), false);
    // …but it does run on real module routes.
    assert.equal(guardAppliesTo(['services', 'telemedicine']), true);
  });

  test('a hidden module blocks its deep link, a published one does not', () => {
    const blocked = (segs: string[], published: ModuleVisibility | null) => {
      if (!guardAppliesTo(segs)) return false;
      const key = moduleKeyForSegments(segs);
      if (!key) return false;
      return !visibilityFor(published, key);
    };
    const deep = ['services', 'telemedicine', 'book', 'confirm'];
    assert.equal(blocked(deep, list('wallet')), true, 'unpublished module must block');
    assert.equal(blocked(deep, list('telemedicine')), false, 'published module must pass');
    // Fail closed while the registry is unknown: a deep link is exactly how an
    // unpublished vertical got used, because the tile being hidden did not stop
    // a push notification or a saved link from landing on the screen.
    assert.equal(blocked(deep, null), true, 'unknown registry must block an allowlist-absent module');
    // The money rails stay reachable even then, or a fault locks a user out of
    // their own wallet.
    assert.equal(blocked(['wallet'], null), false, 'allowlisted module must not block');
  });

  test('every label maps to a registered module', () => {
    for (const key of Object.keys(MODULE_LABELS)) {
      assert.ok(REGISTRY_KEYS.has(key), `label for '${key}' is not a registered module`);
    }
  });
});
