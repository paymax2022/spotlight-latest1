/**
 * Golden-path suite: contest registration flow
 *   POST /api/registration/applications         — create draft
 *   POST /api/registration/applications/[id]/submit — submit draft
 *
 * The routes read the Supabase-backed registration store (supabase-store);
 * its functions are mocked so tests stay isolated and fast — no database.
 * Auth (requireUser) is mocked to control auth outcomes.
 *
 * Protected sources:
 *   frontend-web/app/api/registration/applications/route.ts         (DO NOT EDIT)
 *   frontend-web/app/api/registration/applications/[id]/submit/route.ts (DO NOT EDIT)
 *   frontend-web/src/server/registration/store.ts                   (DO NOT EDIT)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from './_fixtures';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

vi.mock('@/src/lib/auth/server', () => ({
  requireUser: vi.fn(),
}));

vi.mock('@/src/server/registration/supabase-store', () => ({
  listRegistrationApplications: vi.fn().mockReturnValue([]),
  startRegistrationDraft: vi.fn(),
  getRegistrationDraft: vi.fn(),
  submitRegistrationApplication: vi.fn(),
  applyAccountPrefill: vi.fn(),
}));

// The route seeds each draft from the applicant's account so no contest form
// asks for details they gave at sign-up. Mocked so these tests stay offline.
vi.mock('@/src/server/user/profile', () => ({
  getOrCreateUserProfile: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { POST as createPost, GET as listGet } from '../../../app/api/registration/applications/route';
import { POST as submitPost } from '../../../app/api/registration/applications/[id]/submit/route';
import { requireUser } from '@/src/lib/auth/server';
import {
  startRegistrationDraft,
  getRegistrationDraft,
  submitRegistrationApplication,
  listRegistrationApplications,
} from '@/src/server/registration/supabase-store';
import { getOrCreateUserProfile } from '@/src/server/user/profile';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_USER = { id: 'user-001', email: 'applicant@example.com', role: 'public_user' };

function authAsTestUser() {
  vi.mocked(requireUser).mockResolvedValue({ user: TEST_USER } as any);
  // Default: an account that knows only the email it was created with.
  vi.mocked(getOrCreateUserProfile).mockResolvedValue({
    id: TEST_USER.id,
    email: TEST_USER.email,
    role: 'USER',
    profileTypes: ['general_applicant'],
  } as any);
}

function authUnauthorized() {
  vi.mocked(requireUser).mockRejectedValue(new Error('UNAUTHORIZED'));
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-id-001',
    reference: 'REALIT-123456-ABCD',
    contestSlug: 'reality-tv-show',
    status: 'draft',
    role: 'public_user',
    userId: TEST_USER.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    formData: {},
    completionPercent: 0,
    currentStep: 'account_gate',
    fraudFlags: [],
    ...overrides,
  };
}

// ── Tests: create draft ───────────────────────────────────────────────────────

describe('POST /api/registration/applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsTestUser();
  });

  it('should create a registration draft for a valid contest', async () => {
    const draft = makeDraft();
    vi.mocked(startRegistrationDraft).mockReturnValue(draft as any);

    const res = await createPost(
      makeRequest('/api/registration/applications', {
        body: { contestSlug: 'reality-tv-show' },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.draft.id).toBe('draft-id-001');
    expect(body.draft.contestSlug).toBe('reality-tv-show');
    expect(body.draft.status).toBe('draft');
    expect(vi.mocked(startRegistrationDraft)).toHaveBeenCalledWith({
      contestSlug: 'reality-tv-show',
      userId: TEST_USER.id,
      // The route folds the app role set onto the DB-constrained store set
      // (registrations.role CHECK) — unset roles become 'public_user'.
      role: 'public_user',
      accountData: undefined,
      // Seeded from the account, not from the request — see account-prefill.
      accountPrefill: {
        values: { 'account.email': TEST_USER.email, 'personal.email': TEST_USER.email },
        providedKeys: ['account.email', 'personal.email'],
      },
    });
  });

  it('seeds the draft with the name and phone already on the account', async () => {
    vi.mocked(getOrCreateUserProfile).mockResolvedValue({
      id: TEST_USER.id,
      email: TEST_USER.email,
      role: 'USER',
      displayName: 'Ada Okafor',
      phone: '08012345678',
      profileTypes: ['general_applicant'],
    } as any);
    vi.mocked(startRegistrationDraft).mockReturnValue(makeDraft() as any);

    const res = await createPost(
      makeRequest('/api/registration/applications', {
        body: { contestSlug: 'reality-tv-show' },
      }),
    );

    expect(res.status).toBe(201);
    const call = vi.mocked(startRegistrationDraft).mock.calls[0][0] as {
      accountPrefill?: { values: Record<string, unknown>; providedKeys: string[] };
    };
    expect(call.accountPrefill?.values).toMatchObject({
      'personal.firstName': 'Ada',
      'personal.lastName': 'Okafor',
      'personal.primaryPhone': '08012345678',
    });
  });

  it('still creates the draft when the account profile cannot be read', async () => {
    vi.mocked(getOrCreateUserProfile).mockRejectedValue(new Error('profile store down'));
    vi.mocked(startRegistrationDraft).mockReturnValue(makeDraft() as any);

    const res = await createPost(
      makeRequest('/api/registration/applications', {
        body: { contestSlug: 'reality-tv-show' },
      }),
    );

    // Prefill is a convenience; losing it must never block an application.
    expect(res.status).toBe(201);
    expect(vi.mocked(startRegistrationDraft)).toHaveBeenCalledWith(
      expect.objectContaining({ accountPrefill: undefined }),
    );
  });

  it('should return 400 when contestSlug is missing', async () => {
    const res = await createPost(
      makeRequest('/api/registration/applications', { body: {} }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/contestSlug/i);
  });

  it('should return 401 when user is not authenticated', async () => {
    authUnauthorized();

    const res = await createPost(
      makeRequest('/api/registration/applications', {
        body: { contestSlug: 'reality-tv-show' },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});

// ── Tests: GET list ───────────────────────────────────────────────────────────

describe('GET /api/registration/applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsTestUser();
  });

  it('should return applications belonging to the authenticated user', async () => {
    const draft = makeDraft();
    vi.mocked(listRegistrationApplications).mockReturnValue([draft] as any);

    const res = await listGet(
      new Request('http://localhost/api/registration/applications', { method: 'GET' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Only drafts owned by the current user are returned
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].userId).toBe(TEST_USER.id);
  });
});

// ── Tests: submit draft ───────────────────────────────────────────────────────

describe('POST /api/registration/applications/[id]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsTestUser();
  });

  it('should submit a draft and return a reference number', async () => {
    const draft = makeDraft({ status: 'submitted' });
    vi.mocked(getRegistrationDraft).mockReturnValue(draft as any);
    vi.mocked(submitRegistrationApplication).mockReturnValue({
      success: true,
      draft,
    } as any);

    const res = await submitPost(
      makeRequest('/api/registration/applications/draft-id-001/submit', {}),
      { params: Promise.resolve({ id: 'draft-id-001' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.draft.reference).toBe('REALIT-123456-ABCD');
    expect(body.message).toMatch(/REALIT-123456-ABCD/);
  });

  it('should return 404 when the draft does not exist', async () => {
    vi.mocked(getRegistrationDraft).mockResolvedValue(null);

    const res = await submitPost(
      makeRequest('/api/registration/applications/unknown-id/submit', {}),
      { params: Promise.resolve({ id: 'unknown-id' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it('should return 403 when the draft belongs to a different user', async () => {
    const otherUserDraft = makeDraft({ userId: 'different-user-999' });
    vi.mocked(getRegistrationDraft).mockReturnValue(otherUserDraft as any);

    const res = await submitPost(
      makeRequest('/api/registration/applications/draft-id-001/submit', {}),
      { params: Promise.resolve({ id: 'draft-id-001' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/forbidden/i);
  });

  it('should return 401 when user is not authenticated', async () => {
    authUnauthorized();

    const res = await submitPost(
      makeRequest('/api/registration/applications/draft-id-001/submit', {}),
      { params: Promise.resolve({ id: 'draft-id-001' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('should return 400 when validation fails on submit', async () => {
    const draft = makeDraft(); // draft status, no formData filled
    vi.mocked(getRegistrationDraft).mockReturnValue(draft as any);
    vi.mocked(submitRegistrationApplication).mockReturnValue({
      success: false,
      validationErrors: { 'personal.fullName': 'Required' },
      draft,
    } as any);

    const res = await submitPost(
      makeRequest('/api/registration/applications/draft-id-001/submit', {}),
      { params: Promise.resolve({ id: 'draft-id-001' }) },
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/validation failed/i);
  });
});
