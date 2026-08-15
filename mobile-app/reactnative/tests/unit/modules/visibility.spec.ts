// Pure-logic tests for the module-visibility gate on the services grid.
// Run: npm run test:modules
//
// The gate decides which service tiles a user sees. Two failure directions:
//   • too strict → a mapping typo silently hides a shipped module forever;
//   • too loose  → an unpublished module leaks into production.
// The tests below pin both.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { visibilityFor, type ModuleVisibility } from '@/features/modules/rules';
import { SERVICE_MODULE_REGISTRY_KEY, registryKeyFor } from '@/features/modules/serviceModuleKeys';
import { SERVICE_MODULES } from '@/constants/modules';

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

  test('an unreachable registry shows the module rather than blanking the app', () => {
    // Deliberate fail-OPEN. The registry decides what to render, not what to
    // authorise — the API still refuses anything genuinely gated. Failing closed
    // here would empty the services tab on a flaky network.
    assert.equal(visibilityFor(null, 'telemedicine'), true);
    assert.equal(visibilityFor(undefined, 'telemedicine'), true);
  });

  test('matching is exact — no prefix or case coercion', () => {
    // 'health' must not satisfy 'healthLab'; a loose match would publish three
    // modules when an admin published one.
    assert.equal(visibilityFor(list('health'), 'healthLab'), false);
    assert.equal(visibilityFor(list('Telemedicine'), 'telemedicine'), false);
  });
});

describe('service-grid mapping', () => {
  test('every mapped id is a real tile in the grid', () => {
    // A mapping whose id no longer exists is dead weight that hides nothing and
    // misleads the next reader.
    const ids = new Set(SERVICE_MODULES.map((m) => m.id));
    for (const id of Object.keys(SERVICE_MODULE_REGISTRY_KEY)) {
      assert.ok(ids.has(id), `mapped id '${id}' is not in SERVICE_MODULES`);
    }
  });

  test('unmapped tiles are never registry-gated', () => {
    // The safe direction: no mapping ⇒ always render. Returning a key here would
    // gate a tile against a module the registry has never heard of, hiding it
    // permanently.
    assert.equal(registryKeyFor('academy'), null);
    assert.equal(registryKeyFor('definitely-not-a-module'), null);
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
    const all = gate(null).map((m) => m.id);
    // Publish everything except restaurant.
    const keys = new Set(Object.values(SERVICE_MODULE_REGISTRY_KEY));
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
    assert.ok(survivors.includes('academy'), 'an unmapped tile must not be hidden by the registry');
    assert.ok(!survivors.includes('telemedicine'), 'a mapped tile must be hidden when unpublished');
  });
});
