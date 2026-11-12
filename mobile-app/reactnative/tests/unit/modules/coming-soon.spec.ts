// Pure-logic tests for the 'coming soon' module state.
// The state exists so ops can put a module in front of users as a teaser without it
// being tappable. Three failure directions are pinned here:
//   • the whole grid blanking when the registry is unreachable.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { moduleStateFor, visibilityFor, type ModuleVisibility } from '@/features/modules/rules';

const list = (modules: string[], comingSoon?: string[]): ModuleVisibility => ({
  environment: 'production',
  modules,
  ...(comingSoon ? { comingSoon } : {}),
});

describe('moduleStateFor', () => {
  test('resolves each of the three states', () => {
    const l = list(['wallet'], ['shopping']);
    assert.equal(moduleStateFor(l, 'wallet'), 'visible');
    assert.equal(moduleStateFor(l, 'shopping'), 'comingSoon');
    assert.equal(moduleStateFor(l, 'unlisted'), 'hidden');
  });

  test('an unreachable registry renders the money rails and hides the rest', () => {
    // Fail-closed by default, with a short allowlist (see STABLE_MODULE_KEYS).
    // The old behaviour rendered EVERY tile on a failed registry read, which is
    // how a module still under development reached store users: the registry
    // route simply did not exist on the web host, so every launch took this
    // branch and the admin's publication decision never applied.
    assert.equal(moduleStateFor(null, 'wallet'), 'visible');
    assert.equal(moduleStateFor(null, 'telemedicine'), 'hidden');
    assert.equal(moduleStateFor(undefined, 'anything'), 'hidden');
  });

  test('a response with no comingSoon field (older backend) yields no teasers', () => {
    const l = list(['wallet']);
    assert.equal(moduleStateFor(l, 'wallet'), 'visible');
    assert.equal(moduleStateFor(l, 'shopping'), 'hidden');
  });

  test('visible wins if a malformed payload lists a key in both', () => {
    // The server guarantees the lists are disjoint. If that ever breaks, preferring the
    // functional state means a bad payload cannot silently disable a live module.
    assert.equal(moduleStateFor(list(['wallet'], ['wallet']), 'wallet'), 'visible');
  });

  test('matching stays exact — no prefix or case coercion', () => {
    const l = list([], ['health']);
    assert.equal(moduleStateFor(l, 'healthLab'), 'hidden');
    assert.equal(moduleStateFor(l, 'Health'), 'hidden');
  });
});

describe('visibilityFor stays backward compatible', () => {
  test('a coming-soon module counts as VISIBLE — it is rendered, just inert', () => {
    // Existing callers use this as "should I render this at all?". A teaser must be
    // rendered, so it has to answer true; only 'hidden' is false.
    const l = list(['wallet'], ['shopping']);
    assert.equal(visibilityFor(l, 'shopping'), true);
    assert.equal(visibilityFor(l, 'wallet'), true);
    assert.equal(visibilityFor(l, 'unlisted'), false);
  });

  test('unreachable registry fails closed for anything not on the allowlist', () => {
    assert.equal(visibilityFor(null, 'anything'), false);
    assert.equal(visibilityFor(null, 'wallet'), true);
  });
});
