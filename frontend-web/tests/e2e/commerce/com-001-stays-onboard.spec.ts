/**
 * CMS-001 — stays: hotelier extranet onboarding + ARI + admin moderation +
 * member discovery/consent surface.
 *
 * Journey: a member becomes a hotelier via the real extranet surface
 * (POST /api/stays/extranet/properties grants the OWNER profile — no outer
 * RBAC, object-scope checked in the service), lists room types + rate plans,
 * pushes availability/rates/restrictions/promotions through the ARI calendar,
 * then admin moderation flips the listing ACTIVE so member search sees it.
 *
 * Member surface exercised: consent status/grant, destinations, home, deals,
 * loyalty, saved/wishlist toggle, saved-guests CRUD, search, content.
 *
 * Fixture-only: deterministic supplier_room_type_ref/supplier_rate_plan_ref
 * are stamped via psql (extranet leaves them ''; the search/prebook contract
 * keys on refs and '' collides across properties).
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  datePlus,
  goFetch,
  goTrueToken,
  onboardStaysProperty,
  provisionVerifiedUser,
  psql,
  pushAvailability,
} from './helpers';

test.describe('CMS-001 stays: extranet onboarding → ARI → moderation → discovery', () => {
  test('hotelier onboards property, pushes ARI, admin moderates, member discovers + consents', async ({
    request,
  }) => {
    const tag = `${Date.now() % 100000}`;
    const hotelier = await provisionVerifiedUser(request, 'cms-hotel');
    const hToken = await goTrueToken(request, hotelier.email, hotelier.password);
    const guest = await provisionVerifiedUser(request, 'cms-guest');
    const gToken = await goTrueToken(request, guest.email, guest.password);

    // ── Extranet: property + room type + rate plan (real surface) ─────────
    const prop = await goFetch(request, '/api/stays/extranet/properties', {
      method: 'POST',
      token: hToken,
      data: { name: `E2E Suites ${tag}`, property_type: 'hotel', address: '7 Test Ave', city: 'Lagos', star_rating: 4 },
    });
    expect(prop.status).toBe(201);
    const propertyId = prop.body.data.id as string;

    const mine = await goFetch(request, '/api/stays/extranet/me/properties', { token: hToken });
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((p: any) => p.id === propertyId)).toBe(true);

    const getProp = await goFetch(request, `/api/stays/extranet/properties/${propertyId}`, { token: hToken });
    expect(getProp.status).toBe(200);
    expect(getProp.body.data.name).toContain('E2E Suites');

    // Content + details edits.
    const upd = await goFetch(request, `/api/stays/extranet/properties/${propertyId}`, {
      method: 'PATCH',
      token: hToken,
      data: { name: `E2E Suites ${tag} Renamed`, description: 'coverage sweep hotel', city: 'Lagos' },
    });
    expect(upd.status).toBe(200);
    const updD = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/details`, {
      method: 'PATCH',
      token: hToken,
      data: { lat: 6.5244, lng: 3.3792, amenities: ['wifi', 'pool'], check_in_from: '14:00', check_out_until: '11:00' },
    });
    expect(updD.status).toBe(200);

    const rt = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/room-types`, {
      method: 'POST',
      token: hToken,
      data: { name: 'Deluxe King', occupancy: 2, bedding: 'king' },
    });
    expect([200, 201]).toContain(rt.status);
    const roomTypeId = (rt.body.data?.id ?? rt.body.id) as string;
    expect(roomTypeId).toBeTruthy();

    const rp = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/rate-plans`, {
      method: 'POST',
      token: hToken,
      data: { room_type_id: roomTypeId, rate_plan_type: 'BAR', board: 'room_only', refundable: true, base_sell_rate_kobo: 5_000_000, currency: 'NGN' },
    });
    expect([200, 201]).toContain(rp.status);
    const ratePlanId = (rp.body.data?.id ?? rp.body.id) as string;
    expect(ratePlanId).toBeTruthy();

    const rtList = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/room-types`, { token: hToken });
    expect(rtList.status).toBe(200);
    const rpList = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/rate-plans`, { token: hToken });
    expect(rpList.status).toBe(200);

    // Deterministic supplier refs (fixture — see helpers comment).
    psql(
      `update public.stays_room_type set supplier_room_type_ref='rt-${tag}' where id='${roomTypeId}';` +
        `update public.stays_rate_plan set supplier_rate_plan_ref='rp-${tag}' where id='${ratePlanId}';`,
    );

    // ── ARI: availability + rates + restrictions + promotions ─────────────
    const ci = datePlus(14);
    const co = datePlus(16);
    await pushAvailability(request, hToken, roomTypeId, [ci, datePlus(15)], 3);

    const availCal = await goFetch(
      request,
      `/api/stays/extranet/room-types/${roomTypeId}/availability?from=${ci}&to=${co}`,
      { token: hToken },
    );
    expect(availCal.status).toBe(200);
    expect(availCal.body.data.length).toBeGreaterThanOrEqual(2);

    const rateDay = await goFetch(request, `/api/stays/extranet/rate-plans/${ratePlanId}/calendar`, {
      method: 'PUT',
      token: hToken,
      data: { date: ci, price_kobo: 5_000_000 },
    });
    expect(rateDay.status).toBe(200);

    const bulk = await goFetch(request, `/api/stays/extranet/rate-plans/${ratePlanId}/calendar/bulk`, {
      method: 'POST',
      token: hToken,
      data: { date_from: ci, date_to: co, price_kobo: 5_000_000 },
    });
    expect(bulk.status).toBe(200);

    const rateCal = await goFetch(
      request,
      `/api/stays/extranet/rate-plans/${ratePlanId}/calendar?from=${ci}&to=${co}`,
      { token: hToken },
    );
    expect(rateCal.status).toBe(200);

    const restr = await goFetch(request, `/api/stays/extranet/rate-plans/${ratePlanId}/restrictions`, {
      method: 'POST',
      token: hToken,
      data: { date_from: ci, date_to: co, min_los: 1 },
    });
    expect(restr.status).toBe(200);

    const promo = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/promotions`, {
      method: 'POST',
      token: hToken,
      data: { name: 'E2E Promo', discount_bps: 500, date_from: ci, date_to: co },
    });
    expect([200, 201]).toContain(promo.status);
    const promoList = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/promotions`, { token: hToken });
    expect(promoList.status).toBe(200);
    if (promoList.body.data?.length) {
      const promoId = promoList.body.data[0].id;
      const act = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/promotions/${promoId}/active`, {
        method: 'POST',
        token: hToken,
        data: { active: true },
      });
      expect(act.status).toBe(200);
    }

    // Object-scope negative: a non-owner cannot push ARI on this property.
    const foreign = await goFetch(request, `/api/stays/extranet/room-types/${roomTypeId}/availability`, {
      method: 'PUT',
      token: gToken,
      data: { date: ci, allotment: 9, stop_sell: false },
    });
    expect(foreign.status).toBe(403);

    // Verification surfaces.
    const ver = await goFetch(request, '/api/stays/extranet/verification', { token: hToken });
    expect(ver.status).toBe(200);
    const verB = await goFetch(request, '/api/stays/extranet/verification/business', { token: hToken });
    expect([200, 404]).toContain(verB.status);

    // Photos list (empty — R2 presign is unconfigured locally, fail-closed 503/400 on presign).
    const photos = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/photos`, { token: hToken });
    expect(photos.status).toBe(200);
    const presign = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/photos/presign`, {
      method: 'POST',
      token: hToken,
      data: { file_name: 'cover.jpg', content_type: 'image/jpeg' },
    });
    expect([400, 503]).toContain(presign.status); // fail-closed, never a fabricated URL

    // Staff surface (object-scoped).
    const staff = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/staff`, { token: hToken });
    expect(staff.status).toBe(200);

    // ── Admin moderation → ACTIVE ─────────────────────────────────────────
    const sup = await adminFetch(request, '/api/stays/admin/suppliers');
    expect(sup.status).toBe(200);
    const supUp = await adminFetch(request, '/api/stays/admin/suppliers', {
      method: 'POST',
      data: { source_rail: 'DIRECT', supplier_code: 'self', adapter: 'direct', active: true },
    });
    expect([200, 201]).toContain(supUp.status);

    const mq = await adminFetch(request, '/api/stays/admin/mapping-queue');
    expect(mq.status).toBe(200);

    const mod = await adminFetch(request, `/api/stays/admin/properties/${propertyId}/status`, {
      method: 'POST',
      data: { status: 'ACTIVE' },
    });
    expect(mod.status).toBe(200);

    const adminRes = await adminFetch(request, '/api/stays/admin/reservations');
    expect(adminRes.status).toBe(200);

    // ── Member discovery + consent + search ───────────────────────────────
    const consBefore = await goFetch(request, '/api/finance/stays/consent', { token: gToken });
    expect(consBefore.status).toBe(200);
    const grant = await goFetch(request, '/api/finance/stays/consent', { method: 'POST', token: gToken, data: {} });
    expect([200, 201]).toContain(grant.status);
    const consAfter = await goFetch(request, '/api/finance/stays/consent', { token: gToken });
    expect(consAfter.status).toBe(200);

    for (const p of ['/api/finance/stays/destinations?q=lag', '/api/finance/stays/home', '/api/finance/stays/deals', '/api/finance/stays/loyalty']) {
      const r = await goFetch(request, p, { token: gToken });
      expect(r.status).toBe(200);
    }

    // Wishlist + saved guests.
    const key = `DIRECT|self|${psql(`select supplier_property_ref from public.stays_property where id='${propertyId}'`)}`;
    const tog = await goFetch(request, `/api/finance/stays/saved/${encodeURIComponent(key)}/toggle`, {
      method: 'POST',
      token: gToken,
    });
    expect(tog.status).toBe(200);
    const saved = await goFetch(request, '/api/finance/stays/saved', { token: gToken });
    expect(saved.status).toBe(200);

    const sg = await goFetch(request, '/api/finance/stays/saved-guests', {
      method: 'POST',
      token: gToken,
      data: { full_name: 'E2E Traveller', email: guest.email, phone: '08000000000', is_lead: true },
    });
    expect([200, 201]).toContain(sg.status);
    const sgList = await goFetch(request, '/api/finance/stays/saved-guests', { token: gToken });
    expect(sgList.status).toBe(200);
    const sgId = sgList.body.data?.[0]?.id;
    if (sgId) {
      const del = await goFetch(request, `/api/finance/stays/saved-guests/${sgId}`, { method: 'DELETE', token: gToken });
      expect(del.status).toBe(200);
    }

    // Search finds the ACTIVE listing; content resolves.
    const search = await goFetch(
      request,
      `/api/finance/stays/search?city=Lagos&check_in=${ci}&check_out=${co}&rooms=1&adults=2`,
      { token: gToken },
    );
    expect(search.status).toBe(200);
    const found = (search.body.data ?? []).find(
      (r: any) => r.offer?.supplier_property_ref === psql(`select supplier_property_ref from public.stays_property where id='${propertyId}'`),
    );
    expect(found, 'expected ACTIVE direct listing in search results').toBeTruthy();
    expect(found.breakdown.gross_kobo).toBeGreaterThan(0);
    expect(Number.isInteger(found.breakdown.gross_kobo)).toBe(true);

    const content = await goFetch(
      request,
      `/api/finance/stays/properties/DIRECT/self/${found.offer.supplier_property_ref}`,
      { token: gToken },
    );
    expect(content.status).toBe(200);
    expect(content.body.data.name).toContain('E2E Suites');

    // DRAFT listings never surface: a second unmoderated property is absent.
    const draft = await goFetch(request, '/api/stays/extranet/properties', {
      method: 'POST',
      token: hToken,
      data: { name: `E2E Draft ${tag}`, property_type: 'shortlet', address: '9 Hidden St', city: 'Lagos' },
    });
    expect(draft.status).toBe(201);
    const search2 = await goFetch(
      request,
      `/api/finance/stays/search?city=Lagos&check_in=${ci}&check_out=${co}&rooms=1`,
      { token: gToken },
    );
    const draftRef = psql(`select supplier_property_ref from public.stays_property where id='${draft.body.data.id}'`);
    expect((search2.body.data ?? []).some((r: any) => r.offer?.supplier_property_ref === draftRef)).toBe(false);
  });
});
