/**
 * USER-003 — primary user-facing create flow: contest registration.
 *
 * The dashboard's dominant create action is "Apply Now →" → /apply/<slug>
 * (ContestRegistrationWizard → POST/PATCH/GET /api/registration/applications).
 *
 * FIXED (P1): /apply/[slug]/page.js now awaits `params` (Promise under
 * Next 16), so the wizard renders instead of the former notFound(). Only the
 * two dedicated static children (/apply/open-mic-competition,
 * /apply/film-academy redirects) bypass this route.
 *
 * FIXED (P4 contract): step saves go through the strict adapter
 * PATCH /api/registration/applications/:id/step — invalid submissions return
 * 422 with the validation payload instead of the legacy route's silent
 * 200 + validation.isValid:false (legacy route is brownfield-protected and
 * keeps its old contract; wizards and this spec use /step).
 *
 * Asserts:
 *   - UI: /apply/sme-pitch-contest → wizard renders ("Step N of …")
 *   - API: POST draft → row in public.registrations → PATCH step persists →
 *     GET read-back → invalid PATCH → 422 + validation payload → foreign
 *     user GET/PATCH → 403 (BOLA) → unauth → 401
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser, psql } from '../auth/helpers';

const CONTEST_SLUG = 'sme-pitch-contest';

test.describe('USER-003: contest application create/read/update', () => {
  test('apply UI state recorded; API create/update/read cycle + BOLA', async ({
    page,
    context,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'ucreate');
    const other = await provisionVerifiedUser(request, 'ubola');
    const { accessToken } = await loginViaApi(context, request, {
      email: user.email,
      password: user.password,
    });
    const otherLogin = await request.post('/api/auth/login', {
      data: { identifier: other.email, password: other.password },
    });
    const otherToken = (await otherLogin.json()).session.access_token as string;

    await test.step('UI: apply route renders the wizard (params awaited)', async () => {
      const resp = await page.goto(`/apply/${CONTEST_SLUG}`);
      const status = resp?.status() ?? 0;
      const notFound = page.getByText(/this page could not be found/i).waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'not-found' as const).catch(() => null);
      const wizard = page.getByText(/Step \d+ of/i).waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'wizard' as const).catch(() => null);
      const outcome = (await Promise.race([notFound, wizard])) ?? 'neither';
      test.info().annotations.push({
        type: 'apply-ui',
        description: `GET /apply/${CONTEST_SLUG} (authed) → HTTP ${status}, rendered=${outcome}`,
      });
      expect(status).toBe(200);
      expect(outcome).toBe('wizard');
    });

    let draftId = '';
    await test.step('API: create draft (same call the wizard makes on mount)', async () => {
      const res = await request.post('/api/registration/applications', {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { contestSlug: CONTEST_SLUG },
      });
      // 200/201 when the row is inserted; 409 when the UI bootstrap step above
      // already created this user's one live application for the contest —
      // the dedupe response carries it under `registration`.
      expect([200, 201, 409]).toContain(res.status());
      const body = await res.json();
      draftId = body?.draft?.id || body?.registration?.id;
      expect(draftId).toBeTruthy();
      const draft = body.draft || body.registration;
      expect(draft.contestSlug).toBe(CONTEST_SLUG);
      expect(draft.status).toBe('draft');
      if (body.draft) expect(body.draft.userId).toBe(user.userId);
    });

    await test.step('API: update step + read-back + DB row', async () => {
      // The step's required fields must all be present — validateStepData
      // gates persistence (invalid → 422 + validation.isValid=false, nothing
      // written). Name/nationality arrive via account prefill.
      const patch = await request.fetch(`/api/registration/applications/${draftId}/step`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
        data: {
          stepKey: 'personal_information',
          values: {
            'contest.entryMode': 'Individual',
            'personal.dateOfBirth': '1995-05-15',
            'personal.gender': 'Female',
            'personal.stateOfResidence': 'Lagos',
            'personal.city': 'Ikeja',
            'personal.primaryPhone': '+2348012345678',
            'founder.roleInBusiness': 'Founder',
          },
        },
      });
      expect(patch.status()).toBe(200);
      const patchBody = await patch.json();
      expect(patchBody?.draft?.id).toBe(draftId);
      expect(patchBody?.validation?.isValid, JSON.stringify(patchBody?.validation)).not.toBe(false);

      const row = psql(
        `select contest_slug || '|' || status || '|' || coalesce(form_data->>'contest.entryMode','') ` +
          `from public.registrations where id='${draftId}';`,
      );
      expect(row).toBe(`${CONTEST_SLUG}|draft|Individual`);

      const readBack = await request.get(`/api/registration/applications/${draftId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(readBack.status()).toBe(200);
      const readBody = await readBack.json();
      expect(readBody?.draft?.formData?.['contest.entryMode']).toBe('Individual');
      expect(readBody?.draft?.formData?.['personal.city']).toBe('Ikeja');
    });

    await test.step('API: invalid step save → 422 + validation payload, nothing persisted', async () => {
      // Missing required fields for personal_information (e.g. no dateOfBirth/
      // gender/city) — the strict /step route must signal failure via the HTTP
      // status, not a silent 200 + validation.isValid:false.
      const patch = await request.fetch(`/api/registration/applications/${draftId}/step`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
        data: {
          stepKey: 'personal_information',
          values: {
            'personal.dateOfBirth': '',
            'personal.gender': '',
            'personal.stateOfResidence': '',
            'personal.city': '',
            'personal.primaryPhone': '',
          },
        },
      });
      expect(patch.status()).toBe(422);
      const body = await patch.json();
      expect(body?.success).toBe(false);
      expect(body?.validation?.isValid).toBe(false);
      expect(body?.validation?.errors && Object.keys(body.validation.errors).length).toBeGreaterThan(0);

      // The failed save must not have blanked out the persisted values.
      const row = psql(
        `select coalesce(form_data->>'personal.city','') from public.registrations where id='${draftId}';`,
      );
      expect(row).toBe('Ikeja');
    });

    await test.step('BOLA + unauth probes', async () => {
      const foreignRead = await request.get(`/api/registration/applications/${draftId}`, {
        headers: { Authorization: `Bearer ${otherToken}` },
      });
      expect(foreignRead.status()).toBe(403);
      const foreignWrite = await request.fetch(`/api/registration/applications/${draftId}/step`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${otherToken}` },
        data: { stepKey: 'personal_information', values: { 'personal.city': 'Abuja' } },
      });
      expect(foreignWrite.status()).toBe(403);
      // Untouched in DB.
      expect(psql(`select form_data->>'personal.city' from public.registrations where id='${draftId}';`)).toBe('Ikeja');

      expect(
        (await request.post('/api/registration/applications', { data: { contestSlug: CONTEST_SLUG } })).status(),
      ).toBe(401);
      expect((await request.get(`/api/registration/applications/${draftId}`)).status()).toBe(401);
    });
  });
});
