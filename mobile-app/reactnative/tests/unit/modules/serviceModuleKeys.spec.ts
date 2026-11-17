// Every services-grid tile must be registry-gated. Until 2026-11-17 the map was
// deliberately partial and an unmapped tile rendered unconditionally — safe while
// the registry only knew backend modules, but the admin console now owns the whole
// grid, so an unmapped id is a bug: nobody could ever toggle it off.
// Spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md (R6).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_MODULES, FEATURED_SERVICES } from '@/constants/modules';
import { registryKeyFor, featuredRegistryKeyFor } from '@/features/modules/serviceModuleKeys';

describe('services-grid registry coverage (R6)', () => {
  it('maps every SERVICE_MODULES id to a registry key', () => {
    const unmapped = SERVICE_MODULES.filter((m) => registryKeyFor(m.id) === null);
    assert.deepEqual(
      unmapped.map((m) => `${m.id} (${m.label})`),
      [],
      'tiles with no registry mapping render unconditionally and cannot be toggled from /admin/modules',
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
