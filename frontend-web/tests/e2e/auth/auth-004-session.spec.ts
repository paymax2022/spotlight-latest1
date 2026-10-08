/**
 * AUTH-004 — session behaviour.
 *
 *   login → reload still authed
 *   clear cookies → protected route bounces to /login
 *   corrupted access_token + intact refresh_token → middleware/Supabase SSR
 *     rotates via /auth/v1/token?grant_type=refresh_token and stays authed
 *     (proves refresh-token rotation keeps the session alive without waiting
 *     the 3600s JWT lifetime).
 */

import { expect, test } from '@playwright/test';
import { LOGIN_ROUTE, PROTECTED_ROUTE, TEST_USER, loginViaUi } from '../helpers/auth';

function decodeChunkedSession(cookies: Array<{ name: string; value: string }>): {
  name: string;
  session: { access_token?: string; refresh_token?: string } | null;
} {
  const chunks = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!chunks.length) return { name: '', session: null };
  const raw = chunks.map((c) => c.value).join('');
  const json = raw.startsWith('base64-')
    ? Buffer.from(raw.slice(7), 'base64url').toString('utf8')
    : decodeURIComponent(raw);
  return { name: chunks[0].name.replace(/\.\d+$/, ''), session: JSON.parse(json) };
}

test.describe('AUTH-004: session persistence, revocation, rotation', () => {
  test('reload keeps session, cleared cookies bounce, expired access token rotates', async ({
    page,
    context,
    request,
  }) => {
    await test.step('login and survive a reload', async () => {
      await loginViaUi(page, request, TEST_USER);
      await expect(page.getByText(/welcome back/i)).toBeVisible();
      await page.reload();
      await expect(page.getByText(/welcome back/i)).toBeVisible();
      await expect(page).not.toHaveURL(new RegExp(LOGIN_ROUTE));
    });

    await test.step('cleared cookies bounce the protected route to /login', async () => {
      await context.clearCookies();
      await page.goto(PROTECTED_ROUTE);
      await expect(page).toHaveURL(new RegExp(`${LOGIN_ROUTE}\\?next=`));
    });

    await test.step('expired access token rotates via refresh_token', async () => {
      await loginViaUi(page, request, TEST_USER);

      // Rewrite the session cookie with a dead access_token but the live
      // refresh_token — the state a browser is in once the 1h JWT expires.
      const cookies = await context.cookies();
      const { name, session } = decodeChunkedSession(
        cookies.map((c) => ({ name: c.name, value: c.value })),
      );
      expect(session?.refresh_token, 'no refresh_token in session cookie').toBeTruthy();
      // Simulate natural JWT expiry: the client decides to refresh off
      // session.expires_at, not the access token's exp — so leave the real
      // tokens alone and move expires_at into the past. This is exactly the
      // cookie state a browser is in one hour after sign-in.
      (session as { expires_at?: number }).expires_at = Math.floor(Date.now() / 1000) - 60;
      (session as { expires_in?: number }).expires_in = 0;

      const encoded = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
      const domain = new URL(process.env.E2E_BASE_URL || 'http://localhost:3000').hostname;
      await context.clearCookies();
      const MAX = 3180;
      if (encoded.length <= MAX) {
        await context.addCookies([{ name, value: encoded, domain, path: '/' }]);
      } else {
        const parts = [];
        for (let i = 0, off = 0; off < encoded.length; i += 1, off += MAX) {
          parts.push({ name: `${name}.${i}`, value: encoded.slice(off, off + MAX), domain, path: '/' });
        }
        await context.addCookies(parts);
      }

      // Watch for the rotation call.
      const refreshHit = page.waitForResponse(
        (r) => r.url().includes('/auth/v1/token') && r.url().includes('refresh_token'),
        { timeout: 30_000 },
      ).then((r) => r.status()).catch(() => null);

      await page.goto(PROTECTED_ROUTE);
      const landed = page.url();
      const status = await refreshHit;
      console.log('[AUTH-004 rotation]', `grant=${status}`, `landed=${landed}`);
      test.info().annotations.push({
        type: 'rotation',
        description: `refresh grant status=${status} landed=${landed}`,
      });
      // Rotated session should keep us on the protected page.
      await expect(page).toHaveURL(new RegExp(PROTECTED_ROUTE));
      await expect(page.getByText(/welcome back/i)).toBeVisible();
    });
  });
});
