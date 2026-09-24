import { apiRoot } from '@/config/env';
import { operationKey } from './idempotency';
import type { WalletBalance, TransactionsResponse, Dispute, DisputeResolution } from '@/types/fintech';

// Go backend finance admin routes live at /api/finance/admin/... . This used
// to be env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/admin'), which
// stopped matching once apiBaseUrl became the same-origin proxy path
// (<origin>/api/admin-proxy, no /api/v1 suffix) instead of ending in /api/v1 —
// every live call 404'd against <proxy>/kyc/pending instead of
// <proxy>/api/finance/admin/kyc/pending. apiRoot() strips that trailing
// /api/v1 (if any) and nothing else, so the module path can be appended
// unconditionally regardless of which shape apiBaseUrl happens to be.
function financeAdminBase(): string {
  return `${apiRoot()}/api/finance/admin`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// listPendingKyc/approveKyc/rejectKyc used to call /api/finance/admin/kyc/{pending,
// users/:id/approve,users/:id/reject} — an admin approving a tier with no
// automated identity check behind it (that endpoint hashed BVN/NIN and stored
// it, nothing more). Both the endpoints and this page's UI (app/admin/finance/kyc)
// are removed; real identity verification is the KYC verification gateway
// console at /admin/finance/kyc-verify (finance.admin.kyc), which reviews
// actual Dojah/Smile ID/Youverify check results, not a bare tier number.

export async function getAdminWalletBalance(userId: string): Promise<WalletBalance> {
  const res = await fetch(`${financeAdminBase()}/wallets/${encodeURIComponent(userId)}/balance`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Wallet balance fetch failed: ${res.status}`);
  return res.json();
}

export async function getAdminWalletTransactions(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<TransactionsResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(
    `${financeAdminBase()}/wallets/${encodeURIComponent(userId)}/transactions?${params}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Wallet transactions fetch failed: ${res.status}`);
  return res.json();
}

export function formatKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

// Member-facing finance base (distinct from financeAdminBase() above), matching
// `finance := r.Group("/api/finance")` in backend/internal/app/finance_routes.go.
function financeBase(): string {
  return `${apiRoot()}/api/finance`;
}

export async function listAdminDisputes(status?: string, limit = 50, offset = 0): Promise<Dispute[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set('status', status);
  const res = await fetch(`${financeBase()}/disputes?${params}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Disputes list failed: ${res.status}`);
  const data = await res.json();
  return data.data ?? [];
}

export async function resolveDispute(
  disputeId: string,
  resolution: DisputeResolution,
  adminNote: string,
): Promise<void> {
  const res = await fetch(`${financeAdminBase()}/disputes/${encodeURIComponent(disputeId)}/resolve`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('dispute:resolve', disputeId) },
    body: JSON.stringify({ resolution, admin_note: adminNote }),
  });
  if (!res.ok) throw new Error(`Dispute resolve failed: ${res.status}`);
}
