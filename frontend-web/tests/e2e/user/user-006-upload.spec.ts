/**
 * USER-006 — user-facing upload.
 *
 * Surfaces found: POST /api/registration/uploads (wizard media step) and
 * POST /api/crowdfunding/uploads (campaign cover). Both pick R2 presigned-PUT
 * when hasR2Config() is true. FIXED (E2E-USER-015): .env.local no longer sets
 * the fake `local-dev` R2_* vars, so hasR2Config() is false locally and the
 * saveLocalUpload fallback persists files under $TMPDIR/
 * spotlight-registration-uploads.
 *
 * This spec exercises the real endpoint with a real file: asserts the upload
 * succeeds (200 + upload payload) and the returned previewUrl retrieves the
 * stored asset.
 */

import { expect, test } from '@playwright/test';
import { loginViaApi } from '../helpers/auth';
import { provisionVerifiedUser } from '../auth/helpers';

// Smallest valid PNG (1x1 transparent).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('USER-006: file upload', () => {
  test('registration upload + crowdfunding cover upload with real file', async ({
    context,
    request,
  }) => {
    const user = await provisionVerifiedUser(request, 'uupload');
    const { accessToken } = await loginViaApi(context, request, {
      email: user.email,
      password: user.password,
    });
    const auth = { Authorization: `Bearer ${accessToken}` };

    const reg = await request.post('/api/registration/uploads', {
      headers: auth,
      multipart: { file: { name: 'e2e-id.png', mimeType: 'image/png', buffer: PNG } },
    });
    const regBody = await reg.json().catch(() => null);
    test.info().annotations.push({
      type: 'registration-upload',
      description: `POST /api/registration/uploads → ${reg.status()} ${JSON.stringify(regBody)}`,
    });

    const cf = await request.post('/api/crowdfunding/uploads', {
      headers: auth,
      multipart: { file: { name: 'e2e-cover.png', mimeType: 'image/png', buffer: PNG } },
    });
    const cfBody = await cf.json().catch(() => null);
    test.info().annotations.push({
      type: 'crowdfunding-upload',
      description: `POST /api/crowdfunding/uploads → ${cf.status()} ${JSON.stringify(cfBody)}`,
    });

    // Uploads must actually succeed now — 200 + an upload payload naming a
    // retrievable asset, not the former 500 "Upload failed: fetch failed".
    for (const [res, body] of [[reg, regBody], [cf, cfBody]] as const) {
      expect(res.status()).toBe(200);
      expect(body?.success).toBe(true);
      expect(body?.upload).toBeTruthy();
    }

    // The stored asset must be retrievable through the stable preview route.
    if (regBody?.upload?.previewUrl) {
      const preview = await request.get(regBody.upload.previewUrl, { headers: auth });
      test.info().annotations.push({
        type: 'registration-upload-preview',
        description: `GET ${regBody.upload.previewUrl} → ${preview.status()}`,
      });
      expect(preview.status()).toBe(200);
    }

    // Unauthenticated → 401 on both surfaces.
    expect(
      (
        await request.post('/api/registration/uploads', {
          multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: PNG } },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post('/api/crowdfunding/uploads', {
          multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: PNG } },
        })
      ).status(),
    ).toBe(401);
  });
});
