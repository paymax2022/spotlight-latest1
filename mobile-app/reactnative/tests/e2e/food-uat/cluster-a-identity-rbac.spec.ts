import { expect, test } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { mockAmbientRequests, mockModuleVisibility } from '../helpers/common';

/**
 * Restaurant 332-case UAT — Cluster A: Identity, RBAC & Upgrades
 * (RST-UAT-0001 .. RST-UAT-0063). Results: docs/qa/food-uat-332/cluster-a-identity-rbac.md
 *
 * Three kinds of test live here:
 *   1. EXECUTABLE  — runs against :8083 (RN web), :3001 (admin) or :8080 (Go API)
 *      with no seeded multi-actor fixtures (unauthenticated / forged-token legs,
 *      screen reachability, enumeration safety).
 *   2. BLOCKED     — needs fixtures the harness does not have (SMS/email gateway,
 *      real multi-role Supabase users, admin credentials). Declared so the ID is
 *      listed and skipped with the exact missing dependency.
 *   3. N/A / KNOWN DEFECT — capability absent (proof path in the skip reason) or
 *      behaviour proven wrong by code read; skipped with the defect id.
 */

const API = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:8080';
const ADMIN = process.env.E2E_ADMIN_BASE_URL ?? 'http://127.0.0.1:3001';
const UUID = '00000000-0000-4000-8000-000000000001';
const FORGED = { Authorization: 'Bearer forged.invalid.token' };

function blocked(id: string, title: string, why: string) {
  test(`${id} — ${title}`, async () => {
    test.skip(true, `BLOCKED: ${why}`);
  });
}
function na(id: string, title: string, proof: string) {
  test(`${id} — ${title}`, async () => {
    test.skip(true, `N/A: ${proof}`);
  });
}
function defect(id: string, title: string, defectId: string, why: string) {
  test(`${id} — ${title}`, async () => {
    test.fixme(true, `KNOWN DEFECT ${defectId}: ${why}`);
  });
}

async function foodShell(page: import('@playwright/test').Page) {
  await mockAmbientRequests(page);
  await mockModuleVisibility(page, ['restaurant']);
  await page.route('**/api/finance/restaurant/mine**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/finance/restaurant/rider/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await loginAs(page);
}

// ───────────────────────── Customer Accounts (0001-0012) ─────────────────────────
test.describe('Cluster A · Customer Accounts', () => {
  blocked('RST-UAT-0001', 'Register using valid contact and OTP', 'needs SMS/email test gateway to read the OTP; signup screen app/(auth)/signup.tsx exists');
  blocked('RST-UAT-0002', 'Block duplicate phone registration', 'needs a verified fixture customer + OTP gateway');
  blocked('RST-UAT-0003', 'Reject invalid or expired OTP', 'needs a live OTP issued by the gateway (app/(auth)/verify-otp.tsx; internal/otp attempt ceiling)');
  blocked('RST-UAT-0004', 'Enforce OTP resend controls', 'needs OTP gateway; limiter present at backend/internal/app/router.go loginLimiter/resetLimiter');

  test('RST-UAT-0005 — Login via password or configured method (generic invalid-credential response; valid-login leg needs a fixture)', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { email: 'nobody-uat-a@example.invalid', password: 'Wrong-pass-1' },
    });
    expect(res.status()).toBe(401);
  });

  blocked('RST-UAT-0006', 'Reject disabled account login', 'needs admin-disabled fixture account (platform_users.status gate in auth_service.go LoginUser)');
  blocked('RST-UAT-0007', 'Reset credentials safely', 'needs email OTP gateway to complete the reset challenge');
  blocked('RST-UAT-0008', 'Protect session on token expiry', 'needs a real Supabase session with controllable expiry');
  blocked('RST-UAT-0009', 'Update customer profile', 'needs real session + R2 upload for photo');
  blocked('RST-UAT-0010', 'Manage saved addresses', 'needs real session + two devices for the default-address persistence leg');

  test('RST-UAT-0011 — Prevent insecure account enumeration (unknown identifier gets generic responses)', async ({ request }) => {
    const reset = await request.post(`${API}/api/auth/request-password-reset`, {
      data: { email: 'nobody-uat-a@example.invalid' },
    });
    expect(reset.status()).toBe(200);
    const body = await reset.json();
    expect(String(body.message)).toMatch(/if your email exists/i);
    expect(JSON.stringify(body)).not.toMatch(/not found|no account|does not exist/i);
    const login = await request.post(`${API}/api/auth/login`, {
      data: { email: 'nobody-uat-a@example.invalid', password: 'Wrong-pass-1' },
    });
    expect(login.status()).toBe(401);
    expect(String((await login.json()).error)).toBe('invalid credentials');
  });

  blocked('RST-UAT-0012', 'Handle revoked second device session', 'needs two live sessions for one fixture user and a global sign-out');
});

// ───────────────────────── Owner Upgrade (0013-0025) ─────────────────────────
test.describe('Cluster A · Owner Upgrade', () => {
  test('RST-UAT-0013 — Find merchant upgrade from customer profile (Sell food on Paymax, same session)', async ({ page }) => {
    await foodShell(page);
    await page.goto('/food', { waitUntil: 'domcontentloaded' });
    const sell = page.getByLabel('Sell food on Paymax — set up your restaurant');
    await expect(sell).toBeVisible();
    await sell.click();
    await expect(page).toHaveURL(/\/food\/restaurant/);
    await expect(page).not.toHaveURL(/signup|register/);
  });

  blocked('RST-UAT-0014', 'Preserve identity and history after upgrade', 'needs seeded customer with order history; by construction restaurants.owner_id = auth user id (no second identity)');
  blocked('RST-UAT-0015', 'Save partially completed application', 'needs live owner token; PUT /api/finance/restaurant/:id/kyb saves draft (kyb.go SaveKYB)');
  blocked('RST-UAT-0016', 'Enforce required application fields', 'needs live owner token; covered at unit level by go test ./internal/restaurant -run KYB (validateKYBForSubmit) which passes');
  blocked('RST-UAT-0017', 'Upload valid ownership documents', 'needs live owner token + R2 credentials (ErrKYBUploadsUnavailable fallback to link)');
  defect('RST-UAT-0018', 'Reject malformed oversized or unsafe upload', 'FOOD-UAT-A-005', 'PresignKYBDocument validates extension<->content-type only; no max size, no content sniffing (kyb_documents.go:126-176)');
  blocked('RST-UAT-0019', 'Submit application for review', 'needs live owner token');
  defect('RST-UAT-0020', 'Prevent duplicate applications', 'FOOD-UAT-A-009', 'SubmitKYB takes no Idempotency-Key; replay hits submitted->submitted (denied by fsm) and errors instead of returning the first result (kyb.go:286-313)');
  blocked('RST-UAT-0021', 'Track status and review feedback', 'needs live owner token; kyb.tsx renders "More information needed"/"Verification declined" banners from decision_reason');
  defect('RST-UAT-0022', 'Block merchant actions before approval', 'FOOD-UAT-A-010', 'opening the store and withdrawals are gated on kyb_status=approved, but a pending applicant can still create categories/items (no approval gate in CreateItem)');
  blocked('RST-UAT-0023', 'Approve from admin without account split', 'needs admin credentials (restaurant.admin.onboarding) + owner token; AdminDecideApplication sets is_open on the same restaurants row');
  defect('RST-UAT-0024', 'Reject application and request correction', 'FOOD-UAT-A-008', 'backend supports needs_info but admin onboarding console exposes only Approve/Reject (frontend-admin/app/admin/restaurant/onboarding/page.tsx)');
  blocked('RST-UAT-0025', 'Reconcile approval notification delivery', 'needs device-offline simulation + admin approval; notify() is best-effort');
});

// ───────────────────────── Owner KYB (0026-0032) ─────────────────────────
test.describe('Cluster A · Owner KYB', () => {
  na('RST-UAT-0026', 'Verify mandatory business evidence (per-jurisdiction checklist)', 'no checklist/jurisdiction model in frontend-admin/app/admin/restaurant/onboarding/page.tsx or backend/internal/restaurant/admin_repo.go (reviewer sees docs, records only approve/reject + note) — FOOD-UAT-A-011');
  na('RST-UAT-0027', 'Review owner/business name match', 'no automated or recorded name-match comparison anywhere in backend/internal/restaurant/kyb*.go or admin_repo.go; manual reviewer judgement only — FOOD-UAT-A-011');
  defect('RST-UAT-0028', 'Check approval separation of duties', 'FOOD-UAT-A-002', 'AdminDecideApplication has no applicant != reviewer check (admin_repo.go:215); route is permission-gated only');
  defect('RST-UAT-0029', 'Approve complete KYB', 'FOOD-UAT-A-003/A-004', 'approve works with no KYB submission at all (admin_repo.go:261-276) and writes no audit event, only a best-effort notification');
  blocked('RST-UAT-0030', 'Reject with documented reason', 'needs admin credentials; code enforces a reviewer note on non-approve (admin_repo.go:234) and notifies owner');
  defect('RST-UAT-0031', 'Resubmit expired documentation', 'FOOD-UAT-A-007', 'restaurant_kyb_documents is UPSERT on (restaurant_id, doc_type): replacement overwrites, no version history (kyb.go AddKYBDocument)');
  blocked('RST-UAT-0032', 'Avoid public exposure of KYB evidence', 'needs two merchant tokens; KYB lives in restaurant_kyb* tables not serialised by GetRestaurant, docs are private R2 keys');
});

// ───────────────────────── Rider Upgrade (0033-0042) ─────────────────────────
// Rider onboarding is NOT part of the Food module: Food dispatch reads the shared
// transport `drivers` table (dispatch.go:80, delivery.go:711). The upgrade flow is
// app/mobility/driver/onboarding.tsx + transport admin /drivers/:id/verification.
test.describe('Cluster A · Rider Upgrade', () => {
  na('RST-UAT-0033', 'Start rider upgrade using customer login', 'no Become-a-Rider entry under mobile-app/reactnative/app/food/ (rider/index.tsx is offers only); flow lives in app/mobility/driver/onboarding.tsx — FOOD-UAT-A-012');
  blocked('RST-UAT-0034', 'Retain customer purchases after approval', 'needs approved-driver fixture; drivers.user_id is the customer auth id so history is shared by construction');
  na('RST-UAT-0035', 'Capture vehicle mode and service areas', 'owned by Mobility driver onboarding (app/mobility/driver/onboarding.tsx), not Food');
  na('RST-UAT-0036', 'Reject missing rider KYC', 'owned by Mobility driver onboarding / transport admin, not Food');
  na('RST-UAT-0037', 'Enforce document size/type', 'owned by Mobility uploadDriverDocumentFile, not Food');
  na('RST-UAT-0038', 'Submit and track rider application', 'owned by Mobility driver onboarding (status step), not Food');
  blocked('RST-UAT-0039', 'Approve rider to activate provider role', 'needs admin + driver fixtures; Food gate verified by code: delivery.go:709-717 requires drivers.verification_status=approved');
  na('RST-UAT-0040', 'Reject and resubmit rider application', 'owned by transport admin SetVerification (backend/internal/transport/admin.go:137), not Food');
  na('RST-UAT-0041', 'Do not create duplicate riders on repeated submission', 'owned by Mobility driver onboarding, not Food');
  defect('RST-UAT-0042', 'Handle expired licence after activation', 'FOOD-UAT-A-013', 'no document-expiry check in transport admin.go SetVerification or in Food dispatch/AcceptDelivery; approved status is the only gate');
});

// ───────────────────────── Rider Verification (0043-0047) ─────────────────────────
test.describe('Cluster A · Rider Verification', () => {
  blocked('RST-UAT-0043', 'Validate identity evidence', 'needs admin creds; SetVerification writes audit (transport/admin.go writeAudit)');
  defect('RST-UAT-0044', 'Validate transport credentials by mode', 'FOOD-UAT-A-013', 'SetVerification accepts any status with no credential/expiry validation');
  blocked('RST-UAT-0045', 'Restrict rider bank edits', 'needs approved-rider token; no payout-account cooling-off found in handler_withdrawal.go/withdrawal.go (unverified live)');
  defect('RST-UAT-0046', 'Prevent reviewer self-approval', 'FOOD-UAT-A-002', 'PATCH /api/transport/admin/drivers/:id/verification (finance_routes.go:2327) is permission-gated only; no actor != driver.user_id check');
  na('RST-UAT-0047', 'Track training or equipment readiness (Conditional)', 'no induction/helmet/food-handling readiness model in backend/internal/restaurant, backend/internal/transport or app/food (grep empty)');
});

// ───────────────────────── Role Lifecycle (0048-0055) ─────────────────────────
test.describe('Cluster A · Role Lifecycle', () => {
  defect('RST-UAT-0048', 'Suspend merchant account', 'FOOD-UAT-A-006', 'no merchant suspend state: admin force-close (AdminSetAvailability) is reversible by the owner via PATCH /:id/availability because kyb_status stays approved (delivery.go:580-600); menu edits unaffected; no audit row');
  defect('RST-UAT-0049', 'Suspend rider during active delivery', 'FOOD-UAT-A-001', 'SetVerification only forces drivers.status=offline; orders.rider_id / restaurant_delivery_offers untouched, in-flight job never reassigned');
  blocked('RST-UAT-0050', 'Reinstate after verification', 'needs admin creds; suspended->approved re-entry is allowed with no re-verification check (transport/admin.go:146)');
  na('RST-UAT-0051', 'Withdraw pending provider application', 'no withdraw/cancel route for KYB: only GET/PUT /:id/kyb, documents, submit (backend/internal/app/finance_routes.go:1750-1757) — FOOD-UAT-A-014');

  test('RST-UAT-0052 — Switch customer to restaurant owner mode and back (same session)', async ({ page }) => {
    await foodShell(page);
    await page.goto('/food', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Restaurant owner dashboard').click();
    await expect(page).toHaveURL(/\/food\/restaurant/);
    await page.goto('/food', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Food & Delivery')).toBeVisible();
    await expect(page.getByLabel('My orders')).toBeVisible();
  });

  test('RST-UAT-0053 — Switch customer to rider mode (rider offers screen reachable on customer session)', async ({ page }) => {
    await foodShell(page);
    await page.goto('/food/rider', { waitUntil: 'domcontentloaded' });
    // First hit of /food/rider cold-compiles the Metro bundle; 10s default flaked once.
    await expect(page.getByText('Rider · Offers')).toBeVisible({ timeout: 45_000 });
    await page.goto('/food', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Food & Delivery')).toBeVisible();
  });

  na('RST-UAT-0054', 'Support dual merchant and rider approval policy (Conditional)', 'no dual-role policy configuration; restaurants.owner_id and drivers.user_id are independent tables with no policy hook (grep empty in backend/internal/restaurant)');
  defect('RST-UAT-0055', 'Revoke provider role without deleting customer', 'FOOD-UAT-A-006', 'no revoke-merchant-role operation exists (admin routes finance_routes.go:1891-1903 only edit/close); rider revoke exists via SetVerification=rejected/suspended');
});

// ───────────────────────── RBAC & Tenant Isolation (0056-0063) ─────────────────────────
test.describe('Cluster A · RBAC and Tenant Isolation', () => {
  test('RST-UAT-0056 — Deny customer access to merchant APIs (unauthenticated + forged-token legs)', async ({ request }) => {
    for (const headers of [{}, FORGED]) {
      const create = await request.post(`${API}/api/finance/restaurant/${UUID}/menu/items`, {
        headers, data: { name: 'x', price_kobo: 100 },
      });
      expect([401, 403]).toContain(create.status());
      const accept = await request.patch(`${API}/api/finance/restaurant/${UUID}/orders/${UUID}/status`, {
        headers, data: { status: 'accepted' },
      });
      expect([401, 403]).toContain(accept.status());
    }
  });

  test('RST-UAT-0057 — Deny merchant access to rider-only APIs (unauthenticated + forged-token legs)', async ({ request }) => {
    for (const headers of [{}, FORGED]) {
      for (const p of ['accept', 'pickup', 'handoff']) {
        const r = await request.post(`${API}/api/finance/restaurant/orders/${UUID}/${p}`, { headers, data: {} });
        expect([401, 403]).toContain(r.status());
      }
    }
  });

  blocked('RST-UAT-0058', 'Prevent tenant crossover', 'needs two merchant tokens + two restaurants; code: every owner route goes through AssertStaffPermission(restaurantID,userID) in staff_roles.go:157');

  test('RST-UAT-0059 — Limit rider access to assigned delivery (unauthenticated + forged-token legs)', async ({ request }) => {
    for (const headers of [{}, FORGED]) {
      const order = await request.get(`${API}/api/finance/restaurant/orders/${UUID}`, { headers });
      expect([401, 403]).toContain(order.status());
      const offers = await request.get(`${API}/api/finance/restaurant/rider/offers`, { headers });
      expect([401, 403]).toContain(offers.status());
    }
  });

  blocked('RST-UAT-0060', 'Constrain restaurant staff delegation', 'needs owner + kitchen-staff tokens; permission matrix proven by go test ./internal/restaurant -run Staff (passes)');
  blocked('RST-UAT-0061', 'Revoke staff permission instantly', 'needs live staff session; code: ResolveStaffRole reads restaurant_staff per request (no cache) so revoke is immediate');

  test('RST-UAT-0062 — Protect admin access (unauthenticated API + console legs)', async ({ request }) => {
    for (const headers of [{}, FORGED]) {
      for (const p of ['onboarding', 'payouts', 'withdrawals', 'disputes']) {
        const r = await request.get(`${API}/api/restaurant/admin/${p}`, { headers });
        expect([401, 403]).toContain(r.status());
      }
      const decide = await request.post(`${API}/api/restaurant/admin/onboarding/${UUID}/approve`, { headers, data: {} });
      expect([401, 403]).toContain(decide.status());
    }
    const console_ = await request.get(`${ADMIN}/admin/restaurant/onboarding`, { maxRedirects: 0 });
    expect([302, 303, 307, 308, 401]).toContain(console_.status());
  });

  blocked('RST-UAT-0063', 'Handle cross-role stale session', 'needs a rider-then-customer session pair; server authorises per request by user id (no role claim in token), so no client-side role context to go stale');
});
