// Estate finance dashboard (Block 40) — types + dual mock/live api.
import { api } from '@/api/client';

export interface FinanceDashboard {
  collectedTotalKobo: number;
  collectedThisMonthKobo: number;
  outstandingKobo: number;
  invoiceCount: number;
  paidCount: number;
  collectionRate: number;
  byCategory: { category: string; amountKobo: number }[];
  recentPayments: { id: string; amountKobo: number; method: string; payerName?: string; createdAt: string }[];
}

export const USE_MOCK = (process.env.EXPO_PUBLIC_FINANCE_USE_MOCK ?? 'true') !== 'false';
export const FINANCE_API_BASE = '/api/v1/estate/finance';

export const CATEGORY_LABELS: Record<string, string> = {
  service_charge: 'Service Charge', security_levy: 'Security Levy', waste: 'Waste', water: 'Water',
  electricity: 'Electricity', rent: 'Rent', facility: 'Facility', penalty: 'Penalty', other: 'Other',
};

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
const mock: FinanceDashboard = {
  collectedTotalKobo: 184_500_000,
  collectedThisMonthKobo: 42_000_000,
  outstandingKobo: 31_500_000,
  invoiceCount: 48,
  paidCount: 39,
  collectionRate: 81,
  byCategory: [
    { category: 'service_charge', amountKobo: 96_000_000 },
    { category: 'security_levy', amountKobo: 54_000_000 },
    { category: 'waste', amountKobo: 18_500_000 },
    { category: 'facility', amountKobo: 16_000_000 },
  ],
  recentPayments: [
    { id: 'pp1', amountKobo: 7_500_000, method: 'wallet', payerName: 'Ngozi Okeke', createdAt: iso(-2 * H) },
    { id: 'pp2', amountKobo: 3_000_000, method: 'wallet', payerName: 'Emeka Eze', createdAt: iso(-26 * H) },
    { id: 'pp3', amountKobo: 7_500_000, method: 'transfer', payerName: 'Tunde Bello', createdAt: iso(-50 * H) },
  ],
};
const latency = (ms = 320) => new Promise((r) => setTimeout(r, ms));

export async function getFinanceDashboard(): Promise<FinanceDashboard> {
  if (USE_MOCK) { await latency(); return JSON.parse(JSON.stringify(mock)); }
  const { data } = await api.get<FinanceDashboard>(FINANCE_API_BASE); return data;
}
