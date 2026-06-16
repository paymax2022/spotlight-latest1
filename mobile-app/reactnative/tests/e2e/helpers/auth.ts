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

export async function loginAs(page: Page, user: AnyTestUser = users.funded) {
  await mockAuth(page, user);
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
  await page.goto('/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Explore Services')).toBeVisible();
}
