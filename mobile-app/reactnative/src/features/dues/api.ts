// Estate Dues / Payments (Block 29) — types + dual mock/live api + constants.
import { api } from '@/api/client';
import { Colors } from '@/constants/colors';
import { generateIdempotencyKey } from '@/utils/idempotency';

export type DuesCategory = 'service_charge' | 'security_levy' | 'waste' | 'water' | 'electricity' | 'rent' | 'facility' | 'penalty' | 'other';
export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'waived';

export interface DuesInvoice {
  id: string; estateId: string; residentId: string; category: DuesCategory | string;
  amountKobo: number; dueDate: string; status: InvoiceStatus; createdAt: string;
}
export interface PayResult { success: boolean; alreadyProcessed: boolean; payment: { id: string; amountKobo: number; reference?: string; createdAt: string }; invoice: DuesInvoice; }

export const USE_MOCK = (process.env.EXPO_PUBLIC_DUES_USE_MOCK ?? 'true') !== 'false';

// Dues are served by the resident-scoped frontend-web handlers under
// /api/v1/estate/dues (GET list, POST /{id}/pay). The current resident's
// estate is derived SERVER-SIDE from the auth token
// (frontend-web/src/server/estate/dues.ts → listInvoices/payInvoice), so the
// client never passes an estate ID. PayDues is the money path — Idempotency-Key
// required.
export const DUES_API_BASE = '/api/v1/estate/dues';

export const CATEGORY_META: Record<DuesCategory, { label: string; icon: string }> = {
  service_charge: { label: 'Service Charge', icon: 'Receipt' },
  security_levy:  { label: 'Security Levy',  icon: 'ShieldCheck' },
  waste:          { label: 'Waste',          icon: 'Trash2' },
  water:          { label: 'Water',          icon: 'Droplets' },
  electricity:    { label: 'Electricity',    icon: 'Zap' },
  rent:           { label: 'Rent',           icon: 'KeyRound' },
  facility:       { label: 'Facility',       icon: 'Building2' },
  penalty:        { label: 'Penalty',        icon: 'TriangleAlert' },
  other:          { label: 'Other',          icon: 'FileText' },
};
export const STATUS_META: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: '#B26B00',      bg: 'rgba(245,158,11,0.12)' },
  paid:    { label: 'Paid',    color: '#16A34A',      bg: 'rgba(22,163,74,0.12)' },
  overdue: { label: 'Overdue', color: Colors.error,   bg: Colors.errorContainer },
  waived:  { label: 'Waived',  color: Colors.outline, bg: Colors.surfaceContainerLow },
};

const D = 86_400_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
let invoices: DuesInvoice[] = [
  { id: 'i1', estateId: 'est_amber_court', residentId: 'res_demo', category: 'service_charge', amountKobo: 7_500_000, dueDate: iso(7 * D), status: 'pending', createdAt: iso(-20 * D) },
  { id: 'i2', estateId: 'est_amber_court', residentId: 'res_demo', category: 'security_levy', amountKobo: 3_000_000, dueDate: iso(-3 * D), status: 'overdue', createdAt: iso(-33 * D) },
  { id: 'i3', estateId: 'est_amber_court', residentId: 'res_demo', category: 'waste', amountKobo: 500_000, dueDate: iso(-40 * D), status: 'paid', createdAt: iso(-70 * D) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const idem = (k?: string) => ({ headers: { 'Idempotency-Key': k ?? generateIdempotencyKey() } });

export async function listInvoices(): Promise<DuesInvoice[]> {
  if (USE_MOCK) {
    await latency();
    const now = Date.now();
    return invoices.slice().map((i) => (i.status === 'pending' && +new Date(i.dueDate) < now ? { ...i, status: 'overdue' as InvoiceStatus } : { ...i }))
      .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate));
  }
  const { data } = await api.get<DuesInvoice[]>(DUES_API_BASE); return data;
}
export async function payInvoice(id: string, idempotencyKey: string): Promise<PayResult> {
  if (USE_MOCK) {
    await latency(600); const inv = invoices.find((x) => x.id === id); if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'paid') throw new Error('Invoice is already paid');
    inv.status = 'paid';
    return { success: true, alreadyProcessed: false, payment: { id: `pay_${Date.now()}`, amountKobo: inv.amountKobo, reference: idempotencyKey, createdAt: new Date().toISOString() }, invoice: { ...inv } };
  }
  const { data } = await api.post<PayResult>(`${DUES_API_BASE}/${id}/pay`, {}, idem(idempotencyKey)); return data;
}
