/**
 * Estate analytics (Block 44) — read-only, chart-ready series over existing
 * estate tables. Resident-scoped: the estate is resolved server-side from the
 * caller; no new tables. Amounts are kobo. Mirrors the reports module.
 *
 * Returns the shape the mobile app expects (see
 * mobile-app/reactnative/src/features/reports/api.ts → AnalyticsResult):
 *   { type, from, to, series: [{ label, value }], summary: Record<string,number> }
 */
import { createAdminClient } from '@/lib/supabase/server';

export type AnalyticsType =
  | 'visitors' | 'gate' | 'payments' | 'repairs' | 'facilities'
  | 'meetings' | 'elections' | 'security' | 'vendors';

export interface AnalyticsPoint { label: string; value: number }
export interface AnalyticsResult {
  type: string; from: string; to: string;
  series: AnalyticsPoint[]; summary: Record<string, number>;
}

const ANALYTICS_TYPES: AnalyticsType[] = [
  'visitors', 'gate', 'payments', 'repairs', 'facilities',
  'meetings', 'elections', 'security', 'vendors',
];

export function isAnalyticsType(v: string): v is AnalyticsType {
  return (ANALYTICS_TYPES as string[]).includes(v);
}

// Group rows into a labelled series by a status/category-like key.
function countBy(rows: any[], key: string): AnalyticsPoint[] {
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const k = String(r?.[key] ?? 'unknown');
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
}

function withinRange(q: any, column: string, from?: string, to?: string) {
  let out = q;
  if (from) out = out.gte(column, from);
  if (to) out = out.lte(column, to);
  return out;
}

/**
 * Build a chart-ready analytics result for an estate. Only estate-scoped tables
 * are read; unknown/unsupported types return an empty series (never throws).
 */
export async function buildAnalytics(
  estateId: string,
  type: AnalyticsType,
  from?: string,
  to?: string,
): Promise<AnalyticsResult> {
  const supabase = createAdminClient();
  const base = (table: string, cols: string) =>
    withinRange(supabase.from(table).select(cols).eq('estate_id', estateId), 'created_at', from, to);

  let series: AnalyticsPoint[] = [];
  const summary: Record<string, number> = {};

  switch (type) {
    case 'payments': {
      const { data } = await base('estate_payments', 'amount_kobo, status, method');
      const rows = data ?? [];
      series = countBy(rows, 'method');
      summary.total = rows.length;
      summary.total_kobo = rows.reduce((s: number, r: any) => s + (r.amount_kobo ?? 0), 0);
      summary.successful = rows.filter((r: any) => r.status === 'successful').length;
      break;
    }
    case 'repairs': {
      const { data } = await base('estate_repair_requests', 'status, urgency');
      const rows = data ?? [];
      series = countBy(rows, 'status');
      summary.total = rows.length;
      summary.open = rows.filter((r: any) => !['completed', 'cancelled'].includes(r.status)).length;
      break;
    }
    case 'facilities': {
      const { data } = await base('facility_bookings', 'status');
      const rows = data ?? [];
      series = countBy(rows, 'status');
      summary.total = rows.length;
      break;
    }
    case 'meetings': {
      const { data } = await base('estate_meetings', 'status');
      const rows = data ?? [];
      series = countBy(rows, 'status');
      summary.total = rows.length;
      break;
    }
    case 'elections': {
      const { data } = await base('elections', 'status');
      const rows = data ?? [];
      series = countBy(rows, 'status');
      summary.total = rows.length;
      break;
    }
    case 'vendors': {
      const { data } = await base('vendor_jobs', 'status, amount_kobo');
      const rows = data ?? [];
      series = countBy(rows, 'status');
      summary.total = rows.length;
      summary.total_kobo = rows.reduce((s: number, r: any) => s + (r.amount_kobo ?? 0), 0);
      break;
    }
    case 'security':
    case 'visitors':
    case 'gate': {
      // Estate-side incident/emergency view (visitor gate analytics live under
      // the dedicated /api/v1/visitor/* handlers; here we surface estate alerts).
      const { data } = await base('estate_emergency_alerts', 'status, kind');
      const rows = data ?? [];
      series = countBy(rows, 'kind');
      summary.total = rows.length;
      summary.open = rows.filter((r: any) => r.status !== 'resolved').length;
      break;
    }
    default:
      series = [];
  }

  return { type, from: from ?? '', to: to ?? '', series, summary };
}

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

  const byMethod = new Map<string, number>();
  for (const p of pays as any[]) if (p.status === 'successful') byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + (p.amount_kobo ?? 0));
  const paymentMethods: ReportSection = {
    id: 'payment_methods', title: 'Payments by method',
    metrics: Array.from(byMethod.entries()).map(([m, v]) => ({ label: m, value: naira(v) })) || [],
  };
  if (paymentMethods.metrics.length === 0) paymentMethods.metrics.push({ label: 'No payments', value: '—' });

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
