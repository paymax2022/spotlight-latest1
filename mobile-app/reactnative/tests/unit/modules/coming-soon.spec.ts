// Pure-logic tests for the 'coming soon' module state.
// Run: npm run test:modules
//
// The state exists so ops can put a module in front of users as a teaser without it
// being tappable. Three failure directions are pinned here:
//   • a teaser silently disappearing (treated as hidden);
//   • a teaser rendering as fully functional (treated as visible → broken screen);
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

  test('an unreachable registry renders everything rather than blanking the tab', () => {
    assert.equal(moduleStateFor(null, 'anything'), 'visible');
    assert.equal(moduleStateFor(undefined, 'anything'), 'visible');
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

  test('unreachable registry still fails open', () => {
    assert.equal(visibilityFor(null, 'anything'), true);
  });
});
