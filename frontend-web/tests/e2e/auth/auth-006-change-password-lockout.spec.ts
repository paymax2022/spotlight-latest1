/**
 * AUD-BE-005 re-verify — POST /api/auth/change-password must actually change
 * the password (prior P0: it returned success without changing anything).
 * There is no change-password UI in frontend-web, so the Go endpoint is driven
 * directly — the missing UI is itself recorded as a finding.
 *
 * AUD-BE-009 re-verify — lockout self-destruct (prior P0): after
 * AUTH_MAX_FAILED_LOGIN_ATTEMPTS (5) failures an account locks for 30 min;
 * the old bug left status='locked' forever once locked_until expired. Tested
 * ONLY on a user this spec provisions — fixture accounts are never touched —
 * and the account is restored via SQL afterwards regardless of outcome.
 */

import { expect, test } from '@playwright/test';
import { GO_BACKEND_URL, provisionVerifiedUser, psql } from './helpers';
import { loginViaApi } from '../helpers/auth';

const NEW_PASSWORD = 'E2eChanged!55';

async function apiLogin(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  password: string,
) {
  const res = await request.post(`${GO_BACKEND_URL}/api/auth/login`, {
    data: { identifier: email, password },
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status(), body };
}

function platformUserState(email: string) {
  const row = psql(
    `select status || '|' || failed_login_attempts || '|' || coalesce(locked_until::text,'null')` +
      ` from public.platform_users where email='${email}'`,
  );
  const [status, attempts, lockedUntil] = row.split('|');
  return { status, attempts: Number(attempts), lockedUntil };
}

test.describe('AUD-BE-005 re-verify: change-password', () => {
  test('change-password verifies the old password and really rotates it', async ({
    context,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'e2e-chpw');
    const { accessToken } = await loginViaApi(context, request, user);

    await test.step('wrong current password is refused', async () => {
      const res = await request.post(`${GO_BACKEND_URL}/api/auth/change-password`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { currentPassword: 'WrongCurrent!1', newPassword: NEW_PASSWORD },
      });
      test.info().annotations.push({ type: 'wrong-current', description: `${res.status()}` });
      expect(res.status()).toBe(400);
    });

    await test.step('correct current password rotates the credential', async () => {
      const res = await request.post(`${GO_BACKEND_URL}/api/auth/change-password`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { currentPassword: user.password, newPassword: NEW_PASSWORD },
      });
      const body = await res.json().catch(() => null);
      test.info().annotations.push({
        type: 'change',
        description: `${res.status()} ${JSON.stringify(body)}`,
      });
      expect(res.status()).toBe(200);
    });

    await test.step('new password signs in, old password fails', async () => {
      const oldLogin = await apiLogin(request, user.email, user.password);
      expect(oldLogin.status).toBe(401);
      const newLogin = await apiLogin(request, user.email, NEW_PASSWORD);
      expect(newLogin.status).toBe(200);
    });
  });
});

test.describe('AUD-BE-009 re-verify: lockout self-destruct', () => {
  test('expired auto-lockout unlatches on the next good login', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'e2e-lock');
    const userEmail = user.email;

    try {
      await test.step('five bad passwords lock the account', async () => {
        for (let i = 0; i < 5; i += 1) {
          const res = await apiLogin(request, userEmail, 'TotallyWrong!1');
          expect(res.status).toBe(401);
        }
        const state = platformUserState(userEmail);
        test.info().annotations.push({ type: 'locked-state', description: JSON.stringify(state) });
        expect(state.status).toBe('locked');
        expect(state.attempts).toBeGreaterThanOrEqual(5);
      });

      await test.step('correct password while the lock is live is refused', async () => {
        const res = await apiLogin(request, userEmail, user.password);
        expect([401, 403]).toContain(res.status);
      });

      await test.step('after the lock expires, a good login unlatches status', async () => {
        // Simulate elapsed time rather than sleeping 30 minutes — the lock is
        // an auto-lockout (locked_until set), exactly the AUD-BE-009 case.
        psql(
          `update public.platform_users set locked_until = now() - interval '1 minute'` +
            ` where email='${userEmail}'`,
        );
        const res = await apiLogin(request, userEmail, user.password);
        test.info().annotations.push({
          type: 'post-expiry-login',
          description: `status=${res.status} body=${JSON.stringify(res.body)?.slice(0, 160)}`,
        });
        expect(res.status).toBe(200);
        const state = platformUserState(userEmail);
        test.info().annotations.push({ type: 'final-state', description: JSON.stringify(state) });
        // The AUD-BE-009 latch: status must be reset to active, not left locked.
        expect(state.status).toBe('active');
      });
    } finally {
      // Leave no locked/flagged account behind, whatever happened above.
      psql(
        `update public.platform_users set status='active', failed_login_attempts=0,` +
          ` locked_until=null where email='${userEmail}'`,
      );
    }
  });
});
