/**
 * Shared test fixtures for the golden-path E2E suite.
 *
 * These helpers snapshot the current API contracts so any change that alters
 * route response shapes or auth requirements will break a test here — giving
 * reviewers a clear signal to decide whether the change is intentional.
 */

// ---------------------------------------------------------------------------
// Request factory
// ---------------------------------------------------------------------------

export function makeRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    ip?: string;
  } = {},
): Request {
  const { method = 'POST', body, headers = {}, ip } = options;

  const allHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...headers,
  };
  if (ip) allHeaders['x-forwarded-for'] = ip;

  return new Request(`http://localhost${url}`, {
    method,
    headers: allHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, authorization: 'Bearer test-token-abc123' };
}

// ---------------------------------------------------------------------------
// Common result fixtures — match the shapes returned by service functions
// ---------------------------------------------------------------------------

export function makeFreeVoteResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    votesAdded: 1,
    totalFreeVotesUsed: 1,
    freeVotesRemaining: 4,
    newTotalVotes: 42,
    fraudStatus: 'clean',
    ...overrides,
  };
}

export function makeInitiateResult(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'tx-001',
    paymentReference: 'PAY_ref_abc123',
    authorizationUrl: 'https://checkout.paystack.com/abc123',
    amountExpected: 50000, // kobo
    currency: 'NGN',
    votesToCredit: 10,
    bonusVotes: 2,
    ...overrides,
  };
}

export function makeVerifyResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    alreadyProcessed: false,
    votesCredited: 10,
    newTotalVotes: 52,
    receiptNumber: 'RCP-20260613-001',
    ...overrides,
  };
}

export function makeWebhookResult(overrides: Partial<{ duplicate: boolean; processed: boolean }> = {}) {
  return {
    duplicate: false,
    processed: true,
    ...overrides,
  };
}

export function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-id-001',
    email: 'voter@example.com',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Supabase chainable mock factory
// ---------------------------------------------------------------------------

import { vi } from 'vitest';

/**
 * Creates a chainable Supabase mock where terminal calls (maybySingle, single,
 * insert) are pre-configured vi.fn()s that can be configured per test via
 * mockResolvedValueOnce / mockResolvedValue.
 *
 * Usage:
 *   const { mock, maybySingle, insertFn } = makeSupabaseMock();
 *   maybySingle.mockResolvedValueOnce({ data: batchRow, error: null });
 *   vi.mocked(createAdminClient).mockReturnValue(mock as any);
 */
export function makeSupabaseMock() {
  const maybySingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const single = vi.fn().mockResolvedValue({ data: null, error: null });
  const insertFn = vi.fn().mockResolvedValue({ error: null });
  const upsertFn = vi.fn().mockReturnThis();

  // Updates always chain: .update({}).eq('col', val) → Promise<{data,error}>
  // The updateEq fn is the terminal awaitable; updateFn returns it.
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
  const updateFn = vi.fn().mockReturnValue({
    eq:  updateEq,
    neq: updateEq,
    is:  updateEq,
    not: updateEq,
    in:  updateEq,
  });

  const mock = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: maybySingle,
    single,
    insert: insertFn,
    update: updateFn,
    upsert: upsertFn,
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-id-001', email: 'voter@example.com' } },
        error: null,
      }),
    },
  };

  return { mock, maybySingle, single, insertFn, updateFn, updateEq };
}
