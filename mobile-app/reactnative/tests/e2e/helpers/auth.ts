import { expect, Page } from '@playwright/test';
import { users } from './testData';

type TestUser = typeof users.funded;
type AnyTestUser = (typeof users)[keyof typeof users];

function supabaseAuthUser(user: AnyTestUser) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    user_metadata: {
      full_name: user.fullName,
      fullName: user.fullName,
      phone: user.phone,
    },
    app_metadata: {},
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
  };
}

// ── Transaction-PIN gate ─────────────────────────────────────────────────────
// AuthGate in app/_layout.tsx parks EVERY signed-in user on /security/set-pin
// until getPinStatus() reports a PIN. Two paths have to be satisfied because
// transfers defaults to mock mode (EXPO_PUBLIC_TRANSFERS_USE_MOCK unset/'true'):
//   • mock  — getPinStatus() reads MOCK_PIN, seeded from localStorage at module
//     load (src/features/transfers/mock.ts). No network call happens, so seeding
//     the key via addInitScript is what actually clears the gate.
//   • live  — GET /api/v1/transfers/pin/status, covered by the route mock.
// Seeding both keeps the helper correct whichever way the flag is set.
const MOCK_TXN_PIN_KEY = 'paymax_mock_txn_pin';

/** The 4-digit PIN seeded for signed-in test users. */
export const TEST_TXN_PIN = '1234';

/**
 * Control whether the signed-in user already has a transaction PIN.
 * `hasPin: false` deliberately leaves the gate closed so a test can exercise
 * the set-PIN flow itself.
 */
export async function mockPinStatus(page: Page, hasPin: boolean) {
  await page.route('**/api/v1/transfers/pin/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hasPin }),
    });
  });
  await page.addInitScript(({ key, pin }) => {
    if (pin === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, pin);
  }, { key: MOCK_TXN_PIN_KEY, pin: hasPin ? TEST_TXN_PIN : null });
}

export async function mockAuth(page: Page, user: AnyTestUser = users.funded) {
  const authUser = supabaseAuthUser(user);

  await page.route('**/auth/v1/token**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: user.accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: `${user.accessToken}-refresh`,
        user: authUser,
      }),
    });
  });

  await page.route('**/auth/v1/user', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(authUser),
    });
  });

  await page.route('**/rest/v1/user_profiles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: user.id,
        full_name: user.fullName,
        email: user.email,
        phone: user.phone,
        kyc_status: 'verified',
      }),
    });
  });
}

/**
 * Pre-seed a live Supabase session into the app's storage so the next
 * navigation starts signed in. The key is the secure-storage adapter's prefix
 * plus Supabase's default key for the 127.0.0.1 host — seeding anything else
 * leaves the app signed out.
 */
export async function seedSession(page: Page, user: AnyTestUser = users.funded) {
  await page.addInitScript(({ seededUser }) => {
    const authUser = {
      id: seededUser.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: seededUser.email,
      user_metadata: {
        full_name: seededUser.fullName,
        fullName: seededUser.fullName,
        phone: seededUser.phone,
      },
      app_metadata: {},
      created_at: '2026-06-14T00:00:00.000Z',
      updated_at: '2026-06-14T00:00:00.000Z',
    };
    const session = {
      access_token: seededUser.accessToken,
      refresh_token: `${seededUser.accessToken}-refresh`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: authUser,
    };
    window.localStorage.setItem('paymax_secure_sb-127-auth-token', JSON.stringify(session));
  }, { seededUser: user });
}

export async function loginAs(
  page: Page,
  user: AnyTestUser = users.funded,
  opts: { withPin?: boolean } = {},
) {
  // Default to a user who already has a PIN — the gate is not what these tests
  // are about. Pass withPin:false to land on the set-PIN screen instead.
  const withPin = opts.withPin ?? true;
  await mockAuth(page, user);
  await mockPinStatus(page, withPin);
  await seedSession(page, user);
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  // Without a PIN the gate redirects to /security/set-pin, so home never renders.
  if (withPin) await expect(page.getByText('Explore Services')).toBeVisible();
}
