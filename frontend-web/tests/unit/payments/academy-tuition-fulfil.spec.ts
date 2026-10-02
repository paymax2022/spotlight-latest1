/**
 * AUD-FE-003 residual — academy tuition instalment fulfilment through the
 * shared gateway path (webhook / recover / reconcile).
 *
 * The pending academy_installment_payments row stores no Paystack reference
 * until it is paid, so resolution runs off the VERIFIED charge's metadata
 * custom_fields (plan_id + installment_number), then the call goes to the Go
 * internal confirm endpoint — which re-verifies the charge, amount and
 * reference ownership itself before posting the ledger journal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeSupabaseMock } from '../golden-path/_fixtures';

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/src/lib/email', () => ({
  sendTransactionalEmail: vi.fn(async () => undefined),
}));

vi.mock('@/src/server/services/academy', () => ({
  ensureEnrollment: vi.fn(async () => ({ enrolled: true, enrollmentId: 'enr-1', programId: null })),
}));

import {
  academyInstallmentKeysFromMetadata,
  fulfilAcademyInstallment,
  isAcademyInstallmentMetadata,
} from '@/src/server/payments/academy-tuition-fulfil';
import { createAdminClient } from '@/lib/supabase/server';
import { ensureEnrollment } from '@/src/server/services/academy';
import { sendTransactionalEmail } from '@/src/lib/email';

const METADATA = {
  custom_fields: [
    { display_name: 'Plan', variable_name: 'plan_id', value: 'plan-1' },
    { display_name: 'Installment', variable_name: 'installment_number', value: '2' },
  ],
};

const PENDING_ROW = {
  id: 'pay-1',
  plan_id: 'plan-1',
  installment_number: 2,
  status: 'pending',
};

function mockFetchOnce(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('academyInstallmentKeysFromMetadata', () => {
  it('reads plan_id + installment_number from custom_fields', () => {
    expect(academyInstallmentKeysFromMetadata(METADATA)).toEqual({
      planId: 'plan-1',
      installmentNumber: 2,
    });
  });

  it('returns null when the academy fields are absent or malformed', () => {
    expect(academyInstallmentKeysFromMetadata(null)).toBeNull();
    expect(academyInstallmentKeysFromMetadata({})).toBeNull();
    expect(
      academyInstallmentKeysFromMetadata({
        custom_fields: [{ variable_name: 'plan_id', value: 'plan-1' }],
      }),
    ).toBeNull();
    expect(
      academyInstallmentKeysFromMetadata({
        custom_fields: [
          { variable_name: 'plan_id', value: 'plan-1' },
          { variable_name: 'installment_number', value: 'abc' },
        ],
      }),
    ).toBeNull();
  });

  it('isAcademyInstallmentMetadata mirrors the parser', () => {
    expect(isAcademyInstallmentMetadata(METADATA)).toBe(true);
    expect(isAcademyInstallmentMetadata({ custom_fields: [] })).toBe(false);
  });
});

describe('fulfilAcademyInstallment', () => {
  const originalFetch = globalThis.fetch;
  const envToken = process.env.LEDGER_SERVICE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LEDGER_SERVICE_TOKEN = 'svc-token-test';
    const { mock, maybySingle } = makeSupabaseMock();
    // pending instalment lookup → the pending row; effects lookup → parent app
    maybySingle
      .mockResolvedValue({ data: PENDING_ROW, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (envToken === undefined) delete process.env.LEDGER_SERVICE_TOKEN;
    else process.env.LEDGER_SERVICE_TOKEN = envToken;
  });

  it('confirms the pending instalment via the internal endpoint and runs post-payment effects', async () => {
    globalThis.fetch = mockFetchOnce(200, { success: true, data: { applicationId: 'app-1' } });

    const outcome = await fulfilAcademyInstallment('ref-acad-1', METADATA);

    expect(outcome).toBe('fulfilled');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/internal/finance/academy/tuition/confirm'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer svc-token-test',
        }),
        body: JSON.stringify({ planId: 'plan-1', paymentId: 'pay-1', reference: 'ref-acad-1' }),
      }),
    );
    expect(ensureEnrollment).toHaveBeenCalledWith(expect.anything(), 'app-1');
  });

  it('is a no-op when metadata carries no academy instalment keys', async () => {
    globalThis.fetch = vi.fn();
    expect(await fulfilAcademyInstallment('ref-x', { purpose: 'paymax_gateway' })).toBe('skipped');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('skips when no pending instalment row matches (already paid / unknown plan)', async () => {
    const { mock, maybySingle } = makeSupabaseMock();
    maybySingle.mockResolvedValue({ data: { ...PENDING_ROW, status: 'paid' }, error: null });
    vi.mocked(createAdminClient).mockReturnValue(mock as never);
    globalThis.fetch = vi.fn();

    expect(await fulfilAcademyInstallment('ref-x', METADATA)).toBe('skipped');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('treats a 409 idempotency collision as fulfilled (member confirm in-flight or done)', async () => {
    globalThis.fetch = mockFetchOnce(409, { error: 'duplicate', code: 'idempotency_collision' });

    expect(await fulfilAcademyInstallment('ref-x', METADATA)).toBe('fulfilled');
  });

  it('acks terminal 4xx rejections without retrying (underpayment stays pending for review)', async () => {
    globalThis.fetch = mockFetchOnce(400, { error: 'payment amount does not match plan' });

    expect(await fulfilAcademyInstallment('ref-x', METADATA)).toBe('skipped');
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('throws on 5xx so the caller retries', async () => {
    globalThis.fetch = mockFetchOnce(502, { error: 'upstream down' });

    await expect(fulfilAcademyInstallment('ref-x', METADATA)).rejects.toThrow('502');
  });

  it('throws (retryable) when the internal service token is not configured', async () => {
    delete process.env.LEDGER_SERVICE_TOKEN;
    delete process.env.GO_INTERNAL_SERVICE_TOKEN;
    globalThis.fetch = vi.fn();

    await expect(fulfilAcademyInstallment('ref-x', METADATA)).rejects.toThrow('service token');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
