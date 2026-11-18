// Every services-grid tile must be registry-gated. Until 2026-11-17 the map was
// deliberately partial and an unmapped tile rendered unconditionally — safe while
// the registry only knew backend modules, but the admin console now owns the whole
// grid, so an unmapped id is a bug: nobody could ever toggle it off.
// EXCEPTION (added when this landed on top of #996): a tile with no platform_modules
// row must stay unmapped — gating it against a key nobody can publish turns its
// "coming soon" badge into a hidden tile. The list is the whole exemption; 'support'
// is NOT in it because coming-soon is not the test — aiCare is a real registered
// module, so support is gated even while its own surface is flagged coming-soon.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_MODULES, FEATURED_SERVICES } from '@/constants/modules';
import { registryKeyFor, featuredRegistryKeyFor } from '@/features/modules/serviceModuleKeys';

const NO_REGISTRY_ROW = new Set(['shopping', 'parcel']);

describe('services-grid registry coverage (R6)', () => {
  it('maps every SERVICE_MODULES id that has a registry module', () => {
    const unmapped = SERVICE_MODULES.filter(
      (m) => !NO_REGISTRY_ROW.has(m.id) && registryKeyFor(m.id) === null,
    );
    assert.deepEqual(
      unmapped.map((m) => `${m.id} (${m.label})`),
      [],
      'tiles with no registry mapping render unconditionally and cannot be toggled from /admin/modules',
    );
  });

  it('gates nothing that has no registry row', () => {
    const gated = SERVICE_MODULES.filter(
      (m) => NO_REGISTRY_ROW.has(m.id) && registryKeyFor(m.id) !== null,
    );
    assert.deepEqual(
      gated.map((m) => `${m.id} -> ${registryKeyFor(m.id)}`),
      [],
      'a tile mapped to a module the registry cannot publish loses its badge and can disappear entirely',
    );
  });

  it('maps every FEATURED_SERVICES id to a registry key', () => {
    const unmapped = FEATURED_SERVICES.filter((f) => featuredRegistryKeyFor(f.id) === null);
    assert.deepEqual(
      unmapped.map((f) => `${f.id} (${f.title})`),
      [],
      'featured cards render on home unconditionally when unmapped',
    );
  });
});
