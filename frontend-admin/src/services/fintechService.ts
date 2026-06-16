import { env } from '@/config/env';
import type { KycProfile, WalletBalance, TransactionsResponse } from '@/types/fintech';

function financeAdminBase(): string {
  // Go backend finance admin routes live at /api/finance/admin/...
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/admin');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function listPendingKyc(): Promise<KycProfile[]> {
  const res = await fetch(`${financeAdminBase()}/kyc/pending`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`KYC pending list failed: ${res.status}`);
  const data = await res.json();
  return data.profiles ?? [];
}

export async function approveKyc(userId: string, newTier: number): Promise<KycProfile> {
  const res = await fetch(`${financeAdminBase()}/kyc/users/${encodeURIComponent(userId)}/approve`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ new_tier: newTier }),
  });
  if (!res.ok) throw new Error(`KYC approve failed: ${res.status}`);
  return res.json();
}

export async function rejectKyc(userId: string): Promise<void> {
  const res = await fetch(`${financeAdminBase()}/kyc/users/${encodeURIComponent(userId)}/reject`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`KYC reject failed: ${res.status}`);
}

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
