// Estate Reports (Block 44) — types + dual mock/live api.
import { api } from '@/api/client';

export interface ReportMetric { label: string; value: string }
export interface ReportSection { id: string; title: string; metrics: ReportMetric[] }
export interface ReportsResponse { sections: ReportSection[] }

export const USE_MOCK = (process.env.EXPO_PUBLIC_REPORTS_USE_MOCK ?? 'true') !== 'false';

// Reports/analytics are NOT a standalone backend module — they are nested
// under the Estate module (backend/internal/app/finance_routes.go: estGroup :=
// finance.Group("/estate"); backend/internal/estate/handler.go: Report and
// GetAnalytics both take :id (estate)). There is no flat /reports or
// /analytics namespace and no frontend-web proxy for /api/v1/estate/reports|
// analytics — the blanket rewrite only covers /api/finance/:path*.
// MISSING: a shared estate-context provider; DEFAULT_ESTATE_ID is a stopgap
// (mirrors the election/meetings convention) until multi-estate selection ships.
export const DEFAULT_ESTATE_ID = 'est_amber_court';
export const REPORTS_API_BASE = `/api/finance/estate/${DEFAULT_ESTATE_ID}/reports`;

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
  // Backend /reports returns a flat EstateReport; fold it into an overview section.
  const { data } = await api.get(REPORTS_API_BASE);
  return {
    sections: [
      { id: 'overview', title: 'Overview', metrics: [
        { label: 'Residents', value: String(data.residents ?? 0) },
        { label: 'Open repairs', value: String(data.open_repairs ?? 0) },
        { label: 'Open emergencies', value: String(data.open_emergencies ?? 0) },
        { label: 'Announcements (30d)', value: String(data.announcements_30d ?? 0) },
        { label: 'Facilities', value: String(data.facilities_count ?? 0) },
        { label: 'Verified vendors', value: String(data.vendors_verified ?? 0) },
      ] },
    ],
  };
}

// ── Block 44 analytics (chart-ready, date-filtered) ───────────────────────────
export type AnalyticsType = 'visitors' | 'gate' | 'payments' | 'repairs' | 'facilities' | 'meetings' | 'elections' | 'security' | 'vendors';
export interface AnalyticsPoint { label: string; value: number; }
export interface AnalyticsResult { type: string; from: string; to: string; series: AnalyticsPoint[]; summary: Record<string, number>; }
export const ANALYTICS_BASE = `/api/finance/estate/${DEFAULT_ESTATE_ID}/analytics`;

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
