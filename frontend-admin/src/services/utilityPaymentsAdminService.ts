/**
 * Utility Payments admin — reads/reverses utility_transactions via
 * frontend-web's existing admin API (RBAC-gated on utility:support /
 * utility:manage, see backend routes under
 * frontend-web/app/api/admin/utility/transactions), reached over the same
 * web-proxy Path A other finance consoles here use (see
 * docs/adr/ADR-047-admin-console-consolidation-path-a.md).
 *
 * Surfaces the case a customer's Paystack charge succeeds but the biller
 * fulfillment fails: the transaction sits at status 'failed' with
 * payment_source 'paystack' and nothing else in the admin console lists it.
 * reverseTransaction is intentionally payment_source-aware server-side (see
 * frontend-web/src/server/utility/service.ts#reverseUtilityTransaction) —
 * it only credits the wallet for wallet-funded transactions; a
 * Paystack-funded one is marked reversed/closed with the reason recorded,
 * and the refund itself is issued out-of-band via Paystack.
 */
import { webProxyBase } from '@/config/env';

export type UtilityTransactionStatus =
  | 'initiated' | 'wallet_debited' | 'provider_pending' | 'successful' | 'failed' | 'reversed' | 'disputed';

export interface UtilityTransactionRow {
  id: string;
  user_id: string;
  category: string;
  customer_reference: string;
  amount_kobo: number;
  retail_amount_kobo: number;
  status: UtilityTransactionStatus;
  receipt_number: string | null;
  payment_source: 'wallet' | 'paystack';
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(json = false, extra?: Record<string, string>): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  const headers: Record<string, string> = { ...extra };
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error(`${label} failed: 401 — sign in again.`);
  if (res.status === 403) throw new Error(`${label} failed: 403 — this account needs the utility:support or utility:manage permission.`);
  if (!res.ok) throw new Error(`${label} failed: ${(json.error as string) || res.status}`);
  return json;
}

export function formatNaira(kobo: number | null | undefined): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format((kobo ?? 0) / 100);
}

export async function listUtilityTransactions(status?: string): Promise<UtilityTransactionRow[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${webBase()}/api/admin/utility/transactions${qs}`, { cache: 'no-store', headers: authHeaders() });
  const json = await readJsonOrThrow(res, 'Loading utility transactions');
  return (json.transactions as UtilityTransactionRow[]) ?? [];
}

export async function reverseUtilityTransaction(id: string, reason: string): Promise<UtilityTransactionRow> {
  const res = await fetch(`${webBase()}/api/admin/utility/transactions/${id}/reverse`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ reason }),
  });
  const json = await readJsonOrThrow(res, 'Closing out utility transaction');
  return json.transaction as UtilityTransactionRow;
}
