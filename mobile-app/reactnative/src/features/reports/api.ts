// Estate Reports (Block 44) — types + dual mock/live api.
import { api } from '@/api/client';

export interface ReportMetric { label: string; value: string }
export interface ReportSection { id: string; title: string; metrics: ReportMetric[] }
export interface ReportsResponse { sections: ReportSection[] }

export const USE_MOCK = (process.env.EXPO_PUBLIC_REPORTS_USE_MOCK ?? 'true') !== 'false';
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
  const { data } = await api.get<ReportsResponse>(REPORTS_API_BASE); return data;
}
