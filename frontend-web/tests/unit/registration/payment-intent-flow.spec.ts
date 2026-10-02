/**
 * AUD-FE-003 residual — contest/reality-TV registration fees must flow
 * through the server-side payment-intent endpoints, not a client-minted
 * reference + self-declared 'paid' PATCH.
 *
 * These specs pin the pieces the wizards now rely on:
 *
 *   POST …/payment/initiate
 *     - requires Idempotency-Key (400 without it);
 *     - rejects when the draft carries no outstanding fee (400);
 *     - mints an SPT-REG-* reference, initializes Paystack SERVER-side and
 *       returns the authorization URL + the access code the popup needs to
 *       RESUME that same transaction (resumeTransaction — passing the
 *       reference to newTransaction is a duplicate-reference error);
 *     - replays an existing intent for a repeated Idempotency-Key;
 *     - short-circuits to 'completed' when the application already paid —
 *       the wizard must skip checkout entirely on that response.
 *
 *   src/lib/payments/registration-fee (client helper)
 *     - sends a fresh crypto.randomUUID Idempotency-Key per attempt;
 *     - maps 'completed' → 'paid' (no checkout), initiated → 'checkout',
 *       401 → 'unauthorized', errors → 'error';
 *     - confirmRegistrationPayment polls verify until a terminal status and
 *       never fabricates success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── route-level mocks ──────────────────────────────────────────────────── */

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}));

const requireUserMock = vi.fn();
const checkRateLimitMock = vi.fn(() => ({ allowed: true }));
const initializePaystackMock = vi.fn();
const resolveReturnOriginMock = vi.fn(() => null);
const getRegistrationDraftMock = vi.fn();
const findByIdempotencyKeyMock = vi.fn();
const getByAppAndMethodMock = vi.fn();
const createIntentMock = vi.fn();
const retryIntentMock = vi.fn();

vi.mock('@/src/lib/auth/server', () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));
vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: () => checkRateLimitMock(),
}));
vi.mock('@/src/server/voting/payment/paystack', () => ({
  initializePaystackPayment: (...args: unknown[]) => initializePaystackMock(...args),
}));
vi.mock('@/src/server/registration/return-origin', () => ({
  resolveReturnOrigin: () => resolveReturnOriginMock(),
  isReturnableOrigin: () => false,
  buildWebReturnUrl: () => '',
}));
vi.mock('@/src/server/registration/supabase-store', () => ({
  getRegistrationDraft: (...args: unknown[]) => getRegistrationDraftMock(...args),
  findRegistrationPaymentIntentByIdempotencyKey: (...args: unknown[]) =>
    findByIdempotencyKeyMock(...args),
  getRegistrationPaymentIntentByApplicationAndMethod: (...args: unknown[]) =>
    getByAppAndMethodMock(...args),
  createRegistrationPaymentIntent: (...args: unknown[]) => createIntentMock(...args),
  retryRegistrationPaymentIntent: (...args: unknown[]) => retryIntentMock(...args),
}));

import { POST as initiatePayment } from '../../../app/api/registration/applications/[id]/payment/initiate/route';

const USER = { id: 'user-1', email: 'applicant@example.com' };
const APP_ID = 'app-uuid-1';

function paidDraft() {
  return {
    id: APP_ID,
    userId: USER.id,
    contestSlug: 'reality-tv-show',
    status: 'draft',
    formData: { 'payment.feeAmount': 5000, 'payment.paymentStatus': 'pending' },
  };
}

function initiateRequest(key?: string) {
  return new Request(`http://localhost/api/registration/applications/${APP_ID}/payment/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify({ method: 'PAYSTACK', email: USER.email }),
  });
}

const ctx = { params: Promise.resolve({ id: APP_ID }) };

describe('POST registration payment/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: USER });
    checkRateLimitMock.mockReturnValue({ allowed: true });
    getRegistrationDraftMock.mockResolvedValue(paidDraft());
    findByIdempotencyKeyMock.mockResolvedValue(null);
    getByAppAndMethodMock.mockResolvedValue(null);
    initializePaystackMock.mockResolvedValue('https://checkout.paystack.com/accesscode123abc');
    createIntentMock.mockResolvedValue({ id: 'intent-1' });
    retryIntentMock.mockResolvedValue({ id: 'intent-1' });
  });

  it('rejects without an Idempotency-Key', async () => {
    const res = await initiatePayment(initiateRequest(), ctx);
    expect(res.status).toBe(400);
    expect(initializePaystackMock).not.toHaveBeenCalled();
  });

  it('rejects when the draft has no outstanding fee', async () => {
    getRegistrationDraftMock.mockResolvedValue({
      ...paidDraft(),
      formData: { 'payment.feeAmount': 0, 'payment.paymentStatus': 'waived' },
    });
    const res = await initiatePayment(initiateRequest('k-1'), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toMatch(/no outstanding registration fee/i);
    expect(initializePaystackMock).not.toHaveBeenCalled();
  });

  it('initializes Paystack server-side and returns the access code for popup resume', async () => {
    const res = await initiatePayment(initiateRequest('k-2'), ctx);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe('initiated');
    expect(String(json.reference)).toMatch(/^SPT-REG-/);
    expect(json.authorizationUrl).toBe('https://checkout.paystack.com/accesscode123abc');
    expect(json.accessCode).toBe('accesscode123abc');
    expect(json.transactionId).toBe('intent-1');

    // Amount is the SERVER quote (5000 NGN → 500000 kobo), never client input.
    expect(initializePaystackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500000,
        currency: 'NGN',
        email: USER.email,
      }),
    );
    expect(createIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: APP_ID, amountKobo: 500000, idempotencyKey: 'k-2' }),
    );
  });

  it('re-issues the existing intent row in place on a retry with a new key', async () => {
    getByAppAndMethodMock.mockResolvedValue({
      id: 'intent-9',
      status: 'initiated',
      paymentReference: 'SPT-REG-OLD',
    });
    const res = await initiatePayment(initiateRequest('k-3'), ctx);
    expect(res.status).toBe(201);
    expect(retryIntentMock).toHaveBeenCalledWith(
      'intent-9',
      expect.objectContaining({ idempotencyKey: 'k-3' }),
    );
    expect(createIntentMock).not.toHaveBeenCalled();
  });

  it('short-circuits to completed when the application already paid — no new charge', async () => {
    getByAppAndMethodMock.mockResolvedValue({
      id: 'intent-7',
      status: 'completed',
      paymentReference: 'SPT-REG-PAID1',
    });
    const res = await initiatePayment(initiateRequest('k-4'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('completed');
    expect(json.reference).toBe('SPT-REG-PAID1');
    expect(initializePaystackMock).not.toHaveBeenCalled();
    expect(createIntentMock).not.toHaveBeenCalled();
  });

  it('replays the stored intent on a repeated Idempotency-Key', async () => {
    findByIdempotencyKeyMock.mockResolvedValue({
      id: 'intent-5',
      status: 'initiated',
      paymentReference: 'SPT-REG-REPLAY',
    });
    const res = await initiatePayment(initiateRequest('k-5'), ctx);
    const json = await res.json();
    expect(json.reference).toBe('SPT-REG-REPLAY');
    expect(initializePaystackMock).not.toHaveBeenCalled();
  });

  it('forbids initiating against someone else\'s draft', async () => {
    getRegistrationDraftMock.mockResolvedValue({ ...paidDraft(), userId: 'someone-else' });
    const res = await initiatePayment(initiateRequest('k-6'), ctx);
    expect(res.status).toBe(403);
  });
});

/* ── client helper ──────────────────────────────────────────────────────── */

const authFetchMock = vi.fn();
const resumeTransactionMock = vi.fn();
const loadPaystackMock = vi.fn(async () => {
  return class {
    resumeTransaction = resumeTransactionMock;
    newTransaction = vi.fn();
  };
});

vi.mock('@/src/lib/auth/flow', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  isUnauthorized: (r: Response) => r.status === 401,
  redirectToLogin: vi.fn(),
}));
vi.mock('@/src/lib/payments', () => ({
  loadPaystackClient: () => loadPaystackMock(),
}));

import {
  startRegistrationPayment,
  resumeRegistrationCheckout,
  confirmRegistrationPayment,
} from '@/src/lib/payments/registration-fee';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('startRegistrationPayment', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    resumeTransactionMock.mockReset();
  });

  it('POSTs initiate with a fresh crypto.randomUUID Idempotency-Key and method PAYSTACK', async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse(
        { success: true, status: 'initiated', reference: 'SPT-REG-X', accessCode: 'ac1' },
        201,
      ),
    );
    const start = await startRegistrationPayment(APP_ID, USER.email);
    expect(start.kind).toBe('checkout');

    const [url, init] = authFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/registration/applications/${APP_ID}/payment/initiate`);
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(UUID_RE);
    expect(JSON.parse(String(init.body))).toEqual({ method: 'PAYSTACK', email: USER.email });
  });

  it('uses a NEW Idempotency-Key per attempt (retries re-issue the intent server-side)', async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse({ success: true, status: 'initiated', reference: 'SPT-REG-X', accessCode: 'ac1' }, 201),
    );
    await startRegistrationPayment(APP_ID, USER.email);
    await startRegistrationPayment(APP_ID, USER.email);
    const key1 = ((authFetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    const key2 = ((authFetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];
    expect(key1).toMatch(UUID_RE);
    expect(key2).toMatch(UUID_RE);
    expect(key1).not.toBe(key2);
  });

  it('maps an already-paid intent to paid — no checkout, no second charge', async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse({ success: true, status: 'completed', reference: 'SPT-REG-PAID1' }),
    );
    const start = await startRegistrationPayment(APP_ID, USER.email);
    expect(start).toEqual({ kind: 'paid', reference: 'SPT-REG-PAID1' });
  });

  it('maps 401 to unauthorized and non-ok statuses to error', async () => {
    authFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));
    expect((await startRegistrationPayment(APP_ID, USER.email)).kind).toBe('unauthorized');

    authFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Too many payment attempts. Please slow down.' }, 429));
    const limited = await startRegistrationPayment(APP_ID, USER.email);
    expect(limited.kind).toBe('error');
    if (limited.kind === 'error') expect(limited.message).toMatch(/slow down/i);

    authFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'This application has no outstanding registration fee.' }, 400));
    const noFee = await startRegistrationPayment(APP_ID, USER.email);
    expect(noFee.kind).toBe('error');
    if (noFee.kind === 'error') expect(noFee.message).toMatch(/no outstanding/i);
  });
});

describe('resumeRegistrationCheckout', () => {
  beforeEach(() => resumeTransactionMock.mockReset());

  it('resumes the server-initialized transaction by access code (never newTransaction)', async () => {
    resumeTransactionMock.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as { onSuccess?: (t: { reference: string }) => void } | undefined;
      cb?.onSuccess?.({ reference: 'SPT-REG-RESUMED' });
    });
    const tx = await resumeRegistrationCheckout({ reference: 'SPT-REG-RESUMED', accessCode: 'ac-9' });
    expect(resumeTransactionMock).toHaveBeenCalledWith('ac-9', expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(tx.reference).toBe('SPT-REG-RESUMED');
  });

  it('rejects on cancel so the wizard can retry with a fresh key', async () => {
    resumeTransactionMock.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as { onCancel?: () => void } | undefined;
      cb?.onCancel?.();
    });
    await expect(resumeRegistrationCheckout({ reference: 'r', accessCode: 'ac' })).rejects.toThrow(/cancelled/i);
  });
});

describe('confirmRegistrationPayment', () => {
  beforeEach(() => authFetchMock.mockReset());

  it('returns SUCCESSFUL when verify settles the intent', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ success: true, status: 'SUCCESSFUL', reference: 'r1' }));
    const out = await confirmRegistrationPayment(APP_ID, 'r1', { delayMs: 0 });
    expect(out).toBe('SUCCESSFUL');
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(String(authFetchMock.mock.calls[0][0])).toContain(`/payment/verify?reference=r1`);
  });

  it('polls through PENDING until a terminal status', async () => {
    authFetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, status: 'PENDING' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, status: 'SUCCESSFUL' }));
    const out = await confirmRegistrationPayment(APP_ID, 'r1', { delayMs: 0 });
    expect(out).toBe('SUCCESSFUL');
    expect(authFetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns PENDING after exhausting attempts — never fabricates success', async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ success: true, status: 'PENDING' }));
    const out = await confirmRegistrationPayment(APP_ID, 'r1', { attempts: 3, delayMs: 0 });
    expect(out).toBe('PENDING');
    expect(authFetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces FAILED and unauthorized without retrying', async () => {
    authFetchMock.mockResolvedValueOnce(jsonResponse({ success: true, status: 'FAILED' }));
    expect(await confirmRegistrationPayment(APP_ID, 'r1', { delayMs: 0 })).toBe('FAILED');

    authFetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));
    expect(await confirmRegistrationPayment(APP_ID, 'r1', { delayMs: 0 })).toBe('unauthorized');
  });
});
