/**
 * Estate finance dashboard (Block 40) — read-only aggregation over
 * estate_payments + estate_dues_invoices. No new tables; all amounts are kobo.
 */
import { createAdminClient } from '@/lib/supabase/server';

export interface FinanceDashboard {
  collectedTotalKobo: number;
  collectedThisMonthKobo: number;
  outstandingKobo: number;
  invoiceCount: number;
  paidCount: number;
  collectionRate: number; // 0-100
  byCategory: { category: string; amountKobo: number }[];
  recentPayments: { id: string; amountKobo: number; method: string; payerName?: string; createdAt: string }[];
}

export async function getFinanceDashboard(estateId: string): Promise<FinanceDashboard> {
  const supabase = createAdminClient();

  const startOfMonth = new Date();
  startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

  const [{ data: payments }, { data: invoices }] = await Promise.all([
    supabase.from('estate_payments').select('id, invoice_id, payer_id, amount_kobo, method, status, created_at').eq('estate_id', estateId).eq('status', 'successful').order('created_at', { ascending: false }),
    supabase.from('estate_dues_invoices').select('id, category, amount_kobo, status, due_date').eq('estate_id', estateId),
  ]);

  const pays = payments ?? [];
  const invs = invoices ?? [];

  const collectedTotalKobo = pays.reduce((s, p: any) => s + (p.amount_kobo ?? 0), 0);
  const collectedThisMonthKobo = pays.filter((p: any) => new Date(p.created_at) >= startOfMonth).reduce((s, p: any) => s + (p.amount_kobo ?? 0), 0);

  const now = Date.now();
  const outstandingKobo = invs
    .filter((i: any) => i.status === 'pending' || i.status === 'overdue' || (i.status === 'pending' && +new Date(i.due_date) < now))
    .reduce((s, i: any) => s + (i.amount_kobo ?? 0), 0);

  const invoiceCount = invs.length;
  const paidCount = invs.filter((i: any) => i.status === 'paid').length;
  const collectionRate = invoiceCount ? Math.round((paidCount / invoiceCount) * 100) : 0;

  // Payments by dues category (resolve via invoice_id → category).
  const invCategory = new Map<string, string>();
  for (const i of invs) invCategory.set((i as any).id, (i as any).category);
  const catTotals = new Map<string, number>();
  for (const p of pays as any[]) {
    const cat = p.invoice_id ? invCategory.get(p.invoice_id) ?? 'other' : 'other';
    catTotals.set(cat, (catTotals.get(cat) ?? 0) + (p.amount_kobo ?? 0));
  }
  const byCategory = Array.from(catTotals.entries()).map(([category, amountKobo]) => ({ category, amountKobo })).sort((a, b) => b.amountKobo - a.amountKobo);

  // Recent payments with payer names.
  const recent = (pays as any[]).slice(0, 8);
  const names: Record<string, string> = {};
  const payerIds = Array.from(new Set(recent.map((p) => p.payer_id).filter(Boolean)));
  if (payerIds.length) {
    const { data: profs } = await supabase.from('user_profiles').select('id, full_name').in('id', payerIds);
    (profs ?? []).forEach((u: any) => { names[u.id] = u.full_name ?? 'Resident'; });
  }
  const recentPayments = recent.map((p) => ({ id: p.id, amountKobo: p.amount_kobo, method: p.method, payerName: names[p.payer_id], createdAt: p.created_at }));

  return { collectedTotalKobo, collectedThisMonthKobo, outstandingKobo, invoiceCount, paidCount, collectionRate, byCategory, recentPayments };
}
