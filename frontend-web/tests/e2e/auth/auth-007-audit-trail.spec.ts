/**
 * Session/audit trail — after real logins, does the system record
 * login-activity / security-event rows that can be attributed to an account?
 *
 * Asserts on public.login_activity (written by AuditService.LogLogin) and
 * public.audit_logs (LogAction) via SQL — the same rows the admin console's
 * /api/admin/login-activity and /api/admin/audit-logs endpoints would render.
 * Fixture users are only READ here; writes land on a user this spec creates.
 */

import { expect, test } from '@playwright/test';
import { GO_BACKEND_URL, provisionVerifiedUser, psql } from './helpers';
import { TEST_USER, loginViaApi } from '../helpers/auth';

test.describe('Session/audit trail', () => {
  test('login_activity rows exist and carry the account identity; audit_logs records register', async ({
    context,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'e2e-audit');

    await test.step('generate auth events', async () => {
      // One failed + one successful login for the provisioned user.
      const bad = await request.post(`${GO_BACKEND_URL}/api/auth/login`, {
        data: { identifier: user.email, password: 'WrongOnPurpose!1' },
      });
      expect(bad.status()).toBe(401);
      await loginViaApi(context, request, user);
    });

    await test.step('login_activity rows are written for both outcomes', async () => {
      const rows = psql(
        `select status || ':' || coalesce(failure_reason,'') from public.login_activity` +
          ` where created_at > now() - interval '5 minutes' order by created_at`,
      );
      test.info().annotations.push({ type: 'login_activity', description: rows });
      expect(rows).toContain('failed:');
      expect(rows).toContain('success');
    });

    await test.step('login_activity rows can be attributed to the account', async () => {
      // The whole point of a login-activity table: which account was attempted.
      const rows = psql(
        `select email, status from public.login_activity where email='${user.email}'` +
          ` order by created_at`,
      );
      console.log('[AUTH audit rows]', JSON.stringify(rows));
      test.info().annotations.push({ type: 'attribution', description: rows });
      // EXPECTED: one 'failed' and one 'success' row keyed to this email.
      expect(rows).toContain(user.email);
    });

    await test.step('register + password events land in audit_logs', async () => {
      const rows = psql(
        `select action || '|' || coalesce(new_values->>'email','') from public.audit_logs` +
          ` where action like 'register.%' order by created_at desc limit 5`,
      );
      test.info().annotations.push({ type: 'audit_logs', description: rows });
      expect(rows).toContain(`register.success|${user.email}`);
    });
  });
});
