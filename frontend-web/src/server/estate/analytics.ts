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
