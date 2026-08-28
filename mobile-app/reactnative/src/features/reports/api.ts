// Estate Reports (Block 44) — types + dual mock/live api.
import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';

export interface ReportMetric { label: string; value: string }
export interface ReportSection { id: string; title: string; metrics: ReportMetric[] }
export interface ReportsResponse { sections: ReportSection[] }

export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_REPORTS_USE_MOCK, true);

// Reports/analytics are served by the resident-scoped frontend-web handlers
// under /api/v1/estate/reports and /api/v1/estate/analytics/{type}. The current
// resident's estate is derived SERVER-SIDE from the auth token
// (frontend-web/src/server/estate/resident.ts → getResidentContext), so the
// client never passes an estate ID. Both are estate-admin only server-side.
export const REPORTS_API_BASE = '/api/v1/estate/reports';

export const SECTION_ICON: Record<string, string> = {
  dues_collection: 'ReceiptText', payment_methods: 'Wallet', maintenance: 'Wrench', meetings: 'CalendarDays',
};

const mock: ReportsResponse = {
  sections: [
    { id: 'dues_collection', title: 'Dues collection', metrics: [
      { label: 'Total billed', value: '₦2,160,000' }, { label: 'Collected', value: '₦1,845,000' },
      { label: 'Invoices paid', value: '39 / 48' }, { label: 'Collection rate', value: '81%' },
    ] },
    { id: 'payment_methods', title: 'Payments by method', metrics: [
      { label: 'wallet', value: '₦1,520,000' }, { label: 'transfer', value: '₦325,000' },
    ] },
    { id: 'maintenance', title: 'Maintenance', metrics: [
      { label: 'Open requests', value: '4' }, { label: 'Completed', value: '17' },
      { label: 'High-urgency open', value: '1' }, { label: 'Total logged', value: '21' },
    ] },
    { id: 'meetings', title: 'Meetings', metrics: [
      { label: 'Scheduled', value: '2' }, { label: 'Held', value: '6' }, { label: 'Total', value: '8' },
    ] },
  ],
};
const latency = (ms = 320) => new Promise((r) => setTimeout(r, ms));

export async function getReports(): Promise<ReportsResponse> {
  if (USE_MOCK) { await latency(); return JSON.parse(JSON.stringify(mock)); }
  // The resident-scoped handler already returns the computed { sections } shape
  // (frontend-web/app/api/v1/estate/reports/route.ts → buildReports()).
  const { data } = await api.get<ReportsResponse>(REPORTS_API_BASE);
  return { sections: Array.isArray(data?.sections) ? data.sections : [] };
}

// ── Block 44 analytics (chart-ready, date-filtered) ───────────────────────────
export type AnalyticsType = 'visitors' | 'gate' | 'payments' | 'repairs' | 'facilities' | 'meetings' | 'elections' | 'security' | 'vendors';
export interface AnalyticsPoint { label: string; value: number; }
export interface AnalyticsResult { type: string; from: string; to: string; series: AnalyticsPoint[]; summary: Record<string, number>; }
export const ANALYTICS_BASE = '/api/v1/estate/analytics';

export async function getAnalytics(type: AnalyticsType, from?: string, to?: string): Promise<AnalyticsResult> {
  if (USE_MOCK) {
    await latency();
    return { type, from: from ?? '', to: to ?? '', series: [{ label: 'A', value: 4 }, { label: 'B', value: 7 }], summary: { total: 11 } };
  }
  const { data } = await api.get(`${ANALYTICS_BASE}/${type}`, { params: { from, to } });
  return {
    type: data.type, from: data.from, to: data.to,
    series: (data.series ?? []).map((p: any) => ({ label: p.label, value: Number(p.value ?? 0) })),
    summary: (data.summary ?? {}) as Record<string, number>,
  };
}
