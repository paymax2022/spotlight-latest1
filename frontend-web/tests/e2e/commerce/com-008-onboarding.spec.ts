/**
 * CMS-008 — merchant onboarding flow: modules → merchant types → form schema →
 * draft → submit (idempotent, fail-closed CAC business gate) → admin review
 * (request-info → resubmit → approve → role/profile grant) → capabilities.
 *
 * The requires_business gate consults business registry (seeded verified via
 * fixture — the real verify path is covered by CMS-005 business spec).
 */

import { expect, test } from '@playwright/test';

import {
  adminFetch,
  goFetch,
  goTrueToken,
  grantAdminPerm,
  idemKey,
  provisionVerifiedUser,
  psql,
} from './helpers';

const SELLER_DATA = {
  store_name: 'E2E Store',
  categories: ['electronics'],
  contact_email: 'seller@e2e.test',
  contact_phone: '08011112222',
};

test.describe('CMS-008 onboarding: draft → submit → review → approve', () => {
  test('full lifecycle incl. business gate + admin request-info loop', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-onb');
    const token = await goTrueToken(request, user.email, user.password);

    // Catalogue reads.
    const modules = await goFetch(request, '/api/v1/onboarding/modules', { token });
    expect(modules.status).toBe(200);
    const types = await goFetch(request, '/api/v1/onboarding/modules/mod-marketplace/merchant-types', { token });
    expect(types.status).toBe(200);
    const mt = await goFetch(request, '/api/v1/onboarding/merchant-types/mt-seller', { token });
    expect(mt.status).toBe(200);
    const schema = await goFetch(request, '/api/v1/onboarding/form-schemas/fs-seller-v1', { token });
    expect(schema.status).toBe(200);
    const caps0 = await goFetch(request, '/api/v1/me/capabilities', { token });
    expect(caps0.status).toBe(200);
    expect(caps0.body?.data?.customer).toBe(true);

    // Create + draft.
    const create = await goFetch(request, '/api/v1/onboarding/applications', {
      method: 'POST',
      token,
      data: { merchantTypeId: 'mt-seller', data: {} },
    });
    expect(create.status).toBe(201);
    const appId = create.body?.data?.id;
    expect(appId).toBeTruthy();

    const draft = await goFetch(request, `/api/v1/onboarding/applications/${appId}`, {
      method: 'PATCH',
      token,
      data: { data: SELLER_DATA },
    });
    expect(draft.status).toBe(200);

    // Submit requires Idempotency-Key.
    const noKey = await goFetch(request, `/api/v1/onboarding/applications/${appId}/submit`, {
      method: 'POST',
      token,
    });
    expect(noKey.status).toBe(400);

    // mt-seller has requires_business → fail-closed CAC gate (no verified business yet).
    const gated = await goFetch(request, `/api/v1/onboarding/applications/${appId}/submit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('onb') },
      data: {},
    });
    expect([400, 422]).toContain(gated.status);

    // Grant a verified CAC business (fixture — real verify flow covered in CMS-005).
    psql(
      `insert into public.business_profiles (user_id, mode, status, legal_name) ` +
        `values ('${user.userId}','register_new','verified','E2E Verified Biz ${Date.now()}');`,
    );
    const submit = await goFetch(request, `/api/v1/onboarding/applications/${appId}/submit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('onb') },
      data: {},
    });
    expect(submit.status).toBe(200);
    expect(['SUBMITTED', 'UNDER_REVIEW']).toContain(submit.body?.data?.status);

    // Owner read; stranger read → 403.
    const own = await goFetch(request, `/api/v1/onboarding/applications/${appId}`, { token });
    expect(own.status).toBe(200);
    const stranger = await provisionVerifiedUser(request, 'cms-str');
    const sToken = await goTrueToken(request, stranger.email, stranger.password);
    const stolen = await goFetch(request, `/api/v1/onboarding/applications/${appId}`, { token: sToken });
    expect(stolen.status).toBe(403);

    // Admin review loop (onboarding.review is seeded on Super Admin already).
    grantAdminPerm('onboarding.review');
    const queue = await adminFetch(request, '/api/admin/onboarding/review-queue');
    expect(queue.status).toBe(200);
    const adminGet = await adminFetch(request, `/api/admin/onboarding/applications/${appId}`);
    expect(adminGet.status).toBe(200);

    const needInfo = await adminFetch(request, `/api/admin/onboarding/applications/${appId}/request-info`, {
      method: 'POST',
      data: { checklist: ['resubmit-cac-doc'] },
    });
    expect(needInfo.status).toBe(200);

    // Member resubmit NEEDS_MORE_INFO → UNDER_REVIEW.
    const resub = await goFetch(request, `/api/v1/onboarding/applications/${appId}/resubmit`, {
      method: 'POST',
      token,
    });
    expect(resub.status).toBe(200);
    expect(resub.body?.data?.status).toBe('UNDER_REVIEW');

    // Approve → APPROVED + merchant profile + capabilities reflect the grant.
    const approve = await adminFetch(request, `/api/admin/onboarding/applications/${appId}/approve`, {
      method: 'POST',
      data: {},
    });
    expect(approve.status).toBe(200);
    expect(approve.body?.data?.status).toBe('APPROVED');
    // Idempotent retry → still 200 APPROVED.
    const approve2 = await adminFetch(request, `/api/admin/onboarding/applications/${appId}/approve`, {
      method: 'POST',
      data: {},
    });
    expect(approve2.status).toBe(200);

    const caps = await goFetch(request, '/api/v1/me/capabilities', { token });
    expect(caps.status).toBe(200);
    expect((caps.body?.data?.merchants ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test('reject path + nonexistent records', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'cms-rej');
    const token = await goTrueToken(request, user.email, user.password);
    psql(
      `insert into public.business_profiles (user_id, mode, status, legal_name) ` +
        `values ('${user.userId}','register_new','verified','E2E Rej Biz ${Date.now()}');`,
    );
    const create = await goFetch(request, '/api/v1/onboarding/applications', {
      method: 'POST',
      token,
      data: { merchantTypeId: 'mt-seller', data: SELLER_DATA },
    });
    expect(create.status).toBe(201);
    const appId = create.body?.data?.id;
    const submit = await goFetch(request, `/api/v1/onboarding/applications/${appId}/submit`, {
      method: 'POST',
      token,
      headers: { 'Idempotency-Key': idemKey('onb') },
      data: {},
    });
    expect(submit.status).toBe(200);

    grantAdminPerm('onboarding.review');
    const reject = await adminFetch(request, `/api/admin/onboarding/applications/${appId}/reject`, {
      method: 'POST',
      data: { reason: 'e2e insufficient docs' },
    });
    expect(reject.status).toBe(200);
    expect(reject.body?.data?.status).toBe('REJECTED');
    // REJECTED is terminal for review actions.
    const approveAfterReject = await adminFetch(request, `/api/admin/onboarding/applications/${appId}/approve`, {
      method: 'POST',
      data: {},
    });
    expect([400, 409]).toContain(approveAfterReject.status);

    const ghost = await adminFetch(request, '/api/admin/onboarding/applications/00000000-0000-0000-0000-000000000000');
    expect(ghost.status).toBe(404);
    const escalate = await adminFetch(request, `/api/admin/onboarding/applications/${appId}/escalate`, {
      method: 'POST',
      data: { note: 'e2e' },
    });
    expect([200, 409]).toContain(escalate.status);
  });
});
