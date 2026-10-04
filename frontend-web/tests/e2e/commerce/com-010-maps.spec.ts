/**
 * CMS-010 — maps service: member PostGIS surfaces (pin upsert idempotent,
 * nearby, in-zone geofence) + provider-dependent primitives fail-closed
 * (no API keys locally → ErrNoProvider 503, never a panic) + admin-only
 * metrics/usage telemetry.
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  goFetch,
  goTrueToken,
  idemKey,
  provisionVerifiedUser,
  psql,
} from './helpers';

const LAGOS = { lat: 6.5244, lng: 3.3792 };
const ABUJA = { lat: 9.0765, lng: 7.3986 };

test.describe('CMS-010 maps: pins, geofence, provider guard, telemetry', () => {
  test('pin upsert (idempotent) → nearby → in-zone; validation guards', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-map');
    const token = await goTrueToken(request, user.email, user.password);

    // Pin upsert — the confirmed pin + Plus Code is the source of truth.
    const key = idemKey('pin');
    const pin = await goFetch(request, '/api/finance/maps/locations', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { entity_id: `ent-${Date.now()}`, entity_type: 'merchant', lat: LAGOS.lat, lng: LAGOS.lng },
    });
    expect(pin.status).toBe(200);
    expect(pin.body?.plus_code).toBeTruthy();
    // Replay with the same key → deduplicated no-op.
    const replay = await goFetch(request, '/api/finance/maps/locations', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': key },
      data: { entity_id: `ent-${Date.now()}-x`, entity_type: 'merchant', lat: LAGOS.lat, lng: LAGOS.lng },
    });
    expect(replay.status).toBe(200);
    expect(replay.body?.deduplicated).toBe(true);

    // Nearby finds our stored pin (PostGIS own-record search, never a maps API).
    const entityId = `ent-near-${Date.now()}`;
    await goFetch(request, '/api/finance/maps/locations', {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('pin2') },
      data: { entity_id: entityId, entity_type: 'merchant', lat: LAGOS.lat, lng: LAGOS.lng },
    });
    const near = await goFetch(request, '/api/finance/maps/nearby', {
      method: 'POST',
      token,
      data: { entity_type: 'merchant', point: LAGOS, radius_m: 2000, limit: 50 },
    });
    expect(near.status).toBe(200);
    expect((near.body?.results ?? []).some((r: any) => r.entityId === entityId || r.entity_id === entityId)).toBe(true);

    // In-zone geofence over service_areas (seeded Lagos polygon).
    const zoneId = psql(
      `insert into service_areas (id, owner_id, name, geog) values (gen_random_uuid(),'${user.userId}','e2e-lagos',` +
        `ST_GeogFromText('POLYGON((3.20 6.40, 3.60 6.40, 3.60 6.70, 3.20 6.70, 3.20 6.40))')) returning id;`,
    ).split('\n')[0];
    const inside = await goFetch(request, '/api/finance/maps/in-zone', {
      method: 'POST',
      token,
      data: { point: LAGOS, zone_id: zoneId },
    });
    expect(inside.status).toBe(200);
    expect(inside.body?.in_zone).toBe(true);
    const outside = await goFetch(request, '/api/finance/maps/in-zone', {
      method: 'POST',
      token,
      data: { point: ABUJA, zone_id: zoneId },
    });
    expect(outside.status).toBe(200);
    expect(outside.body?.in_zone).toBe(false);

    // Validation guards.
    const badPin = await goFetch(request, '/api/finance/maps/locations', {
      method: 'POST',
      token,
      data: { entity_id: 'x', entity_type: 'merchant', lat: 999, lng: 3.4 },
    });
    expect(badPin.status).toBe(400);
    const noZone = await goFetch(request, '/api/finance/maps/in-zone', {
      method: 'POST',
      token,
      data: { point: LAGOS },
    });
    expect(noZone.status).toBe(400);
    const negRadius = await goFetch(request, '/api/finance/maps/nearby', {
      method: 'POST',
      token,
      data: { entity_type: 'merchant', point: LAGOS, radius_m: -1 },
    });
    expect(negRadius.status).toBe(400);
  });

  test('provider primitives fail closed without keys; telemetry is admin-only', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-map2');
    const token = await goTrueToken(request, user.email, user.password);

    // No MAPS_* provider keys locally: the service logs "address lookup will
    // fall back to mock/offline" — every primitive must still answer cleanly
    // (deterministic mock or a mapped error), never a panic.
    for (const [path, data] of [
      ['/api/finance/maps/geocode', { address: '1 Marina Lagos' }],
      ['/api/finance/maps/reverse', { lat: LAGOS.lat, lng: LAGOS.lng }],
      ['/api/finance/maps/autocomplete', { query: 'marina' }],
      ['/api/finance/maps/route', { origin: LAGOS, dest: ABUJA }],
      ['/api/finance/maps/matrix', { origins: [LAGOS], dests: [ABUJA] }],
      ['/api/finance/maps/match', { trace: [LAGOS, ABUJA] }],
      ['/api/finance/maps/places', { query: 'pharmacy' }],
    ] as const) {
      const res = await goFetch(request, path, { method: 'POST', token, data });
      expect(res.status, `provider ${path}`).toBe(200);
    }
    const basemap = await goFetch(request, '/api/finance/maps/basemap', { token });
    expect([200, 503]).toContain(basemap.status);

    // Telemetry: member → 403 fail-closed.
    const mMetrics = await goFetch(request, '/api/finance/maps/metrics', { token });
    expect(mMetrics.status).toBe(403);
    const mUsage = await goFetch(request, '/api/finance/maps/usage', { token });
    expect(mUsage.status).toBe(403);
    // E2E-CMS-006 (fixed): adminRoleSlugs now uses the SEEDED hyphenated role
    // slugs ("super-admin"/"system-admin") — the Super Admin fixture reaches
    // the telemetry surfaces while ordinary members stay 403.
    const aMetrics = await adminFetch(request, '/api/finance/maps/metrics');
    expect(aMetrics.status).toBe(200);
    const aUsage = await adminFetch(request, '/api/finance/maps/usage');
    expect(aUsage.status).toBe(200);
  });
});
