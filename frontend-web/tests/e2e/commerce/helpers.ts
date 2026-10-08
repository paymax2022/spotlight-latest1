/**
 * Shared helpers for the COMMERCE & SERVICES E2E coverage specs.
 *
 * Modules exercised: stays (member + extranet + admin), insurance (catalog +
 * claims), business registry, realtor admin, transport (mobility + driver +
 * modes + admin), learn, estate admin, restaurant bank-accounts, misc probes.
 *
 * Auth: provisioned users get a GoTrue access token — accepted by BOTH the Go
 * :8080 routes (RequireAuthContext) and the web BFF :3000 routes. Admin actions
 * use the admin fixture's bearer (super-admin role carries every RBAC slug the
 * per-route RequirePermission guards check).
 *
 * Fixture-only mutations (documented; never used to move product state):
 *   - wallet funding posts the SAME balanced journal the top-up webhook posts;
 *   - kyc_tier is seeded (no local KYC provider);
 *   - stays supplier refs / reservation COMPLETED state are stamped because no
 *     member or admin surface writes them (supplier webhook is the real surface
 *     but needs STAYS_SUPPLIER_WEBHOOK_SECRET — unset locally, fail-closed);
 *   - insurance policy/claim rows are seeded where a real bind needs a live
 *     MyCover/Octamile provider (no keys locally — provider calls are
 *     external-dep; seeded rows let the DB-side decision + payout legs run).
 */

import type { APIRequestContext } from '@playwright/test';

export {
  ADMIN_API_KEY,
  ADMIN_USER,
  ADMIN_WEB_URL,
  GO_BACKEND_URL,
  adminBearer,
  adminGo,
  adminGoAs,
  fundWallet,
  goTrueToken,
  ledgerSums,
  provisionVerifiedUser,
  psql,
  seedDriver,
  setKycTier,
  setProfilePhone,
  standingAccountBalance,
  uniqueEmail,
  walletBalance,
  type LedgerLeg,
  type ProvisionedUser,
} from '../cross/helpers';

export { assertKoboIntegers, idemKey, uniquePhone } from '../finance/helpers';

import { ADMIN_API_KEY, GO_BACKEND_URL, psql } from '../auth/helpers';
import { goTrueToken, ADMIN_USER } from '../provider/helpers';

/** Direct Go call with a bearer + arbitrary headers. */
export async function goFetch(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; token?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await request.fetch(`${GO_BACKEND_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.data !== undefined ? { data: opts.data } : {}),
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** Admin bearer for the RBAC-gated admin groups (RequireAuthContext + RequirePermission). */
export async function adminToken(request: APIRequestContext): Promise<string> {
  return goTrueToken(request, ADMIN_USER.email, ADMIN_USER.password);
}

/**
 * Convenience wrapper: admin-bearer call to a Go route, including the
 * x-admin-api-key header that middleware.RequireAdmin enforces on the
 * admin groups behind it (transport, maps, …). Groups without the key
 * gate ignore the extra header.
 */
export async function adminFetch(
  request: APIRequestContext,
  path: string,
  opts: { method?: string; data?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const token = await adminToken(request);
  return goFetch(request, path, {
    ...opts,
    token,
    headers: { 'x-admin-api-key': ADMIN_API_KEY, ...opts.headers },
  });
}

/**
 * Idempotently grant a permission slug to the dev admin user via a direct
 * user_permissions row (global scope). Needed where the seeded Super Admin
 * role predates a module's permission slugs (e.g. mobility.* — see CMS-006).
 */
export function grantAdminPerm(...slugs: string[]): void {
  for (const slug of slugs) {
    psql(
      `INSERT INTO user_permissions (user_id, permission_id, effect, scope_type, scope_id, reason) ` +
        `SELECT u.id, p.id, 'allow', 'global', NULL, 'e2e commerce lane fixture' ` +
        `FROM platform_users u, permissions p ` +
        `WHERE u.email = '${ADMIN_USER.email}' AND p.slug = '${slug}' ` +
        `ON CONFLICT (user_id, permission_id, effect, scope_type, scope_id) DO NOTHING;`,
    );
  }
}

// ── Stays fixtures ──────────────────────────────────────────────────────────

export interface StaysSupply {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  supplierPropertyRef: string;
}

/**
 * Drive the real hotelier-extranet onboarding surface: create property → room
 * type → rate plan, stamp deterministic supplier refs (the extranet leaves
 * them '' by default; the search/prebook contract keys on refs), then admin-
 * moderate the listing ACTIVE. Fixture stamping is limited to the two ref
 * columns — every other write goes through the real API.
 */
export async function onboardStaysProperty(
  request: APIRequestContext,
  hotelierToken: string,
  tag: string,
): Promise<StaysSupply> {
  const prop = await goFetch(request, '/api/stays/extranet/properties', {
    method: 'POST',
    token: hotelierToken,
    data: {
      name: `E2E Hotel ${tag}`,
      property_type: 'hotel',
      address: '1 E2E Way',
      city: 'Lagos',
      star_rating: 4,
    },
  });
  if (prop.status !== 201) throw new Error(`create property failed: ${prop.status} ${JSON.stringify(prop.body)}`);
  const propertyId = prop.body.data.id as string;

  const rt = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/room-types`, {
    method: 'POST',
    token: hotelierToken,
    data: { name: 'Deluxe King', occupancy: 2, bedding: 'king' },
  });
  if (rt.status !== 201 && rt.status !== 200) throw new Error(`create room type failed: ${rt.status} ${JSON.stringify(rt.body)}`);
  const roomTypeId = (rt.body.data?.id ?? rt.body.id) as string;

  const rp = await goFetch(request, `/api/stays/extranet/properties/${propertyId}/rate-plans`, {
    method: 'POST',
    token: hotelierToken,
    data: {
      room_type_id: roomTypeId,
      rate_plan_type: 'BAR',
      board: 'room_only',
      refundable: true,
      base_sell_rate_kobo: 5_000_000, // ₦50,000/night
      currency: 'NGN',
    },
  });
  if (rp.status !== 201 && rp.status !== 200) throw new Error(`create rate plan failed: ${rp.status} ${JSON.stringify(rp.body)}`);
  const ratePlanId = (rp.body.data?.id ?? rp.body.id) as string;

  // Deterministic supplier refs (fixture — extranet stamps '' which collides
  // across properties once more than one room type exists per property).
  psql(
    `update public.stays_room_type set supplier_room_type_ref='rt-${tag}' where id='${roomTypeId}';` +
      `update public.stays_rate_plan set supplier_rate_plan_ref='rp-${tag}' where id='${ratePlanId}';`,
  );

  // Admin moderation → ACTIVE (real surface: stays.admin.moderation RBAC).
  const mod = await adminFetch(request, `/api/stays/admin/properties/${propertyId}/status`, {
    method: 'POST',
    data: { status: 'ACTIVE' },
  });
  if (mod.status !== 200) throw new Error(`moderate property failed: ${mod.status} ${JSON.stringify(mod.body)}`);

  const ref = psql(`select supplier_property_ref from public.stays_property where id='${propertyId}';`);

  return { propertyId, roomTypeId, ratePlanId, supplierPropertyRef: ref };
}

/** Push per-date allotment (real ARI extranet surface) for a stay window. */
export async function pushAvailability(
  request: APIRequestContext,
  hotelierToken: string,
  roomTypeId: string,
  dates: string[],
  allotment = 3,
): Promise<void> {
  for (const d of dates) {
    const res = await goFetch(request, `/api/stays/extranet/room-types/${roomTypeId}/availability`, {
      method: 'PUT',
      token: hotelierToken,
      data: { date: d, allotment, stop_sell: false },
    });
    if (res.status !== 200) throw new Error(`availability push ${d} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** YYYY-MM-DD n days from now. */
export function datePlus(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Mark a reservation COMPLETED (fixture — supplier webhook is the real
 *  surface but needs a secret that is unset locally; fail-closed there). */
export function completeStaysReservation(reservationId: string): void {
  psql(
    `update public.stays_reservation set state='COMPLETED', version=version+1, updated_at=now() ` +
      `where id='${reservationId}' and state='CONFIRMED';`,
  );
}

/**
 * Fixture: insert a stays_reservation already at PREBOOK_OK carrying a valid
 * direct-rail book_token (format `direct:v1:<roomTypeId>:<ci>:<co>:<rooms>:<uuid>`
 * — unsigned, see adapters/direct.go encodeBookToken/decodeBookToken).
 *
 * The seeded PREBOOK_OK row lets the REAL /book saga (consent → escrow hold →
 * row-locked decrement → settle split → CONFIRMED → auto-release on failure) be
 * exercised end-to-end without driving the whole search→prebook funnel in every
 * spec. (POST /prebook + POST /agent/quote are exercised live in com-002/com-003.)
 *
 * `propertyIdOverride` reproduces the mobile-client ambiguity
 * (features/stays/api.ts sends the supplier ref as property_id): passing the
 * supplier ref stores it in res.property_id the way the client contract would.
 */
export function seedPrebookedReservation(
  userId: string,
  supply: StaysSupply,
  checkIn: string,
  checkOut: string,
  grossKobo: number,
  opts: {
    rooms?: number;
    netKobo?: number;
    commissionKobo?: number;
    propertyIdOverride?: string;
  } = {},
): { reservationId: string; bookToken: string } {
  const rooms = opts.rooms ?? 1;
  const bookToken = `direct:v1:${supply.roomTypeId}:${checkIn}:${checkOut}:${rooms}:${crypto.randomUUID()}`;
  const propertyId = opts.propertyIdOverride ?? supply.propertyId;
  const reservationId = psql(
    `insert into public.stays_reservation ` +
      `(guest_user_id, property_id, room_type_id, rate_plan_id, source_rail, supplier_code, ` +
      `state, check_in, check_out, rooms, occupancy, currency, ` +
      `gross_amount_kobo, tax_amount_kobo, net_rate_kobo, markup_kobo, commission_kobo, ` +
      `payment_method, cancellation_policy_snapshot, idempotency_key, book_token_ref) ` +
      `values ('${userId}','${propertyId}','${supply.roomTypeId}','${supply.ratePlanId}',` +
      `'DIRECT','self','PREBOOK_OK','${checkIn}','${checkOut}',${rooms},'{"adults":1}'::jsonb,'NGN',` +
      `${grossKobo},0,${opts.netKobo ?? grossKobo},0,${opts.commissionKobo ?? 0},` +
      `'WALLET','{}'::jsonb,'prebook:seed-${crypto.randomUUID()}','${bookToken}') returning id;`,
  ).split('\n')[0];
  return { reservationId, bookToken };
}

// ── Insurance fixtures ──────────────────────────────────────────────────────

/** Seed one catalog product row (fixture — catalog sync needs live providers).
 *  purchasable + provider_missing are what the member list filters on
 *  (ListForMember onlySellable): set them so the product is actually visible. */
export function seedInsuranceProduct(code: string, provider = 'mycover'): void {
  psql(
    `insert into public.insurance_products (code, display_name, product_line, provider, provider_product_code, active, purchasable, provider_missing, indicative_premium_kobo) ` +
      `values ('${code}','E2E ${code} Cover','general','${provider}','PP-${code}',true,true,false,250000) ` +
      `on conflict (code) do update set active=true, purchasable=true, provider_missing=false;`,
  );
}

/** Seed an ACTIVE bound policy (fixture — bind needs a live provider rail). */
export function seedActivePolicy(userId: string, productCode: string, provider = 'mycover'): string {
  const nonce = Date.now();
  return psql(
    `insert into public.insurance_policy (policyholder_user_id, product_code, provider, state, premium_amount_kobo, sum_insured_kobo, currency, provider_policy_ref) ` +
      `values ('${userId}','${productCode}','${provider}','ACTIVE',250000,5000000,'NGN','POL-${productCode}-${nonce}') returning id;`,
  ).split('\n')[0];
}

// ── Realtor fixtures ────────────────────────────────────────────────────────

export interface RealtorChain {
  portfolioId: string;
  propertyId: string;
  unitId: string;
  listingId: string;
}

/**
 * Seed the realtor object chain (portfolio → property → unit → listing) via
 * fixture SQL — the write side lives in Supabase RPCs the Go admin plane only
 * moderates. Listing lands in 'pending_verification'/'unverified' so the
 * admin queue + decision endpoints have a real row to act on.
 */
export function seedRealtorListing(ownerId: string, tag: string): RealtorChain {
  const portfolioId = psql(
    `insert into public.realtor_portfolios (owner_id, name) values ('${ownerId}','E2E PF ${tag}') returning id;`,
  ).split('\n')[0];
  const propertyId = psql(
    `insert into public.realtor_properties (portfolio_id, name, property_type, address, area, city, state) ` +
      `values ('${portfolioId}','E2E House ${tag}','duplex','1 E2E Way','Ikoyi','Lagos','Lagos') returning id;`,
  ).split('\n')[0];
  const unitId = psql(
    `insert into public.realtor_units (property_id, label, property_type) values ('${propertyId}','Unit A','duplex') returning id;`,
  ).split('\n')[0];
  const listingId = psql(
    `insert into public.realtor_listings (unit_id, title, mode, status, verification, price_kobo) ` +
      `values ('${unitId}','E2E Listing ${tag}','rent','pending_verification','unverified',50000000) returning id;`,
  ).split('\n')[0];
  return { portfolioId, propertyId, unitId, listingId };
}

/**
 * Seed lease → escrow deposit (→ optional submitted move-out) for the admin
 * escrow-resolution money path. Returns { leaseId, escrowId }.
 */
export function seedRealtorEscrow(
  chain: RealtorChain,
  tenantId: string,
  amountKobo: number,
  opts: { withMoveOut?: boolean } = {},
): { leaseId: string; escrowId: string } {
  const appId = psql(
    `insert into public.realtor_rental_applications (listing_id, user_id, full_name, email, phone) ` +
      `values ('${chain.listingId}','${tenantId}','E2E Tenant','t${Date.now()}@e2e.test','08000000001') returning id;`,
  ).split('\n')[0];
  const leaseId = psql(
    `insert into public.realtor_leases (application_id, listing_id, tenant_id, status, start_date, end_date, rent_kobo, caution_kobo) ` +
      `values ('${appId}','${chain.listingId}','${tenantId}','ended', current_date - 400, current_date - 30, 50000000, ${amountKobo}) returning id;`,
  ).split('\n')[0];
  const escrowId = psql(
    `insert into public.realtor_escrow_deposits (lease_id, amount_kobo, status) values ('${leaseId}',${amountKobo},'held') returning id;`,
  ).split('\n')[0];
  if (opts.withMoveOut) {
    psql(`insert into public.realtor_move_outs (lease_id, checklist, submitted_at) values ('${leaseId}','{}'::jsonb, now());`);
  }
  return { leaseId, escrowId };
}
