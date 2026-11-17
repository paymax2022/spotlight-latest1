// The 2026-11-17 menu-visibility decision, encoded as the registry response the
// staging plane must produce for the 20 keys this feature touched. Deliberately
// synthetic: it asserts THIS feature's keys only, so future admin toggles of
// unrelated modules cannot break it. If it goes red, either migration
// 20261216000100 drifted or a serviceModuleKeys mapping changed.
// Spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_MODULES } from '@/constants/modules';
import { moduleStateFor, type ModuleVisibility } from '@/features/modules/rules';
import { registryKeyFor } from '@/features/modules/serviceModuleKeys';

const HIDDEN_IN_STAGING = [
  'savings', 'loyalty', 'creators',
  'investment', 'learn', 'invest-ai', 'spotlight-wealth',
  'fractionalre', 'ai-trading', 'academy', 'dues', 'admin',
] as const;

const VISIBLE_IN_STAGING = [
  'crypto', 'education', 'naija-driver', 'film-academy',
  'connect', 'marketplace', 'shopping', 'parcel',
  'contest', 'property',
] as const;

const STAGING: ModuleVisibility = {
  environment: 'staging',
  modules: [
    'crypto', 'education', 'arena', 'filmAcademy', 'connect',
    'marketplace', 'shopping', 'parcel', 'voteBridge', 'realtor',
  ],
  comingSoon: [],
};

describe('staging menu-visibility matrix (2026-11-17 decision)', () => {
  const tiles = Object.fromEntries(SERVICE_MODULES.map((m) => [m.id, m]));

  for (const id of HIDDEN_IN_STAGING) {
    it(`hides ${id}`, () => {
      assert.ok(tiles[id], `${id} must be a real service tile`);
      const key = registryKeyFor(id);
      assert.ok(key, `${id} must be registry-gated`);
      assert.equal(moduleStateFor(STAGING, key), 'hidden');
    });
  }

  for (const id of VISIBLE_IN_STAGING) {
    it(`keeps ${id} visible`, () => {
      assert.ok(tiles[id], `${id} must be a real service tile`);
      const key = registryKeyFor(id);
      assert.ok(key, `${id} must be registry-gated`);
      assert.equal(moduleStateFor(STAGING, key), 'visible');
    });
  }
});
