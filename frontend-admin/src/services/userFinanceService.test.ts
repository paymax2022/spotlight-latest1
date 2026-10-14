import { apiRoot } from '@/config/env';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminUsersRequestError } from './usersService';
import {
  approveKycCase,
  getUserKyc,
  getWalletBalance,
  getWalletTransactions,
  rejectKycCase,
} from './userFinanceService';

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}
function lastCall() {
  const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  return { url: String(url), init: (init ?? {}) as RequestInit };
}
afterEach(() => vi.unstubAllGlobals());
const full = (path: string) => `${apiRoot()}${path}`;

const tx = { id: 't1', type: 'credit', amount_kobo: 500, reference: 'r', created_at: '2026-01-01' };
const reads: Array<[string, (id: string) => Promise<unknown>, string, unknown, unknown]> = [
  ['getWalletBalance', getWalletBalance, '/api/finance/admin/wallets/u1/balance', { user_id: 'u1', balance_kobo: 12345, balance_naira: 123.45 }, { balanceKobo: 12345 }],
  ['getWalletTransactions', getWalletTransactions, '/api/finance/admin/wallets/u1/transactions', { transactions: [tx], total: 1, limit: 50, offset: 0 }, [tx]],
  ['getUserKyc', getUserKyc, '/api/finance/admin/kyc/users/u1', { tier: 2, status: 'verified', openCaseId: null }, { tier: 2, status: 'verified', openCaseId: null }],
];

describe('userFinanceService reads', () => {
  it.each(reads)('%s: GET url + mapped result', async (_n, fn, path, body, expected) => {
    respond(200, body);
    await expect(fn('u1')).resolves.toEqual(expected);
    const { url, init } = lastCall();
    expect(url).toBe(full(path));
    expect(init.method ?? 'GET').toBe('GET');
  });
  it.each(reads)('%s: throws AdminUsersRequestError(403)', async (_n, fn) => {
    respond(403, { error: 'forbidden' });
    const err = await fn('u1').catch((e) => e);
    expect(err).toBeInstanceOf(AdminUsersRequestError);
    expect(err.status).toBe(403);
  });
  it('getUserKyc passes through an open case id', async () => {
    respond(200, { tier: 1, status: 'pending', openCaseId: 'c1' });
    await expect(getUserKyc('u1')).resolves.toEqual({ tier: 1, status: 'pending', openCaseId: 'c1' });
  });
});

describe('userFinanceService KYC decisions', () => {
  it('approveKycCase POSTs { reason } with an idempotency key', async () => {
    respond(200, { status: 'APPROVED' });
    await expect(approveKycCase('c1', 'docs verified')).resolves.toBe(true);
    const { url, init } = lastCall();
    expect(url).toBe(full('/api/finance/admin/kyc/cases/c1/approve'));
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'docs verified' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });
  it('rejectKycCase POSTs { reason }', async () => {
    respond(200, { status: 'REJECTED' });
    await expect(rejectKycCase('c1', 'blurry')).resolves.toBe(true);
    const { url, init } = lastCall();
    expect(url).toBe(full('/api/finance/admin/kyc/cases/c1/reject'));
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'blurry' });
  });
  it('returns false when the backend refuses', async () => {
    respond(403, { error: 'forbidden' });
    await expect(approveKycCase('c1', 'x')).resolves.toBe(false);
    respond(500, { error: 'boom' });
    await expect(rejectKycCase('c1', 'x')).resolves.toBe(false);
  });
});
