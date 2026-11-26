import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getRegistrationDraft: vi.fn(),
  replaceRegistrationProfilePhoto: vi.fn(),
  hasR2Config: vi.fn(),
  assertR2ObjectExists: vi.fn(),
  statLocalUpload: vi.fn(),
}));

vi.mock('@/src/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/src/server/registration/supabase-store', () => ({
  getRegistrationDraft: mocks.getRegistrationDraft,
  replaceRegistrationProfilePhoto: mocks.replaceRegistrationProfilePhoto,
}));
vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: mocks.hasR2Config,
  assertR2ObjectExists: mocks.assertR2ObjectExists,
}));
vi.mock('@/src/lib/storage/local-uploads', () => ({
  statLocalUpload: mocks.statLocalUpload,
}));

import { POST } from '@/app/api/registration/applications/[id]/profile-photo/route';

const userId = '6c6d04cd-5635-4b94-acd1-b5378b8a2975';
const applicationId = '8977dc4a-630c-4658-9967-120dfbad1e44';
const storageKey = `registration/${userId}/9c90d2d5-2a8a-4773-8c7e-76061b292e6b.jpg`;

function request(body: unknown) {
  return new Request(`https://example.test/api/registration/applications/${applicationId}/profile-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'profile-photo-test-1' },
    body: JSON.stringify(body),
  });
}

function call(body: unknown) {
  return POST(request(body), { params: Promise.resolve({ id: applicationId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ user: { id: userId } });
  mocks.getRegistrationDraft.mockResolvedValue({
    id: applicationId,
    userId,
    status: 'approved',
  });
  mocks.hasR2Config.mockReturnValue(false);
  mocks.statLocalUpload.mockResolvedValue({ sizeBytes: 123 });
  mocks.replaceRegistrationProfilePhoto.mockImplementation(async ({ photo }) => ({ photo }));
});

describe('POST /api/registration/applications/{id}/profile-photo', () => {
  it('updates only the owner’s approved application with a stored image upload', async () => {
    const response = await call({ storageKey });

    expect(response.status).toBe(200);
    expect(mocks.statLocalUpload).toHaveBeenCalledWith(storageKey);
    expect(mocks.replaceRegistrationProfilePhoto).toHaveBeenCalledWith({
      applicationId,
      userId,
      photo: {
        previewUrl: `/api/registration/uploads/${Buffer.from(storageKey).toString('base64url')}`,
        fileName: '9c90d2d5-2a8a-4773-8c7e-76061b292e6b.jpg',
        storageKey,
      },
    });
  });

  it('rejects uploads owned by another user', async () => {
    const response = await call({
      storageKey: 'registration/11111111-1111-4111-8111-111111111111/9c90d2d5-2a8a-4773-8c7e-76061b292e6b.jpg',
    });

    expect(response.status).toBe(400);
    expect(mocks.statLocalUpload).not.toHaveBeenCalled();
    expect(mocks.replaceRegistrationProfilePhoto).not.toHaveBeenCalled();
  });

  it('rejects a request without a storage key', async () => {
    const response = await call(null);

    expect(response.status).toBe(400);
    expect(mocks.statLocalUpload).not.toHaveBeenCalled();
    expect(mocks.replaceRegistrationProfilePhoto).not.toHaveBeenCalled();
  });

  it('requires an idempotency key', async () => {
    const response = await POST(
      new Request(`https://example.test/api/registration/applications/${applicationId}/profile-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageKey }),
      }),
      { params: Promise.resolve({ id: applicationId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.getRegistrationDraft).not.toHaveBeenCalled();
  });

  it('rejects replacement when the uploaded image is missing', async () => {
    mocks.statLocalUpload.mockResolvedValue(null);

    const response = await call({ storageKey });

    expect(response.status).toBe(404);
    expect(mocks.replaceRegistrationProfilePhoto).not.toHaveBeenCalled();
  });

  it('does not allow replacing photos on an editable, unapproved application', async () => {
    mocks.getRegistrationDraft.mockResolvedValue({
      id: applicationId,
      userId,
      status: 'draft',
    });

    const response = await call({ storageKey });

    expect(response.status).toBe(409);
    expect(mocks.statLocalUpload).not.toHaveBeenCalled();
    expect(mocks.replaceRegistrationProfilePhoto).not.toHaveBeenCalled();
  });
});
