import { adminApiBase, authHeaders, readOrThrow } from './usersService';
import { operationKey } from './idempotency';

/**
 * Per-user finance reads/actions for the admin user profile. Backend:
 * /api/finance/admin/{wallets,kyc} (finance.admin.* RBAC). Reads throw
 * AdminUsersRequestError (via readOrThrow) so callers can tell 403 apart.
 */
const enc = encodeURIComponent;
const financeBase = () => `${adminApiBase()}/finance/admin`;

export type WalletTransactionRow = {
  id: string;
  type: string;
  amount_kobo: number;
  reference: string;
  created_at: string;
};

export async function getWalletBalance(id: string): Promise<{ balanceKobo: number }> {
  const res = await fetch(`${financeBase()}/wallets/${enc(id)}/balance`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading wallet balance');
  return { balanceKobo: Number(payload.balance_kobo ?? 0) };
}

export async function getWalletTransactions(id: string): Promise<WalletTransactionRow[]> {
  const res = await fetch(`${financeBase()}/wallets/${enc(id)}/transactions`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading wallet transactions');
  return Array.isArray(payload.transactions) ? (payload.transactions as WalletTransactionRow[]) : [];
}

export async function getUserKyc(
  id: string,
): Promise<{ tier: number; status: string; openCaseId: string | null }> {
  const res = await fetch(`${financeBase()}/kyc/users/${enc(id)}`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading KYC status');
  return {
    tier: Number(payload.tier ?? 0),
    status: String(payload.status ?? ''),
    openCaseId: typeof payload.openCaseId === 'string' ? payload.openCaseId : null,
  };
}

// A KYC decision moves the user's tier (and money limits), so it carries an
// operation-identity Idempotency-Key like kycAdminService's decisions.
async function decide(caseId: string, action: 'approve' | 'reject', body?: unknown): Promise<boolean> {
  const res = await fetch(`${financeBase()}/kyc/cases/${enc(caseId)}/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('kyc', action, caseId) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // The Go kycverify handlers reply 200 {"status": "<SessionStatus>"} with no
  // `success` field, so success is the HTTP status alone.
  return res.ok;
}

export async function approveKycCase(caseId: string, reason: string): Promise<boolean> {
  return decide(caseId, 'approve', { reason });
}

export async function rejectKycCase(caseId: string, reason: string): Promise<boolean> {
  return decide(caseId, 'reject', { reason });
}

export async function getUserTier(
  id: string,
): Promise<{ tier: number; dailyDebitLimitKobo: number; maxBalanceKobo: number }> {
  const res = await fetch(`${financeBase()}/tiers/${enc(id)}`, {
    cache: 'no-store',
    credentials: 'include',
    headers: authHeaders(),
  });
  const payload = await readOrThrow(res, 'Loading account tier');
  return {
    tier: Number(payload.tier ?? 0),
    dailyDebitLimitKobo: Number(payload.dailyDebitLimitKobo ?? 0),
    maxBalanceKobo: Number(payload.maxBalanceKobo ?? 0),
  };
}
