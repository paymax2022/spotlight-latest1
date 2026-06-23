/**
 * Estate reports (Block 44) — read-only computed reports over existing tables.
 * All amounts kobo. No new tables.
 */
import { createAdminClient } from '@/lib/supabase/server';

export interface ReportMetric { label: string; value: string }
export interface ReportSection { id: string; title: string; metrics: ReportMetric[] }

function naira(kobo: number): string {
  return '₦' + (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

export async function buildReports(estateId: string): Promise<ReportSection[]> {
  const supabase = createAdminClient();

  const [{ data: invoices }, { data: payments }, { data: repairs }, { data: meetings }] = await Promise.all([
    supabase.from('estate_dues_invoices').select('amount_kobo, status, category').eq('estate_id', estateId),
    supabase.from('estate_payments').select('amount_kobo, status, method').eq('estate_id', estateId),
    supabase.from('estate_repair_requests').select('status, urgency').eq('estate_id', estateId),
    supabase.from('estate_meetings').select('status').eq('estate_id', estateId),
  ]);

  const invs = invoices ?? []; const pays = payments ?? []; const reps = repairs ?? []; const mtgs = meetings ?? [];

  // ── Dues collection ──
  const billed = invs.reduce((s, i: any) => s + (i.amount_kobo ?? 0), 0);
  const collected = (pays as any[]).filter((p) => p.status === 'successful').reduce((s, p) => s + (p.amount_kobo ?? 0), 0);
  const paidCount = invs.filter((i: any) => i.status === 'paid').length;
  const rate = invs.length ? Math.round((paidCount / invs.length) * 100) : 0;
  const duesCollection: ReportSection = {
    id: 'dues_collection', title: 'Dues collection',
    metrics: [
      { label: 'Total billed', value: naira(billed) },
      { label: 'Collected', value: naira(collected) },
      { label: 'Invoices paid', value: `${paidCount} / ${invs.length}` },
      { label: 'Collection rate', value: `${rate}%` },
    ],
  };

  // ── Payment methods ──
  const byMethod = new Map<string, number>();
  for (const p of pays as any[]) if (p.status === 'successful') byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + (p.amount_kobo ?? 0));
  const paymentMethods: ReportSection = {
    id: 'payment_methods', title: 'Payments by method',
    metrics: Array.from(byMethod.entries()).map(([m, v]) => ({ label: m, value: naira(v) })) || [],
  };
  if (paymentMethods.metrics.length === 0) paymentMethods.metrics.push({ label: 'No payments', value: '—' });

  // ── Maintenance throughput ──
  const openReps = reps.filter((r: any) => !['completed', 'cancelled'].includes(r.status)).length;
  const doneReps = reps.filter((r: any) => r.status === 'completed').length;
  const highUrgent = reps.filter((r: any) => r.urgency === 'high' && !['completed', 'cancelled'].includes(r.status)).length;
  const maintenance: ReportSection = {
    id: 'maintenance', title: 'Maintenance',
    metrics: [
      { label: 'Open requests', value: String(openReps) },
      { label: 'Completed', value: String(doneReps) },
      { label: 'High-urgency open', value: String(highUrgent) },
      { label: 'Total logged', value: String(reps.length) },
    ],
  };

  // ── Meetings ──
  const ended = mtgs.filter((m: any) => m.status === 'ended').length;
  const scheduled = mtgs.filter((m: any) => m.status === 'scheduled').length;
  const meetingsReport: ReportSection = {
    id: 'meetings', title: 'Meetings',
    metrics: [
      { label: 'Scheduled', value: String(scheduled) },
      { label: 'Held', value: String(ended) },
      { label: 'Total', value: String(mtgs.length) },
    ],
  };

  return [duesCollection, paymentMethods, maintenance, meetingsReport];
}
