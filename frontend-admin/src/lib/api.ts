// Swap reconciliation report client (Phase 1 CR-015).
// GET /api/v1/admin/crypto/reconciliation?details=&start_date=&end_date=
import { apiV1 } from '@/config/env';

export interface OrderReconciliationRow {
  order_id: string;
  user_id: string;
  status: string;
  ledger_settled: boolean;
  swap_transaction_id: string;
  provider_status: string;
  settled_at?: string | null;
  drift?: string;
}

export interface ReconciliationReport {
  run_at: string;
  total_orders: number;
  reconcilled_orders: number;
  drift_orders: number;
  failed_orders: number;
  orders?: OrderReconciliationRow[];
  summary: string;
}

export interface ReconciliationQuery {
  details?: boolean;
  start_date?: string;
  end_date?: string;
}

export async function fetchReconciliation(q: ReconciliationQuery = {}): Promise<ReconciliationReport> {
  const params = new URLSearchParams();
  if (q.details !== undefined) params.set('details', String(q.details));
  if (q.start_date) params.set('start_date', q.start_date);
  if (q.end_date) params.set('end_date', q.end_date);
  const res = await fetch(`${apiV1()}/admin/crypto/reconciliation?${params.toString()}`, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    let msg = `Reconciliation fetch failed: ${res.status}`;
    try {
      const body = await res.json();
      const e = body?.error;
      if (e) msg = typeof e === 'string' ? e : (e.message ?? msg);
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ReconciliationReport;
}
